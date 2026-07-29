import { expect, test } from "bun:test";
import type { WSEvents, WSContext } from "hono/ws";
import { createApp } from "../src/app";
import {
  CheckoutSessionUpdatedEventSchema,
  type CheckoutSessionUpdatedEvent,
} from "@checkout/sdk/contracts";
import { RealtimeHub } from "../src/providers/realtime-hub";
import { createApiTestHarness } from "./fixtures";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

function createSocketSpy({ failSend = false } = {}) {
  const messages: string[] = [];
  let closeCount = 0;

  return {
    messages,
    get closeCount() {
      return closeCount;
    },
    socket: {
      send(data: string): void {
        if (failSend) {
          throw new Error("socket send failed");
        }
        messages.push(data);
      },
      close(): void {
        closeCount += 1;
      },
    },
  };
}

async function captureUpgradeEvents(
  dependencies: ReturnType<typeof createApiTestHarness>["appDependencies"],
  path: string,
): Promise<WSEvents> {
  let events: WSEvents | undefined;
  const server = {
    upgrade(
      _request: Request,
      options: { data: { events: WSEvents } },
    ): boolean {
      events = options.data.events;
      return true;
    },
  };
  const response = await createApp(dependencies).fetch(
    new Request(`http://localhost${path}`),
    { server } as never,
  );

  expect(response.status).toBe(200);
  if (!events) {
    throw new Error("expected the realtime route to request an upgrade");
  }
  return events;
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Bun.sleep(0);
}

test("publishes one complete snapshot only to matching subscribers", () => {
  const hub = new RealtimeHub();
  const matching = createSocketSpy();
  const unrelated = createSocketSpy();
  const event = CheckoutSessionUpdatedEventSchema.parse({
    type: "checkout_session_updated",
    cause: "repriced",
    snapshot: {
      serverNow: "2026-07-27T17:00:00.000Z",
      session: {
        id: "chk_matching",
        revision: 4,
        createdAt: "2026-07-27T17:00:00.000Z",
        updatedAt: "2026-07-27T17:00:00.000Z",
        event: {
          name: "Chicago Bears vs. Green Bay Packers",
          venue: "Soldier Field",
          timeLabel: "Sunday at 12:00 PM",
          isDemo: true,
        },
        listing: { id: "lst_1", section: "101", row: "A", seat: "1" },
        inventoryHold: { expiresAt: "2026-07-27T17:01:30.000Z" },
        offer: {
          currency: "USD",
          currentVersion: 2,
          currentTotalCents: 12_000,
          acceptedVersion: 1,
          acceptedTotalCents: 10_000,
        },
        phase: "active",
        payment: { status: "idle" },
      },
      allowedActions: ["accept_offer"],
      status: "offer_review_required",
    },
  });
  const removeMatching = hub.register("chk_matching", matching.socket);
  hub.register("chk_other", unrelated.socket);

  hub.publish(event);

  expect(matching.messages).toHaveLength(1);
  expect(
    CheckoutSessionUpdatedEventSchema.safeParse(
      JSON.parse(matching.messages[0] ?? ""),
    ).success,
  ).toBe(true);
  expect(unrelated.messages).toHaveLength(0);
  removeMatching();
  expect(hub.connectionCount("chk_matching")).toBe(0);
});

