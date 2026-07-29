import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  mock,
  test,
} from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { act, create, type ReactTestInstance } from "react-test-renderer";
import type {
  CheckoutClient,
  CheckoutClientContext,
  CheckoutCommandResult,
  CheckoutSessionUpdatedEvent,
  CheckoutSnapshot,
  RealtimeSocket,
  RealtimeSocketEvent,
} from "@checkout/sdk";

type NavigationListener = () => void;
type CheckoutScreenClient = Pick<
  CheckoutClient,
  "acceptOffer" | "leave" | "openEvents" | "purchase"
>;

let beforeRemoveListener: NavigationListener | undefined;
let leaveCalls: CheckoutClientContext[] = [];

function textContent(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(textContent).join("");
  }
  if (typeof value === "object" && value !== null && "children" in value) {
    return textContent((value as { children?: unknown }).children);
  }
  if (typeof value === "object" && value !== null && "props" in value) {
    return textContent(
      (value as { props?: { children?: unknown } }).props?.children,
    );
  }

  return "";
}

void mock.module("react-native", () => ({
  AppState: {
    currentState: "active",
    addEventListener: () => ({ remove: () => undefined }),
  },
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  StyleSheet: { create: <T>(styles: T) => styles },
  Text: "Text",
  View: "View",
}));

void mock.module("expo-router", () => ({
  useNavigation: () => ({
    addListener: (event: string, listener: NavigationListener) => {
      if (event === "beforeRemove") {
        beforeRemoveListener = listener;
      }

      return () => {
        if (beforeRemoveListener === listener) {
          beforeRemoveListener = undefined;
        }
      };
    },
    dispatch: () => undefined,
  }),
}));

void mock.module("expo-crypto", () => ({
  randomUUID: () => "purchase-key",
}));

const { CheckoutScreen } = await import("./checkout-screen");

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const originalConsoleError = console.error;

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

afterAll(() => {
  console.error = originalConsoleError;
});

beforeEach(() => {
  beforeRemoveListener = undefined;
  leaveCalls = [];
});

const context: CheckoutClientContext = {
  deviceId: "mobile_1",
  resumeToken: "token_1",
  sessionId: "chk_1",
  surface: "mobile",
};

