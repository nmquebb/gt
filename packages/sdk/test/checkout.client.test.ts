import { describe, expect, test } from "bun:test";
import {
  CheckoutClientError,
  createCheckoutClient,
  createClockAnchor,
  createClockHandoff,
  hydrateClockHandoff,
  remainingHoldMs,
} from "../src";
import type { CheckoutSnapshot, ListingsResponse } from "../src/contracts";

const snapshot: CheckoutSnapshot = {
  serverNow: "2026-07-27T17:00:00.000Z",
  session: {
    id: "chk_1",
    revision: 1,
    createdAt: "2026-07-27T17:00:00.000Z",
    updatedAt: "2026-07-27T17:00:00.000Z",
    event: {
      name: "Chicago Bears vs. Green Bay Packers",
      venue: "Soldier Field",
      timeLabel: "Sunday at 12:00 PM",
      isDemo: true,
    },
    listing: { id: "lst_101_a_1", section: "101", row: "A", seat: "1" },
    inventoryHold: { expiresAt: "2026-07-27T17:01:30.000Z" },
    offer: {
      currency: "USD",
      currentVersion: 1,
      currentTotalCents: 12_500,
      acceptedVersion: 1,
      acceptedTotalCents: 12_500,
    },
    phase: "active",
    payment: { status: "idle" },
  },
  allowedActions: ["purchase"],
  status: "ready",
};

const listings: ListingsResponse = {
  event: snapshot.session.event,
  listings: [
    {
      id: "lst_101_a_1",
      section: "101",
      row: "A",
      seat: "1",
      priceCents: 12_500,
      status: "available",
    },
  ],
};

