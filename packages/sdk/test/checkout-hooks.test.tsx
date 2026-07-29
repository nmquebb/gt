import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import type {
  CheckoutClient,
  CheckoutClientContext,
} from "../src/clients/checkout.client";
import { CheckoutClientError } from "../src/clients/client.errors";
import { CheckoutProvider } from "../src/react/checkout-provider";
import {
  useAcceptCheckoutOffer,
  usePurchaseCheckout,
} from "../src/react/use-checkout-commands";
import { createCheckoutStore } from "../src/stores/checkout/checkout.store";
import { checkoutSnapshotFixture, clockAnchorFixture } from "./fixtures";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const originalConsoleError = console.error;
const renderers: ReactTestRenderer[] = [];
const queryClients: QueryClient[] = [];

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
  for (const queryClient of queryClients.splice(0)) {
    queryClient.clear();
  }
});

afterAll(() => {
  console.error = originalConsoleError;
});

const context: CheckoutClientContext = {
  sessionId: "chk_1",
  resumeToken: "resume-token",
  surface: "web",
  deviceId: "web_1",
};

function createQueryClient(): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  queryClients.push(queryClient);

  return queryClient;
}

async function render(element: ReactElement): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(element);
  });
  renderers.push(renderer);

  return renderer;
}

function seedRelatedQueries(queryClient: QueryClient): void {
  queryClient.setQueryData(
    ["checkout-activity", context.sessionId],
    ["cached activity"],
  );
  queryClient.setQueryData(["listings"], ["cached listing"]);
}

function expectQueryInvalidated(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  expected: boolean,
): void {
  expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(expected);
}

