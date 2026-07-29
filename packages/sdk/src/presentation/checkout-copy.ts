import type { CheckoutStatus } from "../contracts";

export function formatUsd(cents: number): string {
  const dollars = Math.floor(cents / 100);
  const remainingCents = cents % 100;

  return `$${dollars}.${remainingCents.toString().padStart(2, "0")}`;
}

export const checkoutCopy = {
  ready: {
    heading: "Your seat is held",
    description: "Complete your purchase before the hold expires.",
  },
  offer_review_required: {
    heading: "The price changed",
    description: "Accept the new total before continuing.",
  },
  purchase_pending: {
    heading: "Completing your purchase",
    description: "Your payment is being processed.",
  },
  purchase_failed: {
    heading: "Payment was not completed",
    description: "Try your payment again while the seat is still held.",
  },
  expired: {
    heading: "This hold expired",
    description: "Return to the listings to choose an available seat.",
  },
  abandoned: {
    heading: "This checkout was released",
    description: "This seat is no longer reserved.",
  },
  completed: {
    heading: "You’re going",
    description: "Your order is confirmed.",
  },
} satisfies Record<CheckoutStatus, { heading: string; description: string }>;
