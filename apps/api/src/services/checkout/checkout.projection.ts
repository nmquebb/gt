import type { AllowedAction, CheckoutSnapshot } from "@checkout/sdk/contracts";
import type { CheckoutSessionRecord } from "../../providers/memory-checkout-repository";

function iso(value: Date): string {
  return value.toISOString();
}

export function projectCheckout(
  record: CheckoutSessionRecord,
  now: Date,
): CheckoutSnapshot {
  const expired = now.getTime() >= Date.parse(record.inventoryHold.expiresAt);
  const completed = record.phase === "completed";
  const abandoned = record.phase === "abandoned";
  const pending = record.payment.status === "pending";
  const offerReviewRequired =
    record.offer.currentVersion !== record.offer.acceptedVersion;
  const purchaseFailed = record.payment.status === "failed";

  const status = completed
    ? "completed"
    : abandoned
      ? "abandoned"
      : pending
        ? "purchase_pending"
        : record.phase === "expired" || expired
          ? "expired"
          : offerReviewRequired
            ? "offer_review_required"
            : purchaseFailed
              ? "purchase_failed"
              : "ready";

  const allowedActions: AllowedAction[] =
    status === "ready"
      ? ["purchase"]
      : status === "offer_review_required"
        ? ["accept_offer"]
        : status === "purchase_failed"
          ? ["retry_purchase"]
          : [];

  const session = {
    id: record.id,
    revision: record.revision,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    event: record.event,
    listing: record.listing,
    inventoryHold: { expiresAt: record.inventoryHold.expiresAt },
    offer: record.offer,
    phase: record.phase,
    payment: { status: record.payment.status },
  };

  return {
    serverNow: iso(now),
    session: record.order ? { ...session, order: record.order } : session,
    allowedActions,
    status,
  };
}