async function flushObserverNotifications(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

type AcceptMutation = ReturnType<typeof useAcceptCheckoutOffer>;

function AcceptHook({
  client,
  onRender,
}: {
  client: Pick<CheckoutClient, "acceptOffer">;
  onRender: (mutation: AcceptMutation) => void;
}) {
  onRender(useAcceptCheckoutOffer(client, context));

  return null;
}

type PurchaseMutation = ReturnType<typeof usePurchaseCheckout>;

function PurchaseHook({
  client,
  createIdempotencyKey,
  onRender,
}: {
  client: Pick<CheckoutClient, "purchase">;
  createIdempotencyKey: () => string;
  onRender: (mutation: PurchaseMutation) => void;
}) {
  onRender(usePurchaseCheckout(client, context, createIdempotencyKey));

  return null;
}

function providers({
  children,
  queryClient,
  store,
}: {
  children: ReactElement;
  queryClient: QueryClient;
  store: ReturnType<typeof createCheckoutStore>;
}) {
  return (
    <QueryClientProvider client={queryClient}>
      <CheckoutProvider store={store}>{children}</CheckoutProvider>
    </QueryClientProvider>
  );
}

describe("checkout command React hooks", () => {
  test("a successful offer acceptance applies canonical state and invalidates activity", async () => {
    const initialSnapshot = checkoutSnapshotFixture({
      revision: 1,
      status: "offer_review_required",
      allowedActions: ["accept_offer"],
    });
    const acceptedSnapshot = checkoutSnapshotFixture({
      revision: 2,
      status: "ready",
      allowedActions: ["purchase"],
    });
    const acceptedAnchor = clockAnchorFixture(acceptedSnapshot, {
      requestStartedAtMonotonicMs: 200,
    });
    const store = createCheckoutStore({
      snapshot: initialSnapshot,
      clockAnchor: clockAnchorFixture(initialSnapshot),
    });
    const queryClient = createQueryClient();
    seedRelatedQueries(queryClient);
    let mutation!: AcceptMutation;
    const client = {
      acceptOffer: async () => ({
        snapshot: acceptedSnapshot,
        clockAnchor: acceptedAnchor,
      }),
    };
    await render(
      providers({
        queryClient,
        store,
        children: (
          <AcceptHook client={client} onRender={(next) => (mutation = next)} />
        ),
      }),
    );

    await act(async () => {
      await mutation.mutateAsync(1);
      await flushObserverNotifications();
    });

    expect(store.getState().snapshot).toBe(acceptedSnapshot);
    expect(store.getState().clockAnchor).toBe(acceptedAnchor);
    expectQueryInvalidated(
      queryClient,
      ["checkout-activity", context.sessionId],
      true,
    );
    expectQueryInvalidated(queryClient, ["listings"], false);
  });

  test("a thrown conflict becomes the mutation error and applies its snapshot", async () => {
    const initialSnapshot = checkoutSnapshotFixture({ revision: 1 });
    const conflictSnapshot = checkoutSnapshotFixture({
      revision: 3,
      status: "offer_review_required",
      allowedActions: ["accept_offer"],
    });
    const conflictAnchor = clockAnchorFixture(conflictSnapshot, {
      requestStartedAtMonotonicMs: 300,
    });
    const store = createCheckoutStore({
      snapshot: initialSnapshot,
      clockAnchor: clockAnchorFixture(initialSnapshot),
    });
    const queryClient = createQueryClient();
    seedRelatedQueries(queryClient);
    let mutation!: AcceptMutation;
    const error = new CheckoutClientError(
      "OFFER_VERSION_MISMATCH",
      "The offer has changed.",
      conflictSnapshot,
      conflictAnchor,
    );
    const client = {
      acceptOffer: async () => {
        throw error;
      },
    };
    await render(
      providers({
        queryClient,
        store,
        children: (
          <AcceptHook client={client} onRender={(next) => (mutation = next)} />
        ),
      }),
    );

    await act(async () => {
      await mutation.mutateAsync(1).catch(() => undefined);
      await flushObserverNotifications();
    });

    expect(mutation.error).toBeInstanceOf(CheckoutClientError);
    expect(mutation.error).toBe(error);
    expect(store.getState().snapshot).toBe(conflictSnapshot);
    expect(store.getState().clockAnchor).toBe(conflictAnchor);
    expectQueryInvalidated(
      queryClient,
      ["checkout-activity", context.sessionId],
      false,
    );
  });

  test("an equal-revision response refreshes only the clock anchor", async () => {
    const initialSnapshot = checkoutSnapshotFixture({ revision: 4 });
    const responseSnapshot = checkoutSnapshotFixture({ revision: 4 });
    const initialAnchor = clockAnchorFixture(initialSnapshot, {
      requestStartedAtMonotonicMs: 50,
    });
    const refreshedAnchor = clockAnchorFixture(responseSnapshot, {
      monotonicAtAnchorMs: 500,
      requestStartedAtMonotonicMs: 400,
    });
    const store = createCheckoutStore({
      snapshot: initialSnapshot,
      clockAnchor: initialAnchor,
    });
    const queryClient = createQueryClient();
    seedRelatedQueries(queryClient);
    let mutation!: AcceptMutation;
    const client = {
      acceptOffer: async () => ({
        snapshot: responseSnapshot,
        clockAnchor: refreshedAnchor,
      }),
    };
    await render(
      providers({
        queryClient,
        store,
        children: (
          <AcceptHook client={client} onRender={(next) => (mutation = next)} />
        ),
      }),
    );

    await act(async () => {
      await mutation.mutateAsync(1);
      await flushObserverNotifications();
    });

    expect(store.getState().snapshot).toBe(initialSnapshot);
    expect(store.getState().clockAnchor).toBe(refreshedAnchor);
  });

  test("each purchase mutation gets one new key and successful purchases invalidate related queries", async () => {
    const keys = [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ];
    const observedKeys: string[] = [];
    const completedSnapshot = checkoutSnapshotFixture({
      revision: 2,
      status: "completed",
      phase: "completed",
      allowedActions: [],
      payment: { status: "succeeded" },
    });
    const completedAnchor = clockAnchorFixture(completedSnapshot, {
      requestStartedAtMonotonicMs: 200,
    });
    const store = createCheckoutStore({
      snapshot: checkoutSnapshotFixture({ revision: 1 }),
      clockAnchor: clockAnchorFixture(checkoutSnapshotFixture({ revision: 1 })),
    });
    const queryClient = createQueryClient();
    seedRelatedQueries(queryClient);
    let mutation!: PurchaseMutation;
    let attempts = 0;
    const client = {
      purchase: async (
        _context: CheckoutClientContext,
        idempotencyKey: string,
      ) => {
        observedKeys.push(idempotencyKey);
        attempts += 1;
        if (attempts === 1) {
          throw new CheckoutClientError(
            "NETWORK_UNAVAILABLE",
            "purchase could not reach the API.",
          );
        }

        return {
          snapshot: completedSnapshot,
          clockAnchor: completedAnchor,
          disposition: "completed" as const,
          duplicatePrevented: false,
        };
      },
    };
    await render(
      providers({
        queryClient,
        store,
        children: (
          <PurchaseHook
            client={client}
            createIdempotencyKey={() => {
              const key = keys.shift();
              if (!key) {
                throw new Error("No idempotency key remains");
              }
              return key;
            }}
            onRender={(next) => (mutation = next)}
          />
        ),
      }),
    );

    await act(async () => {
      await mutation.mutateAsync().catch(() => undefined);
      await flushObserverNotifications();
    });
    expect(mutation.error).toBeInstanceOf(CheckoutClientError);

    await act(async () => {
      await mutation.mutateAsync();
      await flushObserverNotifications();
    });

    expect(observedKeys).toEqual([
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ]);
    expect(store.getState().snapshot).toBe(completedSnapshot);
    expectQueryInvalidated(
      queryClient,
      ["checkout-activity", context.sessionId],
      true,
    );
    expectQueryInvalidated(queryClient, ["listings"], true);
  });
});
