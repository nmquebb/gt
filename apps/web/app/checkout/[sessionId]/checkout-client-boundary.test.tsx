import { afterAll, afterEach, beforeAll, expect, mock, test } from "bun:test";
import {
  CheckoutClientError,
  type CheckoutClient,
  type CheckoutCommandResult,
  type CheckoutSnapshot,
  type ClockHandoff,
} from "@checkout/sdk";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactTestInstance } from "react-test-renderer";
import {
  createReactTestHarness,
  textContent,
} from "@checkout/sdk/test-utils/react-test-renderer";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const { render } = createReactTestHarness();

await mock.module("next/navigation", () => ({
  usePathname: () => "/checkout/chk_1",
  useRouter: () => ({
    push: () => undefined,
    replace: () => undefined,
  }),
  useSearchParams: () => new URLSearchParams("token=token_1"),
}));

const { CheckoutClientBoundary } = await import("./checkout-client-boundary");

const snapshot: CheckoutSnapshot = {
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

const clockHandoff: ClockHandoff = {
  expiresAtEpochMs: Date.parse(snapshot.session.inventoryHold.expiresAt),
  remainingHoldMsAtRender: 90_000,
};

const commandResult: CheckoutCommandResult = {
  snapshot: {
    ...snapshot,
    session: {
      ...snapshot.session,
      revision: 2,
    },
  },
  clockAnchor: {
    serverEpochAtAnchorMs: Date.parse(snapshot.serverNow),
    monotonicAtAnchorMs: 0,
    requestStartedAtMonotonicMs: 0,
    expiresAtEpochMs: Date.parse(snapshot.session.inventoryHold.expiresAt),
  },
};

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalDocument = Object.getOwnPropertyDescriptor(
  globalThis,
  "document",
);
const originalLocalStorage = Object.getOwnPropertyDescriptor(
  globalThis,
  "localStorage",
);

function installBrowser() {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      setInterval: () => 1,
      clearInterval: () => undefined,
      setTimeout: () => 1,
      clearTimeout: () => undefined,
    },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      visibilityState: "visible",
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    },
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: () => "web_test",
      setItem: () => undefined,
    },
  });
}

function restoreGlobal(
  name: "window" | "document" | "localStorage",
  descriptor: PropertyDescriptor | undefined,
) {
  if (descriptor === undefined) {
    Reflect.deleteProperty(globalThis, name);
  } else {
    Object.defineProperty(globalThis, name, descriptor);
  }
}

function controlledClient({
  purchase = () => new Promise<never>(() => undefined),
  resume,
}: {
  purchase?: () => Promise<never>;
  resume: () => Promise<CheckoutCommandResult>;
}) {
  const resumeCommand = mock(resume);
  const purchaseCommand = mock(purchase);
  const openEvents = mock(() => ({
    addEventListener: () => undefined,
    close: () => undefined,
  }));
  const client = {
    resume: resumeCommand,
    purchase: purchaseCommand,
    activity: () => Promise.resolve([]),
    openEvents,
  } as unknown as CheckoutClient;

  return Object.assign(client, {
    openEvents,
    purchase: purchaseCommand,
    resume: resumeCommand,
  });
}

function checkoutBoundaryElement(client: CheckoutClient) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>
      <CheckoutClientBoundary
        apiUrl="https://checkout.test"
        client={client}
        clockHandoff={clockHandoff}
        sessionId={snapshot.session.id}
        snapshot={snapshot}
      />
    </QueryClientProvider>
  );
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise<void>((resolve) => {
      globalThis.setTimeout(resolve, 0);
    });
  });
}

function getByRole(
  root: ReactTestInstance,
  role: string,
  { name }: { name: string },
) {
  const match = root
    .findAll((node) => node.type === role)
    .find((node) => textContent(node).includes(name));
  if (match === undefined) {
    throw new Error(`Unable to find ${role} named ${name}`);
  }

  return match;
}

function getByText(root: ReactTestInstance, text: string) {
  const match = root.findAll((node) => textContent(node) === text)[0];
  if (match === undefined) {
    throw new Error(`Unable to find text ${text}`);
  }

  return match;
}

beforeAll(() => {
  installBrowser();
});

afterEach(() => {
  mock.restore();
});

afterAll(() => {
  restoreGlobal("window", originalWindow);
  restoreGlobal("document", originalDocument);
  restoreGlobal("localStorage", originalLocalStorage);
});

test("resumes the SSR checkout and starts realtime", async () => {
  const resume = Promise.withResolvers<CheckoutCommandResult>();
  const client = controlledClient({
    resume: () => resume.promise,
  });
  const renderer = await render(checkoutBoundaryElement(client));

  expect(client.openEvents).not.toHaveBeenCalled();

  resume.resolve(commandResult);
  await flush();

  expect(client.resume).toHaveBeenCalledWith({
    sessionId: snapshot.session.id,
    resumeToken: "token_1",
    surface: "web",
    deviceId: expect.any(String),
  });
  expect(client.openEvents).toHaveBeenCalledTimes(1);
  expect(getByText(renderer.root, "Your seat is held")).toBeDefined();
});

test("renders the SSR snapshot while browser resume is pending", async () => {
  const resume = Promise.withResolvers<CheckoutCommandResult>();
  const client = controlledClient({
    resume: () => resume.promise,
  });
  const renderer = await render(checkoutBoundaryElement(client));

  expect(
    getByText(renderer.root, "Chicago Bears vs. Green Bay Packers"),
  ).toBeDefined();
  expect(client.openEvents).not.toHaveBeenCalled();

  resume.resolve(commandResult);
  await flush();
});

test("disables explicit leave while a purchase command is pending", async () => {
  const client = controlledClient({
    resume: async () => commandResult,
  });
  const renderer = await render(checkoutBoundaryElement(client));
  await flush();

  const purchase = getByRole(renderer.root, "button", { name: "Purchase" });
  await act(async () => {
    purchase.props.onClick();
    await Promise.resolve();
  });
  await flush();

  expect(
    getByRole(renderer.root, "button", { name: "Back to listings" }).props
      .disabled,
  ).toBe(true);
});

test("shows a retry action when resume fails", async () => {
  const client = controlledClient({
    resume: async () => {
      throw new CheckoutClientError("NETWORK_UNAVAILABLE", "offline");
    },
  });
  const renderer = await render(checkoutBoundaryElement(client));

  await flush();

  expect(
    getByRole(renderer.root, "button", { name: "Retry connection" }),
  ).toBeDefined();
});
