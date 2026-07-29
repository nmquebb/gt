import type { CheckoutStatus, RealtimeStatus } from "@checkout/sdk";

export type CheckoutStatusTone =
  | "danger"
  | "info"
  | "neutral"
  | "success"
  | "warning";

export const checkoutStatusPresentation: Record<
  CheckoutStatus,
  {
    tone: CheckoutStatusTone;
  }
> = {
  ready: { tone: "info" },
  offer_review_required: { tone: "warning" },
  purchase_pending: { tone: "info" },
  purchase_failed: { tone: "danger" },
  expired: { tone: "neutral" },
  abandoned: { tone: "neutral" },
  completed: { tone: "success" },
};

export const realtimeStatusCopy: Record<RealtimeStatus, string> = {
  idle: "Preparing live updates…",
  connecting: "Connecting to live updates…",
  connected: "Live updates connected",
  disconnected: "Reconnecting to live updates…",
  stopped: "Checkout updates complete",
};
