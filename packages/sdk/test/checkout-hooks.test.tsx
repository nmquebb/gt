import { afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { act } from "react-test-renderer";
import type {
  CheckoutClient,
  CheckoutClientContext,
} from "../src/clients/checkout.client";
import {
  applyCheckoutState,
  getCheckoutState,
} from "../src/cache/checkout-cache";
import { CheckoutClientError } from "../src/clients/client.errors";
import {
  useAcceptCheckoutOffer,
  usePurchaseCheckout,
} from "../src/react/use-checkout-commands";
import { checkoutSnapshotFixture, clockAnchorFixture } from "./fixtures";
import { createReactTestHarness } from "../test-utils/react-test-renderer";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const queryClients: QueryClient[] = [];

const { render } = createReactTestHarness();

afterEach(async () => {
  for (const queryClient of queryClients.splice(0)) {
    queryClient.clear();
  }
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
}: {
  children: ReactElement;
  queryClient: QueryClient;
}) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
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
    const initialState = {
      snapshot: initialSnapshot,
      clockAnchor: clockAnchorFixture(initialSnapshot),
    };
    const queryClient = createQueryClient();
    applyCheckoutState(queryClient, context.sessionId, initialState);
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
        children: (
          <AcceptHook client={client} onRender={(next) => (mutation = next)} />
        ),
      }),
    );

    await act(async () => {
      await mutation.mutateAsync(1);
      await flushObserverNotifications();
    });

    expect(getCheckoutState(queryClient, context.sessionId)).toEqual({
      snapshot: acceptedSnapshot,
      clockAnchor: acceptedAnchor,
    });
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
    const initialState = {
      snapshot: initialSnapshot,
      clockAnchor: clockAnchorFixture(initialSnapshot),
    };
    const queryClient = createQueryClient();
    applyCheckoutState(queryClient, context.sessionId, initialState);
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
    expect(getCheckoutState(queryClient, context.sessionId)).toEqual({
      snapshot: conflictSnapshot,
      clockAnchor: conflictAnchor,
    });
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
    const initialState = {
      snapshot: initialSnapshot,
      clockAnchor: initialAnchor,
    };
    const queryClient = createQueryClient();
    applyCheckoutState(queryClient, context.sessionId, initialState);
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
        children: (
          <AcceptHook client={client} onRender={(next) => (mutation = next)} />
        ),
      }),
    );

    await act(async () => {
      await mutation.mutateAsync(1);
      await flushObserverNotifications();
    });

    expect(getCheckoutState(queryClient, context.sessionId)).toEqual({
      snapshot: initialSnapshot,
      clockAnchor: refreshedAnchor,
    });
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
    const initialSnapshot = checkoutSnapshotFixture({ revision: 1 });
    const queryClient = createQueryClient();
    applyCheckoutState(queryClient, context.sessionId, {
      snapshot: initialSnapshot,
      clockAnchor: clockAnchorFixture(initialSnapshot),
    });
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
    expect(getCheckoutState(queryClient, context.sessionId)?.snapshot).toEqual(
      completedSnapshot,
    );
    expect(
      getCheckoutState(queryClient, context.sessionId)?.clockAnchor,
    ).toEqual(completedAnchor);
    expectQueryInvalidated(
      queryClient,
      ["checkout-activity", context.sessionId],
      true,
    );
    expectQueryInvalidated(queryClient, ["listings"], true);
  });
});
