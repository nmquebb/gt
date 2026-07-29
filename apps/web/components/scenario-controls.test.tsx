import { afterAll, beforeAll, expect, test } from "bun:test";
import {
  CheckoutProvider,
  createCheckoutClient,
  createCheckoutStore,
  type CheckoutClientContext,
  type CheckoutSnapshot,
} from "@checkout/sdk";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactTestRenderer } from "react-test-renderer";
import {
  CheckoutScreenProvider,
  type CheckoutScreenRuntime,
} from "@/lib/checkout-screen-context";
import {
  createTestRenderer,
  installTestRendererWarningFilter,
  restoreTestRendererWarningFilter,
} from "@/test-utils/react-test-renderer";
import { ScenarioControls } from "./scenario-controls";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(installTestRendererWarningFilter);
afterAll(restoreTestRendererWarningFilter);

const snapshot = {
  serverNow: "2026-07-28T17:00:00.000Z",
  session: {
    id: "chk_1",
    revision: 1,
    createdAt: "2026-07-28T17:00:00.000Z",
    updatedAt: "2026-07-28T17:00:00.000Z",
    event: {
      name: "Chicago Bears vs. Green Bay Packers",
      venue: "Soldier Field",
      timeLabel: "Sunday at 12:00 PM",
      isDemo: true,
    },
    listing: { id: "lst_101_a_1", section: "101", row: "A", seat: "1" },
    inventoryHold: { expiresAt: "2026-07-28T17:01:30.000Z" },
    offer: {
      currency: "USD",
      currentVersion: 1,
      currentTotalCents: 7_000,
      acceptedVersion: 1,
      acceptedTotalCents: 7_000,
    },
    phase: "active",
    payment: { status: "idle" },
  },
  allowedActions: ["purchase"],
  status: "ready",
} satisfies CheckoutSnapshot;

const context: CheckoutClientContext = {
  sessionId: "chk_1",
  resumeToken: "secret",
  surface: "web",
  deviceId: "web_1",
};

test("renders generic payment outcomes without a reset action", async () => {
  const client = createCheckoutClient({
    baseUrl: "https://checkout.test",
    fetch: globalThis.fetch,
    monotonicNow: () => 1_000,
  });
  const store = createCheckoutStore({
    snapshot,
    clockAnchor: {
      serverEpochAtAnchorMs: Date.parse(snapshot.serverNow),
      monotonicAtAnchorMs: 1_000,
      requestStartedAtMonotonicMs: 900,
      expiresAtEpochMs: Date.parse(snapshot.session.inventoryHold.expiresAt),
    },
  });
  const runtime = {
    client,
    context,
    isInteractive: true,
    realtimeStatus: "connected",
  } satisfies CheckoutScreenRuntime;
  const queryClient = new QueryClient();

  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = createTestRenderer(
      <QueryClientProvider client={queryClient}>
        <CheckoutProvider store={store}>
          <CheckoutScreenProvider value={runtime}>
            <ScenarioControls />
          </CheckoutScreenProvider>
        </CheckoutProvider>
      </QueryClientProvider>,
    );
  });
  const markup = JSON.stringify(renderer.toJSON());

  expect(markup).toContain("Next payment succeeds");
  expect(markup).toContain("Next payment fails");
  expect(markup).not.toContain("Reset checkout");
  await act(async () => renderer.unmount());
  queryClient.clear();
});
