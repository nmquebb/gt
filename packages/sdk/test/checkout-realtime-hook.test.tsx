import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useMemo } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import type {
  CheckoutClientContext,
  RealtimeSocket,
  RealtimeSocketEvent,
} from "../src/clients/checkout.client";
import type { CheckoutSnapshot } from "../src/contracts";
import { CheckoutProvider } from "../src/react/checkout-provider";
import { useCheckoutRealtime } from "../src/react/use-checkout-realtime";
import type { RealtimeEnvironment } from "../src/realtime/checkout-subscription";
import { createCheckoutStore } from "../src/stores/checkout/checkout.store";
import { checkoutSnapshotFixture, clockAnchorFixture } from "./fixtures";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const originalConsoleError = console.error;
const renderers: ReactTestRenderer[] = [];

beforeAll(() => {
  console.error = (message?: unknown, ...arguments_: unknown[]) => {
    if (
      message ===
      "react-test-renderer is deprecated. See https://react.dev/warnings/react-test-renderer"
    ) {
      return;
    }
    originalConsoleError(message, ...arguments_);
  };
});

afterEach(async () => {
  await act(async () => {
    for (const renderer of renderers.splice(0)) {
      renderer.unmount();
    }
  });
});

afterAll(() => {
  console.error = originalConsoleError;
});

class FakeEnvironment implements RealtimeEnvironment {
  private nextTimerId = 1;
  private readonly timers = new Map<number, () => void>();

  setTimeout(callback: () => void): number {
    const timerId = this.nextTimerId++;
    this.timers.set(timerId, callback);

    return timerId;
  }

  clearTimeout(handle: unknown): void {
    if (typeof handle === "number") {
      this.timers.delete(handle);
    }
  }

  get activeTimerCount(): number {
    return this.timers.size;
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

function monotonicNow(): number {
  return 500;
}

function RealtimeStatus({
  context,
  environment,
  socket,
}: {
  context: CheckoutClientContext;
  environment: RealtimeEnvironment;
  socket: FakeSocket;
}) {
  const client = useMemo(() => ({ openEvents: () => socket }), [socket]);
  const status = useCheckoutRealtime({
    client,
    context,
    environment,
    monotonicNow,
  });

  return <span>{status}</span>;
}

function DefaultEnvironmentRealtimeStatus({
  context,
  socket,
}: {
  context: CheckoutClientContext;
  socket: FakeSocket;
}) {
  const client = useMemo(() => ({ openEvents: () => socket }), [socket]);
  const status = useCheckoutRealtime({
    client,
    context,
    monotonicNow,
  });

  return <span>{status}</span>;
}

function renderedStatus(renderer: ReactTestRenderer): string {
  const output = renderer.toJSON();
  if (output === null || Array.isArray(output) || typeof output === "string") {
    throw new Error("Expected one rendered status element");
  }
  const status = output.children?.[0];
  if (typeof status !== "string") {
    throw new Error("Expected rendered status text");
  }

  return status;
}

test("stops reconnecting for terminal snapshots", async () => {
  const initial = checkoutSnapshotFixture({ revision: 2 });
  const terminal = checkoutSnapshotFixture({
    revision: 3,
    status: "completed",
    phase: "completed",
    allowedActions: [],
    payment: { status: "succeeded" },
  });
  const context: CheckoutClientContext = {
    sessionId: initial.session.id,
    resumeToken: "resume-token",
    surface: "web",
    deviceId: "web_1",
  };
  const environment = new FakeEnvironment();
  const socket = new FakeSocket();
  const store = createCheckoutStore({
    snapshot: initial,
    clockAnchor: clockAnchorFixture(initial),
  });
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <QueryClientProvider client={queryClient}>
        <CheckoutProvider store={store}>
          <RealtimeStatus
            context={context}
            environment={environment}
            socket={socket}
          />
        </CheckoutProvider>
      </QueryClientProvider>,
    );
  });
  renderers.push(renderer);
  await act(async () => {
    socket.emit("open");
    socket.emit("message", realtimeEvent(terminal));
    socket.emit("close");
  });

  expect(store.getState().snapshot).toEqual(terminal);
  expect(renderedStatus(renderer)).toBe("stopped");
  expect(environment.activeTimerCount).toBe(0);
});

test("uses the default timer environment when a socket disconnects", async () => {
  const initial = checkoutSnapshotFixture({ revision: 1 });
  const context: CheckoutClientContext = {
    sessionId: initial.session.id,
    resumeToken: "resume-token",
    surface: "mobile",
    deviceId: "mobile_1",
  };
  const socket = new FakeSocket();
  const store = createCheckoutStore({
    snapshot: initial,
    clockAnchor: clockAnchorFixture(initial),
  });
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <QueryClientProvider client={queryClient}>
        <CheckoutProvider store={store}>
          <DefaultEnvironmentRealtimeStatus context={context} socket={socket} />
        </CheckoutProvider>
      </QueryClientProvider>,
    );
  });
  renderers.push(renderer);

  await act(async () => {
    socket.emit("close");
  });

  expect(renderedStatus(renderer)).toBe("disconnected");
});