test("fresh initial sync recovers a transition published before registration", async () => {
  const harness = createApiTestHarness();
  const created = await harness.createCheckout();
  const freshRead =
    createDeferred<Awaited<ReturnType<typeof harness.checkout.getSession>>>();
  const getSession = harness.checkout.getSession.bind(harness.checkout);
  let readCount = 0;
  harness.checkout.getSession = async (input) => {
    readCount += 1;
    if (readCount === 2) {
      return freshRead.promise;
    }
    return getSession(input);
  };
  const events = await captureUpgradeEvents(
    harness.appDependencies,
    `/v1/checkout-sessions/${created.snapshot.session.id}/events?token=${encodeURIComponent(created.resumeToken)}`,
  );
  const client = createSocketSpy();
  const repriced = await harness.checkout.reprice({
    sessionId: created.snapshot.session.id,
    resumeToken: created.resumeToken,
    increaseCents: 2_000,
  });
  expect(repriced.session.revision).toBe(created.snapshot.session.revision + 1);
  expect(repriced.status).toBe("offer_review_required");
  expect(
    harness.appDependencies.realtimeHub.connectionCount(
      created.snapshot.session.id,
    ),
  ).toBe(0);
  harness.appDependencies.realtimeHub.publish({
    type: "checkout_session_updated",
    cause: "repriced",
    snapshot: repriced,
  });
  expect(client.messages).toHaveLength(0);

  events.onOpen?.(new Event("open"), client.socket as unknown as WSContext);
  await flushAsyncWork();

  expect(readCount).toBe(2);
  expect(
    harness.appDependencies.realtimeHub.connectionCount(
      created.snapshot.session.id,
    ),
  ).toBe(1);

  harness.appDependencies.realtimeHub.publish({
    type: "checkout_session_updated",
    cause: "repriced",
    snapshot: repriced,
  });
  expect(client.messages).toHaveLength(1);

  freshRead.resolve(repriced);
  await flushAsyncWork();

  expect(client.messages).toHaveLength(2);
  const delivered = client.messages.map((message) =>
    CheckoutSessionUpdatedEventSchema.parse(JSON.parse(message)),
  );
  expect(delivered.map((event) => event.cause)).toEqual([
    "repriced",
    "initial_sync",
  ]);
  expect(delivered.map((event) => event.snapshot.session.revision)).toEqual([
    repriced.session.revision,
    repriced.session.revision,
  ]);
  expect(delivered[1]?.snapshot.status).toBe("offer_review_required");
});

for (const retirementEvent of ["onClose", "onError"] as const) {
  test(`${retirementEvent} retires the socket before an asynchronous read completes`, async () => {
    const harness = createApiTestHarness();
    const created = await harness.createCheckout();
    const freshRead =
      createDeferred<Awaited<ReturnType<typeof harness.checkout.getSession>>>();
    const getSession = harness.checkout.getSession.bind(harness.checkout);
    let readCount = 0;
    harness.checkout.getSession = async (input) => {
      readCount += 1;
      if (readCount === 2) {
        return freshRead.promise;
      }
      return getSession(input);
    };
    const events = await captureUpgradeEvents(
      harness.appDependencies,
      `/v1/checkout-sessions/${created.snapshot.session.id}/events?token=${encodeURIComponent(created.resumeToken)}`,
    );
    const client = createSocketSpy();
    const socket = client.socket as unknown as WSContext;

    events.onOpen?.(new Event("open"), socket);
    await flushAsyncWork();
    expect(readCount).toBe(2);

    events[retirementEvent]?.(new Event(retirementEvent) as never, socket);
    events[retirementEvent]?.(new Event(retirementEvent) as never, socket);
    expect(
      harness.appDependencies.realtimeHub.connectionCount(
        created.snapshot.session.id,
      ),
    ).toBe(0);

    freshRead.resolve(created.snapshot);
    await flushAsyncWork();

    expect(client.messages).toHaveLength(0);
    expect(client.closeCount).toBe(0);
  });
}

test("a failed fresh read retires and closes the socket", async () => {
  const harness = createApiTestHarness();
  const created = await harness.createCheckout();
  const getSession = harness.checkout.getSession.bind(harness.checkout);
  let readCount = 0;
  harness.checkout.getSession = async (input) => {
    readCount += 1;
    return getSession(
      readCount === 2 ? { ...input, resumeToken: "invalid" } : input,
    );
  };
  const events = await captureUpgradeEvents(
    harness.appDependencies,
    `/v1/checkout-sessions/${created.snapshot.session.id}/events?token=${encodeURIComponent(created.resumeToken)}`,
  );
  const client = createSocketSpy();

  events.onOpen?.(new Event("open"), client.socket as unknown as WSContext);
  await flushAsyncWork();

  expect(readCount).toBe(2);
  expect(
    harness.appDependencies.realtimeHub.connectionCount(
      created.snapshot.session.id,
    ),
  ).toBe(0);
  expect(client.messages).toHaveLength(0);
  expect(client.closeCount).toBe(1);
});

