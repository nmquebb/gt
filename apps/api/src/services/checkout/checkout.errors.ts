import type {
  CheckoutSessionUpdatedCause,
  CheckoutSnapshot,
} from "@checkout/sdk/contracts";

export interface CheckoutUpdate {
  cause: CheckoutSessionUpdatedCause;
  snapshot: CheckoutSnapshot;
}

export class CheckoutError extends Error {
  constructor(
    message: string,
    readonly updates: readonly CheckoutUpdate[] = [],
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ListingUnavailable extends CheckoutError {
  constructor(
    readonly listingId: string,
    updates: readonly CheckoutUpdate[] = [],
  ) {
    super("Listing unavailable", updates);
  }
}

export class CheckoutSessionNotFound extends CheckoutError {
  constructor(readonly sessionId: string) {
    super("Checkout session not found");
  }
}

export class InvalidResumeToken extends CheckoutError {
  constructor() {
    super("Invalid resume token");
  }
}

export class InvalidPriceAdjustment extends CheckoutError {
  constructor() {
    super("Invalid price adjustment");
  }
}

export class CheckoutSessionExpired extends CheckoutError {
  constructor(
    readonly snapshot: CheckoutSnapshot,
    updates: readonly CheckoutUpdate[] = [],
  ) {
    super("Checkout session expired", updates);
  }
}

export class OfferVersionMismatch extends CheckoutError {
  constructor(readonly snapshot: CheckoutSnapshot) {
    super("Offer version mismatch");
  }
}

export class PurchaseNotAllowed extends CheckoutError {
  constructor(readonly snapshot: CheckoutSnapshot) {
    super("Purchase not allowed");
  }
}
