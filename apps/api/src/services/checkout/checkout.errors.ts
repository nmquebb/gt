import { TaggedError } from "better-result";
import type { CheckoutSnapshot } from "@checkout/sdk/contracts";

export class ListingUnavailable extends TaggedError("ListingUnavailable")<{
  listingId: string;
}>() {}

export class CheckoutSessionNotFound extends TaggedError(
  "CheckoutSessionNotFound",
)<{
  sessionId: string;
}>() {}

export class InvalidResumeToken extends TaggedError(
  "InvalidResumeToken",
)<{}>() {}

export class InvalidPriceAdjustment extends TaggedError(
  "InvalidPriceAdjustment",
)<{}>() {}

export interface SnapshotConflict extends Record<string, unknown> {
  snapshot: CheckoutSnapshot;
}

export class CheckoutSessionExpired extends TaggedError(
  "CheckoutSessionExpired",
)<SnapshotConflict>() {}

export class OfferVersionMismatch extends TaggedError(
  "OfferVersionMismatch",
)<SnapshotConflict>() {}

export class PurchaseNotAllowed extends TaggedError(
  "PurchaseNotAllowed",
)<SnapshotConflict>() {}

export type CheckoutError =
  | ListingUnavailable
  | CheckoutSessionNotFound
  | InvalidResumeToken
  | InvalidPriceAdjustment
  | CheckoutSessionExpired
  | OfferVersionMismatch
  | PurchaseNotAllowed;
