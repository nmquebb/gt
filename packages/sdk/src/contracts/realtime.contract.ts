import { z } from "zod";
import { CheckoutSnapshotSchema } from "./checkout.contract";

export const CheckoutSessionUpdatedCauseSchema = z.enum([
  "repriced",
  "offer_accepted",
  "purchase_started",
  "purchase_failed",
  "completed",
  "expired",
  "abandoned",
  "initial_sync",
]);

export const CheckoutSessionUpdatedEventSchema = z.object({
  type: z.literal("checkout_session_updated"),
  cause: CheckoutSessionUpdatedCauseSchema,
  snapshot: CheckoutSnapshotSchema,
});

export type CheckoutSessionUpdatedCause = z.infer<
  typeof CheckoutSessionUpdatedCauseSchema
>;
export type CheckoutSessionUpdatedEvent = z.infer<
  typeof CheckoutSessionUpdatedEventSchema
>;
