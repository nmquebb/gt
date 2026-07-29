import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { ActivityEntrySchema, ApiErrorSchema } from "@checkout/sdk/contracts";
import { createApiTestHarness } from "./fixtures";

function requestJson(
  app: ReturnType<typeof createApp>,
  path: string,
  init: RequestInit,
) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");

  return app.request(path, { ...init, headers });
}

const purchaseBody = {
  surface: "web",
  deviceId: "web_1",
};

function purchaseHeaders(resumeToken: string, idempotencyKey: string) {
  return {
    authorization: `Bearer ${resumeToken}`,
    "idempotency-key": idempotencyKey,
  };
}

describe("checkout routes", () => {
  test("creates and retrieves one checkout as direct resources", async () => {
    const harness = createApiTestHarness();
    const app = createApp(harness.appDependencies);
    const createdResponse = await app.request("/v1/checkout-sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        listingId: "lst_101_a_1",
        surface: "web",
        deviceId: "web_1",
      }),
    });
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json();
    expect(created).not.toHaveProperty("data");
    expect(created.links.webPath).toContain("/checkout/");
    expect(created.links.deepLink.startsWith("gametime://checkout/")).toBe(
      true,
    );

    const readResponse = await app.request(
      `/v1/checkout-sessions/${created.snapshot.session.id}`,
      {
        headers: {
          authorization: `Bearer ${created.resumeToken}`,
        },
      },
    );
    expect(readResponse.status).toBe(200);
    expect(await readResponse.json()).toMatchObject({
      snapshot: {
        session: { id: created.snapshot.session.id },
      },
    });
  });

  test("does not expose a snapshot for invalid credentials", async () => {
    const harness = createApiTestHarness();
    const created = await harness.createCheckout();
    const response = await createApp(harness.appDependencies).request(
      `/v1/checkout-sessions/${created.snapshot.session.id}`,
      { headers: { authorization: "Bearer wrong-token" } },
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.code).toBe("UNAUTHORIZED_SESSION");
    expect(body.snapshot).toBeUndefined();
  });

  test("web leave keeps checkout active while another realtime client remains", async () => {
    const harness = createApiTestHarness();
    const created = await harness.createCheckout();
    const app = createApp(harness.appDependencies);
    const path = `/v1/checkout-sessions/${created.snapshot.session.id}`;
    const socket = { send(): void {} };
    harness.appDependencies.realtimeHub.register(
      created.snapshot.session.id,
      socket,
    );
    harness.appDependencies.realtimeHub.register(created.snapshot.session.id, {
      send(): void {},
    });
    const left = await requestJson(app, path, {
      method: "DELETE",
      headers: { authorization: `Bearer ${created.resumeToken}` },
      body: JSON.stringify({
        surface: "web",
        deviceId: "web_1",
      }),
    });

    expect(left.status).toBe(200);
    expect((await left.json()).snapshot.status).toBe("ready");
    expect(harness.repository.getListing("lst_101_a_1")?.status).toBe("held");
  });

  test("returns health and listing resources directly", async () => {
    const harness = createApiTestHarness();
    const app = createApp(harness.appDependencies);

    const health = await app.request("/v1/health", {
      headers: { origin: "http://127.0.0.1:8000" },
    });
    const listings = await app.request("/v1/listings");

    expect(health.status).toBe(200);
    expect(health.headers.get("x-request-id")).toBeNull();
    expect(health.headers.get("access-control-allow-origin")).toBe(
      "http://127.0.0.1:8000",
    );
    expect(await health.json()).toEqual({ status: "ok" });
    expect(listings.status).toBe(200);
    const body = await listings.json();
    expect(body).toEqual({
      event: expect.any(Object),
      listings: expect.any(Array),
    });
    expect(body.listings).toHaveLength(6);
    expect(body).not.toHaveProperty("data");
  });

  test("returns direct errors for unmatched routes and unsupported methods", async () => {
    const harness = createApiTestHarness();
    const app = createApp(harness.appDependencies);

    const missing = await app.request("/v1/nope");
    const unsupported = await app.request("/v1/health", { method: "POST" });
    const missingBody = ApiErrorSchema.parse(await missing.json());
    const unsupportedBody = ApiErrorSchema.parse(await unsupported.json());

    expect(missing.status).toBe(404);
    expect(missing.headers.get("x-request-id")).toBeNull();
    expect(missingBody.code).toBe("REST_RESOURCE_NOT_FOUND");
    expect(unsupported.status).toBe(404);
    expect(unsupported.headers.get("x-request-id")).toBeNull();
    expect(unsupportedBody.code).toBe("REST_RESOURCE_NOT_FOUND");
  });

  test("sanitizes unexpected provider failures in a direct 500 error", async () => {
    const harness = createApiTestHarness();
    harness.checkout.listListings = async () => {
      throw new Error("provider credential should not be exposed");
    };
    const response = await createApp(harness.appDependencies).request(
      "/v1/listings",
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(response.headers.get("x-request-id")).toBeNull();
    expect(body).toEqual({
      code: "INTERNAL_SERVER_ERROR",
      message: "The server could not complete the request.",
    });
  });

  test("rejects an invalid create request and reports a listing conflict", async () => {
    const harness = createApiTestHarness();
    const app = createApp(harness.appDependencies);

    const invalid = await requestJson(app, "/v1/checkout-sessions", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const first = await requestJson(app, "/v1/checkout-sessions", {
      method: "POST",
      body: JSON.stringify({
        listingId: "lst_101_a_1",
        surface: "web",
        deviceId: "web_1",
      }),
    });
    const conflict = await requestJson(app, "/v1/checkout-sessions", {
      method: "POST",
      body: JSON.stringify({
        listingId: "lst_101_a_1",
        surface: "web",
        deviceId: "web_2",
      }),
    });

    expect(invalid.status).toBe(400);
    expect((await invalid.json()).code).toBe("INVALID_REQUEST");
    expect(first.status).toBe(201);
    expect(conflict.status).toBe(409);
    const conflictBody = ApiErrorSchema.parse(await conflict.json());
    expect(conflictBody.snapshot).toBeUndefined();
  });

  test("rejects malformed JSON as a direct invalid-request error", async () => {
    const harness = createApiTestHarness();
    const response = await createApp(harness.appDependencies).request(
      "/v1/checkout-sessions",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: "INVALID_REQUEST",
      message: "The request is invalid.",
    });
  });

  test("does not expose a snapshot for missing checkout sessions", async () => {
    const harness = createApiTestHarness();
    const created = await harness.createCheckout();
    const app = createApp(harness.appDependencies);

    const response = await app.request("/v1/checkout-sessions/missing", {
      headers: { authorization: `Bearer ${created.resumeToken}` },
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.code).toBe("CHECKOUT_SESSION_NOT_FOUND");
    expect(body.snapshot).toBeUndefined();
  });

  test("resumes a client idempotently", async () => {
    const harness = createApiTestHarness();
    const created = await harness.createCheckout();
    const app = createApp(harness.appDependencies);
    const path = `/v1/checkout-sessions/${created.snapshot.session.id}/clients/mobile_1`;
    const init = {
      method: "PUT",
      headers: { authorization: `Bearer ${created.resumeToken}` },
      body: JSON.stringify({
        surface: "mobile",
      }),
    };

    const attached = await requestJson(app, path, init);
    const repeated = await requestJson(app, path, init);
    const attachedBody = await attached.json();
    const repeatedBody = await repeated.json();

    expect(attached.status).toBe(200);
    expect(repeated.status).toBe(200);
    expect(attachedBody.snapshot.session.revision).toBe(1);
    expect(repeatedBody.snapshot.session.revision).toBe(1);
    expect(
      harness.activity
        .list(created.snapshot.session.id)
        .filter((entry) => entry.type === "checkout_session_resumed"),
    ).toHaveLength(1);
  });

  test("returns the current snapshot for stale offer acceptance", async () => {
    const harness = createApiTestHarness();
    const created = await harness.createCheckout();
    await harness.checkout.reprice({
      sessionId: created.snapshot.session.id,
      increaseCents: 500,
    });
    const app = createApp(harness.appDependencies);
    const path = `/v1/checkout-sessions/${created.snapshot.session.id}/offer-acceptance`;
    const headers = { authorization: `Bearer ${created.resumeToken}` };

    const stale = await requestJson(app, path, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        offerVersion: 1,
        surface: "web",
        deviceId: "web_1",
      }),
    });
    const current = await requestJson(app, path, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        offerVersion: 2,
        surface: "web",
        deviceId: "web_1",
      }),
    });
    const staleBody = ApiErrorSchema.parse(await stale.json());
    const currentBody = await current.json();

    expect(stale.status).toBe(409);
    expect(staleBody.code).toBe("OFFER_VERSION_MISMATCH");
    expect(staleBody.snapshot?.session.offer.currentVersion).toBe(2);
    expect(current.status).toBe(200);
    expect(currentBody.snapshot.status).toBe("ready");
  });

  test("rejects missing and empty idempotency keys", async () => {
    const harness = createApiTestHarness();
    const created = await harness.createCheckout();
    const app = createApp(harness.appDependencies);
    const path = `/v1/checkout-sessions/${created.snapshot.session.id}/purchase`;

    const missing = await requestJson(app, path, {
      method: "POST",
      headers: { authorization: `Bearer ${created.resumeToken}` },
      body: JSON.stringify(purchaseBody),
    });
    const empty = await requestJson(app, path, {
      method: "POST",
      headers: purchaseHeaders(created.resumeToken, ""),
      body: JSON.stringify(purchaseBody),
    });

    expect(missing.status).toBe(400);
    expect((await missing.json()).code).toBe("INVALID_IDEMPOTENCY_KEY");
    expect(empty.status).toBe(400);
    expect((await empty.json()).code).toBe("INVALID_IDEMPOTENCY_KEY");
  });

  test("reports pending, conflict, expiration, and completed purchase states", async () => {
    const harness = createApiTestHarness({ controlledPayment: true });
    const created = await harness.createCheckout();
    const app = createApp(harness.appDependencies);
    const path = `/v1/checkout-sessions/${created.snapshot.session.id}/purchase`;
    const firstKey = "cf7afe32-516e-4324-b1e2-cd31a27d5ef0";
    const pendingRequest = requestJson(app, path, {
      method: "POST",
      headers: purchaseHeaders(created.resumeToken, firstKey),
      body: JSON.stringify(purchaseBody),
    });
    await harness.payment?.waitUntilAuthorizationStarts();
    const pending = await requestJson(app, path, {
      method: "POST",
      headers: purchaseHeaders(
        created.resumeToken,
        "04a64804-fb3f-4ebe-9e14-7434ef5b469f",
      ),
      body: JSON.stringify(purchaseBody),
    });
    harness.payment?.resolveSuccess();
    const completed = await pendingRequest;
    const recovered = await requestJson(app, path, {
      method: "POST",
      headers: purchaseHeaders(created.resumeToken, firstKey),
      body: JSON.stringify(purchaseBody),
    });

    expect(pending.status).toBe(202);
    expect((await pending.json()).disposition).toBe("pending");
    expect(completed.status).toBe(200);
    expect(recovered.status).toBe(200);
    expect((await recovered.json()).disposition).toBe("completed");

    const conflictHarness = createApiTestHarness();
    const conflicted = await conflictHarness.createCheckout();
    await conflictHarness.checkout.reprice({
      sessionId: conflicted.snapshot.session.id,
      increaseCents: 500,
    });
    const conflict = await requestJson(
      createApp(conflictHarness.appDependencies),
      `/v1/checkout-sessions/${conflicted.snapshot.session.id}/purchase`,
      {
        method: "POST",
        headers: purchaseHeaders(
          conflicted.resumeToken,
          "756a739d-3b7e-476b-adc8-f4201dffea1f",
        ),
        body: JSON.stringify(purchaseBody),
      },
    );
    expect(conflict.status).toBe(409);
    const conflictBody = ApiErrorSchema.parse(await conflict.json());
    expect(conflictBody.snapshot?.status).toBe("offer_review_required");

    const expiredHarness = createApiTestHarness();
    const expired = await expiredHarness.createCheckout();
    expiredHarness.clock.advance(90_000);
    const expiration = await requestJson(
      createApp(expiredHarness.appDependencies),
      `/v1/checkout-sessions/${expired.snapshot.session.id}/purchase`,
      {
        method: "POST",
        headers: purchaseHeaders(
          expired.resumeToken,
          "cf7afe32-516e-4324-b1e2-cd31a27d5ef1",
        ),
        body: JSON.stringify(purchaseBody),
      },
    );
    expect(expiration.status).toBe(410);
    const expirationBody = ApiErrorSchema.parse(await expiration.json());
    expect(expirationBody.snapshot?.status).toBe("expired");
  });

  test("reports a persisted expired checkout as expired on purchase", async () => {
    const harness = createApiTestHarness();
    const created = await harness.createCheckout();
    await harness.checkout.forceExpire({
      sessionId: created.snapshot.session.id,
      resumeToken: created.resumeToken,
    });

    const response = await requestJson(
      createApp(harness.appDependencies),
      `/v1/checkout-sessions/${created.snapshot.session.id}/purchase`,
      {
        method: "POST",
        headers: purchaseHeaders(
          created.resumeToken,
          "cf7afe32-516e-4324-b1e2-cd31a27d5ef2",
        ),
        body: JSON.stringify(purchaseBody),
      },
    );

    expect(response.status).toBe(410);
    expect((await response.json()).code).toBe("CHECKOUT_SESSION_EXPIRED");
  });
});