const activeSnapshot: CheckoutSnapshot = {
  serverNow: "2026-07-29T17:00:00.000Z",
  session: {
    id: "chk_1",
    revision: 1,
    createdAt: "2026-07-29T16:59:00.000Z",
    updatedAt: "2026-07-29T17:00:00.000Z",
    event: {
      name: "Chicago Bears vs. Green Bay Packers",
      venue: "Soldier Field",
      timeLabel: "Sunday at 12:00 PM",
      isDemo: true,
    },
    listing: { id: "lst_1", section: "101", row: "A", seat: "1" },
    inventoryHold: { expiresAt: "2026-07-29T17:01:30.000Z" },
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

const initialResult: CheckoutCommandResult = {
  snapshot: activeSnapshot,
  clockAnchor: {
    expiresAtEpochMs: Date.parse(
      activeSnapshot.session.inventoryHold.expiresAt,
    ),
    monotonicAtAnchorMs: performance.now(),
    requestStartedAtMonotonicMs: performance.now() - 10,
    serverEpochAtAnchorMs: Date.parse(activeSnapshot.serverNow),
  },
};

const completedSnapshot: CheckoutSnapshot = {
  ...activeSnapshot,
  serverNow: "2026-07-29T17:00:05.000Z",
  session: {
    ...activeSnapshot.session,
    revision: 2,
    updatedAt: "2026-07-29T17:00:05.000Z",
    phase: "completed",
    payment: { status: "succeeded" },
    order: {
      id: "ord_1",
      completedAt: "2026-07-29T17:00:05.000Z",
      completedByDeviceId: "mobile_1",
    },
  },
  allowedActions: [],
  status: "completed",
};

const completedEvent: CheckoutSessionUpdatedEvent = {
  type: "checkout_session_updated",
  cause: "completed",
  snapshot: completedSnapshot,
};

type SocketEventType = "open" | "message" | "close" | "error";

class TestSocket implements RealtimeSocket {
  private readonly listeners = new Map<
    SocketEventType,
    Set<(event: RealtimeSocketEvent) => void>
  >();

  addEventListener(
    type: SocketEventType,
    listener: (event: RealtimeSocketEvent) => void,
  ): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  close(): void {}

  message(event: CheckoutSessionUpdatedEvent): void {
    for (const listener of this.listeners.get("message") ?? []) {
      listener({ data: JSON.stringify(event) });
    }
  }
}

function findText(
  root: ReactTestInstance,
  expected: string | RegExp,
): ReactTestInstance | undefined {
  return root.findAll(
    (instance) => {
      if (String(instance.type) !== "Text") {
        return false;
      }
      const text = textContent(instance.props.children);

      return typeof expected === "string"
        ? text === expected
        : expected.test(text);
    },
    { deep: true },
  )[0];
}

function renderCheckoutScreen({
  client,
  context: checkoutContext,
  initialResult: resumed,
}: {
  client: CheckoutScreenClient;
  context: CheckoutClientContext;
  initialResult: CheckoutCommandResult;
}) {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  let renderer: ReturnType<typeof create>;

  act(() => {
    renderer = create(
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(CheckoutScreen, {
          client,
          context: checkoutContext,
          initialResult: resumed,
        }),
      ),
    );
  });

  return {
    flush: async () => {
      await act(async () => {
        await Promise.resolve();
      });
    },
    getByText: (expected: string | RegExp) => {
      const match = findText(renderer.root, expected);
      if (match === undefined) {
        throw new Error(`Could not find rendered text ${String(expected)}`);
      }

      return match;
    },
    getButtonByText: (expected: string) => {
      const match = renderer.root.findAll(
        (instance) =>
          String(instance.type) === "Pressable" &&
          textContent(instance.props.children) === expected,
        { deep: true },
      )[0];
      if (match === undefined) {
        throw new Error(`Could not find button text ${expected}`);
      }

      return match;
    },
    unmount: async () => {
      await act(async () => {
        renderer.unmount();
      });
      queryClient.clear();
    },
  };
}

function createClient(socket: TestSocket): CheckoutScreenClient {
  return {
    acceptOffer: async () => initialResult,
    leave: async (leftContext) => {
      leaveCalls.push(leftContext);
      throw new Error("best-effort leave failed");
    },
    openEvents: () => socket,
    purchase: async () => ({
      ...initialResult,
      disposition: "completed",
      duplicatePrevented: false,
    }),
  };
}

test("renders resumed checkout and applies a realtime completion", async () => {
  const socket = new TestSocket();
  const client = createClient(socket);
  const rendered = renderCheckoutScreen({ client, context, initialResult });
  expect(rendered.getByText("Your seat is held")).toBeDefined();

  await act(async () => {
    socket.message(completedEvent);
  });
  await rendered.flush();

  expect(rendered.getByText("You’re going")).toBeDefined();
  expect(rendered.getByText(/Order ord_/)).toBeDefined();
  await rendered.unmount();
});

test("notifies active checkout leave without blocking native navigation", async () => {
  const socket = new TestSocket();
  const client = createClient(socket);
  const rendered = renderCheckoutScreen({ client, context, initialResult });

  expect(beforeRemoveListener).toBeDefined();
  beforeRemoveListener?.();
  expect(leaveCalls).toEqual([context]);

  await rendered.flush();
  await rendered.unmount();
});

test("renders the purchase action authorized by allowedActions", async () => {
  const socket = new TestSocket();
  const client = createClient(socket);
  const rendered = renderCheckoutScreen({
    client,
    context,
    initialResult: {
      ...initialResult,
      snapshot: {
        ...activeSnapshot,
        session: {
          ...activeSnapshot.session,
          payment: { status: "failed" },
        },
        status: "purchase_failed",
      },
    },
  });

  expect(rendered.getButtonByText("Purchase").props.disabled).toBe(false);
  await rendered.unmount();
});

test("disables purchase when the monotonic hold has expired", async () => {
  const socket = new TestSocket();
  const client = createClient(socket);
  const expiresAtEpochMs = Date.parse(
    activeSnapshot.session.inventoryHold.expiresAt,
  );
  const rendered = renderCheckoutScreen({
    client,
    context,
    initialResult: {
      snapshot: activeSnapshot,
      clockAnchor: {
        expiresAtEpochMs,
        monotonicAtAnchorMs: performance.now(),
        requestStartedAtMonotonicMs: performance.now() - 10,
        serverEpochAtAnchorMs: expiresAtEpochMs,
      },
    },
  });

  expect(rendered.getButtonByText("Purchase").props.disabled).toBe(true);
  await rendered.unmount();
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "__mobileCheckoutUuid");
});
