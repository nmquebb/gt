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
import { PurchaseAction } from "./purchase-action";
import {
  CheckoutScreenProvider,
  type CheckoutScreenRuntime,
} from "@/lib/checkout-screen-context";
import {
  createTestRenderer,
  installTestRendererWarningFilter,
  restoreTestRendererWarningFilter,
} from "@/test-utils/react-test-renderer";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(installTestRendererWarningFilter);
afterAll(restoreTestRendererWarningFilter);

const activeSnapshot = {
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
      currentVersion: 2,
      currentTotalCents: 14_500,
      acceptedVersion: 1,
      acceptedTotalCents: 12_500,
    },
    phase: "active",
    payment: { status: "idle" },
  },
  allowedActions: ["accept_offer"],
  status: "offer_review_required",
} satisfies CheckoutSnapshot;

const context: CheckoutClientContext = {
  sessionId: "chk_1",
  resumeToken: "secret",
  surface: "web",
  deviceId: "web_1",
};

function textContent(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(textContent).join("");
  }
  if (typeof value === "object" && value !== null && "props" in value) {
    return textContent(
      (value as { props?: { children?: unknown } }).props?.children,
    );
  }

  return "";
}

async function renderPurchaseAction(snapshot: CheckoutSnapshot) {
  const monotonicNow = performance.now();
  const store = createCheckoutStore({
    snapshot,
    clockAnchor: {
      serverEpochAtAnchorMs: Date.parse(snapshot.serverNow),
      monotonicAtAnchorMs: monotonicNow,
      requestStartedAtMonotonicMs: monotonicNow,
      expiresAtEpochMs: Date.parse(snapshot.session.inventoryHold.expiresAt),
    },
  });
  const client = createCheckoutClient({
    baseUrl: "https://checkout.test",
    fetch: globalThis.fetch,
    monotonicNow: () => monotonicNow,
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
            <PurchaseAction />
          </CheckoutScreenProvider>
        </CheckoutProvider>
      </QueryClientProvider>,
    );
  });
  const buttons = renderer.root.findAllByType("button").map((button) => ({
    disabled: button.props.disabled as boolean | undefined,
    text: textContent(button.props.children),
  }));
  const output = JSON.stringify(renderer.toJSON());

  await act(async () => {
    renderer.unmount();
  });
  queryClient.clear();

  return { buttons, output };
}

for (const status of ["completed", "expired", "abandoned"] as const) {
  test(`renders no purchase control for a ${status} terminal snapshot`, async () => {
    const terminalSnapshot = {
      ...activeSnapshot,
      session: {
        ...activeSnapshot.session,
        revision: 2,
        phase: status,
      },
      allowedActions: [],
      status,
    } satisfies CheckoutSnapshot;

    expect((await renderPurchaseAction(terminalSnapshot)).buttons).toEqual([]);
  });
}

test("renders no purchase control when a nonterminal snapshot allows only offer acceptance", async () => {
  expect((await renderPurchaseAction(activeSnapshot)).buttons).toEqual([]);
});

test("labels the purchase control from the authoritative purchase action", async () => {
  const { buttons } = await renderPurchaseAction({
    ...activeSnapshot,
    allowedActions: ["purchase"],
    status: "purchase_failed",
  });

  expect(buttons).toHaveLength(1);
  expect(buttons[0]?.text).toContain("Purchase");
  expect(buttons[0]?.text).not.toContain("Retry purchase");
});

test("labels the retry control from the authoritative retry action", async () => {
  const { buttons } = await renderPurchaseAction({
    ...activeSnapshot,
    session: {
      ...activeSnapshot.session,
      payment: { status: "failed" },
    },
    allowedActions: ["retry_purchase"],
    status: "ready",
  });

  expect(buttons).toHaveLength(1);
  expect(buttons[0]?.text).toContain("Retry purchase");
});

test("disables an authorized purchase after the monotonic hold reaches zero", async () => {
  const { buttons } = await renderPurchaseAction({
    ...activeSnapshot,
    session: {
      ...activeSnapshot.session,
      inventoryHold: { expiresAt: "2026-07-28T16:59:00.000Z" },
    },
    allowedActions: ["purchase"],
    status: "ready",
  });

  expect(buttons).toEqual([{ disabled: true, text: "Purchase" }]);
});

test.each([
  ["purchase", "Purchase"],
  ["retry_purchase", "Retry purchase"],
] as const)(
  "keeps the authorized %s control authoritative over a contradictory pending status",
  async (allowedAction, label) => {
    const { buttons, output } = await renderPurchaseAction({
      ...activeSnapshot,
      allowedActions: [allowedAction],
      status: "purchase_pending",
    });

    expect(buttons).toEqual([{ disabled: false, text: label }]);
    expect(output).not.toContain("Completing purchase");
  },
);

test("renders purchase progress as status instead of an unauthorized control", async () => {
  const { buttons, output } = await renderPurchaseAction({
    ...activeSnapshot,
    session: {
      ...activeSnapshot.session,
      phase: "purchasing",
      payment: { status: "pending" },
    },
    allowedActions: [],
    status: "purchase_pending",
  });

  expect(buttons).toEqual([]);
  expect(output).toContain("Completing purchase");
});