describe("development checkout routes", () => {
  function authorization(resumeToken: string) {
    return {
      authorization: `Bearer ${resumeToken}`,
    };
  }

  test("returns typed activity and applies the default development reprice", async () => {
    const harness = createApiTestHarness();
    const created = await harness.createCheckout();
    const app = createApp(harness.appDependencies);
    const base = `/v1/dev/checkout-sessions/${created.snapshot.session.id}`;

    const activity = await app.request(`${base}/activity`, {
      headers: authorization(created.resumeToken),
    });
    const repriced = await requestJson(app, `${base}/reprice`, {
      method: "POST",
      headers: authorization(created.resumeToken),
      body: JSON.stringify({}),
    });

    const activityBody = await activity.json();
    const repricedBody = await repriced.json();
    expect(activity.status).toBe(200);
    expect(ActivityEntrySchema.array().safeParse(activityBody).success).toBe(
      true,
    );
    expect(repriced.status).toBe(200);
    expect(repricedBody.snapshot.session.offer.currentTotalCents).toBe(14_500);
  });

  test("rejects invalid development reprices with the canonical price-adjustment code", async () => {
    const harness = createApiTestHarness();
    const created = await harness.createCheckout();
    const app = createApp(harness.appDependencies);
    const path = `/v1/dev/checkout-sessions/${created.snapshot.session.id}/reprice`;
    const before = harness.repository.getSession(created.snapshot.session.id);

    const unsafe = await requestJson(app, path, {
      method: "POST",
      headers: authorization(created.resumeToken),
      body: JSON.stringify({ increaseCents: Number.MAX_SAFE_INTEGER }),
    });
    const fractional = await requestJson(app, path, {
      method: "POST",
      headers: authorization(created.resumeToken),
      body: JSON.stringify({ increaseCents: 1.5 }),
    });

    expect(unsafe.status).toBe(400);
    expect((await unsafe.json()).code).toBe("INVALID_PRICE_ADJUSTMENT");
    expect(fractional.status).toBe(400);
    expect((await fractional.json()).code).toBe("INVALID_PRICE_ADJUSTMENT");
    expect(harness.repository.getSession(created.snapshot.session.id)).toEqual(
      before,
    );
  });

  test("expires a checkout through the development route", async () => {
    const harness = createApiTestHarness();
    const created = await harness.createCheckout();
    const app = createApp(harness.appDependencies);

    const response = await requestJson(
      app,
      `/v1/dev/checkout-sessions/${created.snapshot.session.id}/expire`,
      {
        method: "POST",
        headers: authorization(created.resumeToken),
        body: JSON.stringify({}),
      },
    );

    expect(response.status).toBe(200);
    expect((await response.json()).snapshot.status).toBe("expired");
  });

  test("accepts only supported next-payment outcomes", async () => {
    const harness = createApiTestHarness();
    const created = await harness.createCheckout();
    const app = createApp(harness.appDependencies);
    const path = `/v1/dev/checkout-sessions/${created.snapshot.session.id}/next-payment-outcome`;

    const accepted = await requestJson(app, path, {
      method: "PUT",
      headers: authorization(created.resumeToken),
      body: JSON.stringify({ outcome: "failure" }),
    });
    const rejected = await requestJson(app, path, {
      method: "PUT",
      headers: authorization(created.resumeToken),
      body: JSON.stringify({ outcome: "other" }),
    });
    const acceptedBody = await accepted.json();

    expect(accepted.status).toBe(200);
    expect(acceptedBody).toBeNull();
    expect(rejected.status).toBe(400);
    expect(harness.nextPaymentOutcomes).toEqual([
      { sessionId: created.snapshot.session.id, outcome: "failure" },
    ]);
  });

  test("accepts generic payment failure and arbitrary idempotency keys", async () => {
    const harness = createApiTestHarness();
    const created = await harness.createCheckout();
    const app = createApp(harness.appDependencies);
    const auth = authorization(created.resumeToken);

    const configured = await requestJson(
      app,
      `/v1/dev/checkout-sessions/${created.snapshot.session.id}/next-payment-outcome`,
      {
        method: "PUT",
        headers: auth,
        body: JSON.stringify({ outcome: "failure" }),
      },
    );
    expect(configured.status).toBe(200);

    const purchase = await requestJson(
      app,
      `/v1/checkout-sessions/${created.snapshot.session.id}/purchase`,
      {
        method: "POST",
        headers: {
          ...auth,
          "idempotency-key": "web purchase click",
        },
        body: JSON.stringify({ surface: "web", deviceId: "web-1" }),
      },
    );
    expect(purchase.status).toBe(200);
  });

  test("does not expose checkout reset", async () => {
    const harness = createApiTestHarness();
    const created = await harness.createCheckout();
    const app = createApp(harness.appDependencies);

    const response = await app.request(
      `/v1/dev/checkout-sessions/${created.snapshot.session.id}/reset`,
      {
        method: "POST",
        headers: authorization(created.resumeToken),
      },
    );

    expect(response.status).toBe(404);
  });

  test("launches only the server-constructed trusted iOS deep link", async () => {
    const harness = createApiTestHarness();
    const created = await harness.createCheckout();
    const app = createApp(harness.appDependencies);

    const response = await requestJson(
      app,
      `/v1/dev/checkout-sessions/${created.snapshot.session.id}/open-ios-simulator`,
      {
        method: "POST",
        headers: authorization(created.resumeToken),
        body: JSON.stringify({
          deepLink: "https://untrusted.example/ignored",
          command: "ignored",
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toBeNull();
    expect(harness.openedDeepLinks).toEqual([
      `gametime://checkout/${created.snapshot.session.id}?token=${encodeURIComponent(created.resumeToken)}`,
    ]);
    expect(
      harness.activity
        .list(created.snapshot.session.id)
        .some((entry) => entry.type === "app_handoff_opened"),
    ).toBe(true);
  });
});
