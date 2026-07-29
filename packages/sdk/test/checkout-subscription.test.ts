import { describe, expect, test } from "bun:test";
import type {
  CheckoutClientContext,
  RealtimeSocket,
  RealtimeSocketEvent,
} from "../src/clients/checkout.client";
import type { ClockAnchor } from "../src/clients/clock-anchor";
import type { CheckoutSnapshot } from "../src/contracts";
import {
  createCheckoutSubscription,
  type RealtimeEnvironment,
} from "../src/realtime/checkout-subscription";
import { checkoutSnapshotFixture } from "./fixtures";

class FakeEnvironment implements RealtimeEnvironment {
  private nextTimerId = 1;
  private readonly timers = new Map<
    number,
    { callback: () => void; delayMs: number }
  >();

  setTimeout(callback: () => void, delayMs: number): number {
    const id = this.nextTimerId++;
    this.timers.set(id, { callback, delayMs });

    return id;
  }

  clearTimeout(handle: unknown): void {
    if (typeof handle === "number") {
      this.timers.delete(handle);
    }
  }

  runNext(delayMs: number): void {
    const timer = [...this.timers.entries()].find(
      ([, scheduled]) => scheduled.delayMs === delayMs,
    );
    if (!timer) {
      throw new Error(`No ${delayMs}ms timer is scheduled`);
    }
    const [id, scheduled] = timer;
    this.timers.delete(id);
    scheduled.callback();
  }

  scheduledDelays(): number[] {
    return [...this.timers.values()]
      .map(({ delayMs }) => delayMs)
      .sort((left, right) => left - right);
  }
}

type SocketEventType = "open" | "message" | "close" | "error";

class FakeSocket implements RealtimeSocket {
  private readonly listeners = new Map<
    SocketEventType,
    Set<(event: RealtimeSocketEvent) => void>
  >();
  closed = false;

  addEventListener(
    type: SocketEventType,
    listener: (event: RealtimeSocketEvent) => void,
  ): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  emit(type: SocketEventType, data?: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data });
    }
  }

  close(): void {
    this.closed = true;
  }
}

function realtimeEvent(snapshot: CheckoutSnapshot): string {
  return JSON.stringify({
    type: "checkout_session_updated",
    cause: "repriced",
    snapshot,
  });
}

function createHarness(
  initialSnapshot = checkoutSnapshotFixture({ revision: 2 }),
) {
  const environment = new FakeEnvironment();
  const sockets: FakeSocket[] = [];
  const context: CheckoutClientContext = {
    sessionId: initialSnapshot.session.id,
    resumeToken: "resume-token",
    surface: "web",
    deviceId: "web_1",
  };
  let snapshot = initialSnapshot;
  let relatedDataChanges = 0;
  let appliedAnchor: ClockAnchor | undefined;
  const subscription = createCheckoutSubscription({
    context,
    client: {
      openEvents: () => {
        const socket = new FakeSocket();
        sockets.push(socket);

        return socket;
      },
    },
    environment,
    monotonicNow: () => 500,
    getSnapshot: () => snapshot,
    applySnapshot: (nextSnapshot, anchor) => {
      appliedAnchor = anchor;
      snapshot = nextSnapshot;
    },
    onRelatedDataChanged: () => {
      relatedDataChanges += 1;
    },
  });

  return {
    context,
    environment,
    get appliedAnchor() {
      return appliedAnchor;
    },
    get relatedDataChanges() {
      return relatedDataChanges;
    },
    get socket() {
      const socket = sockets.at(-1);
      if (!socket) {
        throw new Error("Expected an opened socket");
      }

      return socket;
    },
    get socketCount() {
      return sockets.length;
    },
    applySnapshot(nextSnapshot: CheckoutSnapshot) {
      snapshot = nextSnapshot;
    },
    get snapshot() {
      return snapshot;
    },
    subscription,
  };
}

describe("checkout realtime subscription", () => {
  test("parses and applies a newer realtime snapshot", () => {
    const harness = createHarness();
    const newer = checkoutSnapshotFixture({ revision: 3 });
    harness.subscription.start();
    harness.socket.emit("open");

    harness.socket.emit("message", realtimeEvent(newer));

    expect(harness.snapshot).toEqual(newer);
    expect(harness.appliedAnchor).toEqual({
      serverEpochAtAnchorMs: 1_785_171_600_000,
      monotonicAtAnchorMs: 500,
      requestStartedAtMonotonicMs: 500,
      expiresAtEpochMs: 1_785_171_690_000,
    });
    expect(harness.relatedDataChanges).toBe(1);
  });

  test("ignores malformed and stale realtime messages", () => {
    const harness = createHarness();
    harness.subscription.start();
    harness.socket.emit("open");

    harness.socket.emit("message", "{not-json");
    harness.socket.emit(
      "message",
      realtimeEvent(checkoutSnapshotFixture({ revision: 2 })),
    );

    expect(harness.snapshot.session.revision).toBe(2);
    expect(harness.relatedDataChanges).toBe(0);
  });

  test("stops when an equal realtime event follows a terminal HTTP snapshot", () => {
    const harness = createHarness();
    const terminal = checkoutSnapshotFixture({
      revision: 3,
      status: "completed",
      phase: "completed",
    });
    harness.subscription.start();
    harness.socket.emit("open");
    harness.applySnapshot(terminal);

    harness.socket.emit("message", realtimeEvent(terminal));

    expect(harness.socket.closed).toBe(true);
    expect(harness.subscription.getStatus()).toBe("stopped");
  });

  test("stops when a reconnect timer sees a terminal HTTP snapshot", () => {
    const harness = createHarness();
    const terminal = checkoutSnapshotFixture({
      revision: 3,
      status: "completed",
      phase: "completed",
    });
    harness.subscription.start();
    harness.socket.emit("open");
    harness.socket.emit("close");
    harness.applySnapshot(terminal);

    harness.environment.runNext(1_000);

    expect(harness.socketCount).toBe(1);
    expect(harness.subscription.getStatus()).toBe("stopped");
  });

  test("reconnects once after the fixed delay", () => {
    const harness = createHarness();
    harness.subscription.start();
    harness.socket.emit("open");
    const failedSocket = harness.socket;

    failedSocket.emit("error");
    failedSocket.emit("close");
    failedSocket.emit("error");

    expect(failedSocket.closed).toBe(true);
    expect(harness.environment.scheduledDelays()).toEqual([1_000]);
    harness.environment.runNext(1_000);
    expect(harness.socketCount).toBe(2);
  });
});