const context = {
  sessionId: "chk_1",
  resumeToken: "secret",
  deviceId: "web_1",
  surface: "web" as const,
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function clientWithResponse(response: Response) {
  return createCheckoutClient({
    baseUrl: "http://api.test",
    fetch: async () => response,
    monotonicNow: () => 1_200,
  });
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  throw new Error("Expected the promise to reject");
}

function requestBody(init: RequestInit | undefined): unknown {
  const body = init?.body;
  if (typeof body !== "string") {
    throw new Error("Expected a JSON request body");
  }

  return JSON.parse(body);
}

describe("clock anchor", () => {
  test("anchors expiration to server time plus half the measured RTT", () => {
    const anchor = createClockAnchor({
      serverNow: "2026-07-27T17:00:00.000Z",
      expiresAt: "2026-07-27T17:01:30.000Z",
      requestStartedAtMs: 1_000,
      responseReceivedAtMs: 1_200,
    });

    expect(anchor).toEqual({
      serverEpochAtAnchorMs: Date.parse("2026-07-27T17:00:00.000Z") + 100,
      monotonicAtAnchorMs: 1_200,
      requestStartedAtMonotonicMs: 1_000,
      expiresAtEpochMs: Date.parse("2026-07-27T17:01:30.000Z"),
    });
    expect(remainingHoldMs(anchor, 2_200)).toBe(88_900);
  });

  test("hands remaining time to another monotonic clock", () => {
    const anchor = createClockAnchor({
      serverNow: "2026-07-27T17:00:00.000Z",
      expiresAt: "2026-07-27T17:01:30.000Z",
      requestStartedAtMs: 1_000,
      responseReceivedAtMs: 1_200,
    });

    const handoff = createClockHandoff(anchor, 2_200);

    expect(handoff).toEqual({
      remainingHoldMsAtRender: 88_900,
      expiresAtEpochMs: Date.parse("2026-07-27T17:01:30.000Z"),
    });
    expect(hydrateClockHandoff(handoff, 50)).toEqual({
      serverEpochAtAnchorMs: Date.parse("2026-07-27T17:00:00.000Z") + 1_100,
      monotonicAtAnchorMs: 50,
      requestStartedAtMonotonicMs: 50,
      expiresAtEpochMs: Date.parse("2026-07-27T17:01:30.000Z"),
    });
  });
});

describe("checkout client boundaries", () => {
  test("returns parsed data and throws a typed state conflict", async () => {
    let nextResponse = jsonResponse(listings);
    const client = createCheckoutClient({
      baseUrl: "http://api.test",
      fetch: async () => nextResponse,
      monotonicNow: () => 1_200,
    });

    expect(await client.listListings()).toEqual(listings);

    nextResponse = jsonResponse(
      {
        code: "PURCHASE_NOT_ALLOWED",
        message: "The checkout cannot be purchased.",
        snapshot,
      },
      409,
    );

    expect(
      await rejection(client.purchase(context, "retry click")),
    ).toMatchObject({
      name: "CheckoutClientError",
      code: "PURCHASE_NOT_ALLOWED",
      message: "The checkout cannot be purchased.",
      snapshot,
      clockAnchor: {
        serverEpochAtAnchorMs: Date.parse(snapshot.serverNow),
        monotonicAtAnchorMs: 1_200,
        requestStartedAtMonotonicMs: 1_200,
        expiresAtEpochMs: Date.parse(snapshot.session.inventoryHold.expiresAt),
      },
    });
  });

  test("throws a typed network error when fetch rejects", async () => {
    const client = createCheckoutClient({
      baseUrl: "http://api.invalid",
      fetch: async () => {
        throw new TypeError("offline");
      },
      monotonicNow: () => 1_000,
    });

    expect(await rejection(client.listListings())).toMatchObject({
      name: "CheckoutClientError",
      code: "NETWORK_UNAVAILABLE",
      message: "list_listings could not reach the API.",
    });
  });

  test("throws a typed invalid-response error for malformed JSON", async () => {
    const client = createCheckoutClient({
      baseUrl: "http://api.test",
      fetch: async () => new Response("not-json", { status: 200 }),
      monotonicNow: () => 1_000,
    });

    expect(await rejection(client.listListings())).toMatchObject({
      name: "CheckoutClientError",
      code: "INVALID_SERVER_RESPONSE",
      message: "list_listings returned invalid JSON.",
    });
  });

  test("throws a typed invalid-response error for schema-invalid JSON", async () => {
    expect(
      await rejection(
        clientWithResponse(jsonResponse({ listings: [] })).listListings(),
      ),
    ).toMatchObject({
      name: "CheckoutClientError",
      code: "INVALID_SERVER_RESPONSE",
      message: "list_listings returned an invalid response.",
    });
  });

  test("throws direct API errors without snapshots", async () => {
    expect(
      await rejection(
        clientWithResponse(
          jsonResponse(
            {
              code: "UNAUTHORIZED_SESSION",
              message: "The checkout session credential is invalid.",
            },
            401,
          ),
        ).getCheckout(context),
      ),
    ).toEqual(
      new CheckoutClientError(
        "UNAUTHORIZED_SESSION",
        "The checkout session credential is invalid.",
      ),
    );

    expect(
      await rejection(
        clientWithResponse(
          jsonResponse(
            {
              code: "CHECKOUT_SESSION_NOT_FOUND",
              message: "The checkout session was not found.",
            },
            404,
          ),
        ).getCheckout(context),
      ),
    ).toMatchObject({
      name: "CheckoutClientError",
      code: "CHECKOUT_SESSION_NOT_FOUND",
    });
  });

  test("rejects malformed API errors as invalid server responses", async () => {
    expect(
      await rejection(
        clientWithResponse(
          jsonResponse({ error: { code: "INTERNAL_SERVER_ERROR" } }, 500),
        ).listListings(),
      ),
    ).toMatchObject({
      name: "CheckoutClientError",
      code: "INVALID_SERVER_RESPONSE",
    });
  });

  test("returns a checkout snapshot with an RTT-derived clock anchor", async () => {
    const now = [1_000, 1_200];
    const client = createCheckoutClient({
      baseUrl: "http://api.test",
      fetch: async () => jsonResponse({ snapshot }),
      monotonicNow: () => now.shift() ?? 1_200,
    });

    const result = await client.getCheckout(context);

    expect(result).toEqual({
      snapshot,
      clockAnchor: {
        serverEpochAtAnchorMs: Date.parse(snapshot.serverNow) + 100,
        monotonicAtAnchorMs: 1_200,
        requestStartedAtMonotonicMs: 1_000,
        expiresAtEpochMs: Date.parse(snapshot.session.inventoryHold.expiresAt),
      },
    });
  });

  test("resumes checkout with authenticated transport", async () => {
    let requestedInit: RequestInit | undefined;
    const client = createCheckoutClient({
      baseUrl: "http://api.test",
      fetch: async (_input, init) => {
        requestedInit = init;

        return jsonResponse({ snapshot });
      },
      monotonicNow: () => 1_200,
    });

    await client.resume(context);

    expect(requestedInit?.method).toBe("PUT");
    expect(new Headers(requestedInit?.headers).get("authorization")).toBe(
      "Bearer secret",
    );
    expect(requestBody(requestedInit)).toEqual({
      surface: "web",
    });
  });

  test("expires checkout with an authenticated empty POST", async () => {
    let requestedInit: RequestInit | undefined;
    const client = createCheckoutClient({
      baseUrl: "http://api.test",
      fetch: async (_input, init) => {
        requestedInit = init;

        return jsonResponse({ snapshot });
      },
      monotonicNow: () => 1_200,
    });

    await client.expire(context);

    expect(requestedInit?.method).toBe("POST");
    expect(new Headers(requestedInit?.headers).get("authorization")).toBe(
      "Bearer secret",
    );
    expect(new Headers(requestedInit?.headers).get("content-type")).toBeNull();
    expect(requestedInit?.body).toBeUndefined();
  });

  test("maps an explicit null action response to void", async () => {
    let requestedBody: unknown;
    const client = createCheckoutClient({
      baseUrl: "http://api.test",
      fetch: async (_input, init) => {
        requestedBody = requestBody(init);

        return jsonResponse(null);
      },
      monotonicNow: () => 1_200,
    });

    expect(
      await client.setNextPaymentOutcome(context, "failure"),
    ).toBeUndefined();
    expect(requestedBody).toEqual({ outcome: "failure" });
  });

  test("opens an encoded typed websocket route", () => {
    let openedUrl: string | undefined;
    const client = createCheckoutClient({
      baseUrl: "http://api.test",
      fetch,
      monotonicNow: () => 1_000,
      webSocket: (url: string | URL) => {
        openedUrl = url.toString();

        return { addEventListener() {}, close() {} } as unknown as WebSocket;
      },
    });

    const socket = client.openEvents({
      ...context,
      sessionId: "checkout / 1",
      resumeToken: "token with & punctuation",
    });

    expect(socket).toBeDefined();
    expect(openedUrl).toContain("/v1/checkout-sessions/");
    expect(openedUrl).toContain("token=token+with+%26+punctuation");
  });

  test("passes a string URL to React Native-shaped websocket factories", () => {
    let openedUrl: string | undefined;
    const client = createCheckoutClient({
      baseUrl: "http://api.test",
      fetch,
      monotonicNow: () => 1_000,
      webSocket: (url: string) => {
        openedUrl = url;

        return { addEventListener() {}, close() {} };
      },
    });

    client.openEvents(context);

    expect(typeof openedUrl).toBe("string");
    expect(openedUrl).toBe(
      "ws://api.test/v1/checkout-sessions/chk_1/events?token=secret",
    );
  });

  test("throws a typed network error when websocket construction fails", () => {
    const client = createCheckoutClient({
      baseUrl: "http://api.test",
      fetch,
      monotonicNow: () => 1_000,
      webSocket: () => {
        throw new TypeError("offline");
      },
    });

    expect(() => client.openEvents(context)).toThrow(
      expect.objectContaining({
        name: "CheckoutClientError",
        code: "NETWORK_UNAVAILABLE",
        message: "checkout_events could not reach the API.",
      }),
    );
  });
});