test("a rejected fresh read retires and closes the socket", async () => {
  const harness = createApiTestHarness();
  const created = await harness.createCheckout();
  const getSession = harness.checkout.getSession.bind(harness.checkout);
  let readCount = 0;
  harness.checkout.getSession = async (input) => {
    readCount += 1;
    if (readCount === 2) {
      throw new Error("fresh read failed");
    }
    return getSession(input);
  };
  const events = await captureUpgradeEvents(
    harness.appDependencies,
    `/v1/checkout-sessions/${created.snapshot.session.id}/events?token=${encodeURIComponent(created.resumeToken)}`,
  );
  const client = createSocketSpy();

  events.onOpen?.(new Event("open"), client.socket as unknown as WSContext);
  await flushAsyncWork();

  expect(readCount).toBe(2);
  expect(
    harness.appDependencies.realtimeHub.connectionCount(
      created.snapshot.session.id,
    ),
  ).toBe(0);
  expect(client.closeCount).toBe(1);
});

test("a failed initial send removes and closes the socket", async () => {
  const harness = createApiTestHarness();
  const created = await harness.createCheckout();
  const events = await captureUpgradeEvents(
    harness.appDependencies,
    `/v1/checkout-sessions/${created.snapshot.session.id}/events?token=${encodeURIComponent(created.resumeToken)}`,
  );
  const client = createSocketSpy({ failSend: true });

  events.onOpen?.(new Event("open"), client.socket as unknown as WSContext);
  await flushAsyncWork();

  expect(
    harness.appDependencies.realtimeHub.connectionCount(
      created.snapshot.session.id,
    ),
  ).toBe(0);
  expect(client.closeCount).toBe(1);
});

test("send validates an event and cleans up a transport failure", async () => {
  const harness = createApiTestHarness();
  const created = await harness.createCheckout();
  const hub = new RealtimeHub();
  const client = createSocketSpy({ failSend: true });
  hub.register(created.snapshot.session.id, client.socket);

  expect(
    hub.send(client.socket, {
      type: "checkout_session_updated",
      cause: "repriced",
      snapshot: created.snapshot,
    }),
  ).toBe(false);
  expect(hub.connectionCount(created.snapshot.session.id)).toBe(0);
});

test("malformed events do not send or retire a healthy socket", async () => {
  const harness = createApiTestHarness();
  const created = await harness.createCheckout();
  const hub = new RealtimeHub();
  const client = createSocketSpy();
  hub.register(created.snapshot.session.id, client.socket);
  const malformed = {
    type: "checkout_session_updated",
  } as CheckoutSessionUpdatedEvent;

  expect(hub.send(client.socket, malformed)).toBe(false);
  expect(() => hub.publish(malformed)).not.toThrow();
  expect(client.messages).toHaveLength(0);
  expect(hub.connectionCount(created.snapshot.session.id)).toBe(1);
});

test("authenticates an events request before upgrade without REST CORS middleware", async () => {
  const harness = createApiTestHarness();
  const created = await harness.createCheckout();
  const response = await createApp(harness.appDependencies).request(
    `/v1/checkout-sessions/${created.snapshot.session.id}/events?token=wrong`,
    { headers: { origin: "http://127.0.0.1:8000" } },
  );

  expect(response.status).toBe(401);
  expect(response.headers.get("access-control-allow-origin")).toBeNull();
  expect((await response.json()).code).toBe("UNAUTHORIZED_SESSION");
});
