import { expect, test } from "bun:test";
import {
  createCheckoutClient,
  type CheckoutClientContext,
  type CheckoutSnapshot,
} from "@checkout/sdk";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CheckoutSummary } from "./checkout-summary";
import {
  CheckoutScreenProvider,
  type CheckoutScreenRuntime,
} from "@/lib/checkout-screen-context";
import { createReactTestHarness } from "@checkout/sdk/test-utils/react-test-renderer";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const { render } = createReactTestHarness();

const context: CheckoutClientContext = {
  deviceId: "web_1",
  resumeToken: "secret",
  sessionId: "chk_1",
  surface: "web",
};

function checkoutSummaryElement(runtime: CheckoutScreenRuntime) {
  const queryClient = new QueryClient();
  return (
    <QueryClientProvider client={queryClient}>
      <CheckoutScreenProvider value={runtime}>
        <CheckoutSummary />
      </CheckoutScreenProvider>
    </QueryClientProvider>
  );
}

test("does not offer price acceptance when a terminal snapshot has no allowed actions", async () => {
  const snapshot = {
    serverNow: "2026-07-27T17:00:00.000Z",
    session: {
      id: "chk_terminal",
      revision: 2,
      createdAt: "2026-07-27T16:59:00.000Z",
      updatedAt: "2026-07-27T17:00:00.000Z",
      event: {
        name: "Chicago Bears vs. Green Bay Packers",
        venue: "Soldier Field",
        timeLabel: "Sunday at 12:00 PM",
        isDemo: true,
      },
      listing: {
        id: "lst_101_a_1",
        section: "101",
        row: "A",
        seat: "1",
      },
      inventoryHold: { expiresAt: "2026-07-27T17:01:30.000Z" },
      offer: {
        currency: "USD",
        currentVersion: 2,
        currentTotalCents: 13_500,
        acceptedVersion: 1,
        acceptedTotalCents: 12_500,
      },
      phase: "completed",
      payment: { status: "succeeded" },
      order: {
        id: "ord_1",
        completedAt: "2026-07-27T17:00:00.000Z",
        completedByDeviceId: "web_device",
      },
    },
    allowedActions: [],
    status: "completed",
  } satisfies CheckoutSnapshot;
  const checkout = {
    snapshot,
    clockAnchor: {
      serverEpochAtAnchorMs: Date.parse(snapshot.serverNow),
      monotonicAtAnchorMs: 1_000,
      requestStartedAtMonotonicMs: 900,
      expiresAtEpochMs: Date.parse(snapshot.session.inventoryHold.expiresAt),
    },
  };
  const runtime = {
    checkout,
    client: createCheckoutClient({
      baseUrl: "https://checkout.test",
      fetch: globalThis.fetch,
      monotonicNow: () => 1_000,
    }),
    context: { ...context, sessionId: snapshot.session.id },
    isInteractive: false,
    realtimeStatus: "stopped",
  } satisfies CheckoutScreenRuntime;

  const renderer = await render(checkoutSummaryElement(runtime));
  const html = JSON.stringify(renderer.toJSON());

  expect(html).not.toContain("Accept new price");
});

test("offers price acceptance when the server allows accept_offer", async () => {
  const snapshot = {
    serverNow: "2026-07-27T17:00:00.000Z",
    session: {
      id: "chk_offer",
      revision: 2,
      createdAt: "2026-07-27T16:59:00.000Z",
      updatedAt: "2026-07-27T17:00:00.000Z",
      event: {
        name: "Chicago Bears vs. Green Bay Packers",
        venue: "Soldier Field",
        timeLabel: "Sunday at 12:00 PM",
        isDemo: true,
      },
      listing: {
        id: "lst_101_a_1",
        section: "101",
        row: "A",
        seat: "1",
      },
      inventoryHold: { expiresAt: "2026-07-27T17:01:30.000Z" },
      offer: {
        currency: "USD",
        currentVersion: 2,
        currentTotalCents: 13_500,
        acceptedVersion: 1,
        acceptedTotalCents: 12_500,
      },
      phase: "active",
      payment: { status: "idle" },
    },
    allowedActions: ["accept_offer"],
    status: "offer_review_required",
  } satisfies CheckoutSnapshot;
  const checkout = {
    snapshot,
    clockAnchor: {
      serverEpochAtAnchorMs: Date.parse(snapshot.serverNow),
      monotonicAtAnchorMs: 1_000,
      requestStartedAtMonotonicMs: 900,
      expiresAtEpochMs: Date.parse(snapshot.session.inventoryHold.expiresAt),
    },
  };
  const runtime = {
    checkout,
    client: createCheckoutClient({
      baseUrl: "https://checkout.test",
      fetch: globalThis.fetch,
      monotonicNow: () => 1_000,
    }),
    context: { ...context, sessionId: snapshot.session.id },
    isInteractive: false,
    realtimeStatus: "connected",
  } satisfies CheckoutScreenRuntime;

  const renderer = await render(checkoutSummaryElement(runtime));
  const html = JSON.stringify(renderer.toJSON());

  expect(html).toContain("Accept new price");
});
