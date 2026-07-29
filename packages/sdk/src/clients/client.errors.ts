import type { CheckoutSnapshot } from "../contracts";
import type { ClockAnchor } from "./clock-anchor";

export class CheckoutClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly snapshot?: CheckoutSnapshot,
    readonly clockAnchor?: ClockAnchor,
  ) {
    super(message);
    this.name = "CheckoutClientError";
  }
}
