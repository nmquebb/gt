import type {
  CheckoutClient,
  CheckoutClientContext,
  RealtimeSocket,
} from "../clients/checkout.client";
import {
  createRealtimeClockAnchor,
  type ClockAnchor,
} from "../clients/clock-anchor";
import {
  CheckoutSessionUpdatedEventSchema,
  type CheckoutSnapshot,
} from "../contracts";

const RECONNECT_DELAY_MS = 1_000;

export type RealtimeStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "disconnected"
  | "stopped";

export interface RealtimeEnvironment {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface CheckoutSubscription {
  start(): void;
  stop(): void;
  getStatus(): RealtimeStatus;
  subscribeStatus(listener: (status: RealtimeStatus) => void): () => void;
}

interface CheckoutSubscriptionOptions {
  context: CheckoutClientContext;
  client: Pick<CheckoutClient, "openEvents">;
  environment: RealtimeEnvironment;
  monotonicNow: () => number;
  getSnapshot: () => CheckoutSnapshot;
  applySnapshot: (snapshot: CheckoutSnapshot, clockAnchor: ClockAnchor) => void;
  onRelatedDataChanged: () => void;
}

function isTerminal(snapshot: CheckoutSnapshot): boolean {
  return (
    snapshot.status === "completed" ||
    snapshot.status === "expired" ||
    snapshot.status === "abandoned"
  );
}

function parseRealtimeEvent(data: unknown) {
  if (typeof data !== "string") {
    return undefined;
  }
  try {
    const parsed = CheckoutSessionUpdatedEventSchema.safeParse(
      JSON.parse(data) as unknown,
    );

    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export function createCheckoutSubscription({
  context,
  client,
  environment,
  monotonicNow,
  getSnapshot,
  applySnapshot,
  onRelatedDataChanged,
}: CheckoutSubscriptionOptions): CheckoutSubscription {
  let started = false;
  let status: RealtimeStatus = "idle";
  let socket: RealtimeSocket | undefined;
  let reconnectTimer: unknown;
  const statusListeners = new Set<(nextStatus: RealtimeStatus) => void>();

  function setStatus(nextStatus: RealtimeStatus): void {
    if (status === nextStatus) {
      return;
    }
    status = nextStatus;
    for (const listener of statusListeners) {
      listener(nextStatus);
    }
  }

  function clearReconnectTimer(): void {
    if (reconnectTimer === undefined) {
      return;
    }
    environment.clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
  }

  function stop(): void {
    const activeSocket = socket;
    started = false;
    socket = undefined;
    clearReconnectTimer();
    activeSocket?.close();
    setStatus("stopped");
  }

  function reconnect(): void {
    if (!started) {
      return;
    }
    const disconnectedSocket = socket;
    socket = undefined;
    disconnectedSocket?.close();
    if (isTerminal(getSnapshot())) {
      stop();
      return;
    }
    setStatus("disconnected");
    if (reconnectTimer !== undefined) {
      return;
    }
    reconnectTimer = environment.setTimeout(() => {
      reconnectTimer = undefined;
      connect();
    }, RECONNECT_DELAY_MS);
  }

  function connect(): void {
    if (!started || socket !== undefined) {
      return;
    }
    if (isTerminal(getSnapshot())) {
      stop();
      return;
    }
    setStatus("connecting");

    let nextSocket: RealtimeSocket;
    try {
      nextSocket = client.openEvents(context);
    } catch {
      reconnect();
      return;
    }
    socket = nextSocket;

    function isCurrentSocket(): boolean {
      return started && socket === nextSocket;
    }

    nextSocket.addEventListener("open", () => {
      if (isCurrentSocket()) {
        setStatus("connected");
      }
    });
    nextSocket.addEventListener("message", ({ data }) => {
      if (!isCurrentSocket()) {
        return;
      }
      if (isTerminal(getSnapshot())) {
        stop();
        return;
      }
      const event = parseRealtimeEvent(data);
      if (!event || event.snapshot.session.id !== context.sessionId) {
        return;
      }
      if (event.snapshot.session.revision <= getSnapshot().session.revision) {
        return;
      }
      applySnapshot(
        event.snapshot,
        createRealtimeClockAnchor(event.snapshot, monotonicNow()),
      );
      onRelatedDataChanged();
      if (isTerminal(getSnapshot())) {
        stop();
      }
    });
    nextSocket.addEventListener("close", () => {
      if (isCurrentSocket()) {
        reconnect();
      }
    });
    nextSocket.addEventListener("error", () => {
      if (isCurrentSocket()) {
        reconnect();
      }
    });
  }

  function start(): void {
    if (started) {
      return;
    }
    if (isTerminal(getSnapshot())) {
      setStatus("stopped");
      return;
    }
    started = true;
    connect();
  }

  return {
    start,
    stop,
    getStatus: () => status,
    subscribeStatus(listener) {
      statusListeners.add(listener);
      return () => {
        statusListeners.delete(listener);
      };
    },
  };
}
