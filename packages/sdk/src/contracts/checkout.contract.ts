import { z } from "zod";
import { DemoEventSchema } from "./listing.contract";

export const SurfaceSchema = z.enum(["web", "mobile"]);
export const IdempotencyKeySchema = z.string().min(1);
export const PaymentOutcomeSchema = z.enum(["success", "failure"]);
export const CheckoutPhaseSchema = z.enum([
  "active",
  "purchasing",
  "completed",
  "expired",
  "abandoned",
]);
export const CheckoutStatusSchema = z.enum([
  "ready",
  "offer_review_required",
  "purchase_pending",
  "purchase_failed",
  "expired",
  "abandoned",
  "completed",
]);
export const AllowedActionSchema = z.enum([
  "accept_offer",
  "purchase",
  "retry_purchase",
]);

export const CheckoutSessionSnapshotSchema = z.object({
  id: z.string().min(1),
  revision: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  event: DemoEventSchema,
  listing: z.object({
    id: z.string().min(1),
    section: z.string().min(1),
    row: z.string().min(1),
    seat: z.string().min(1),
  }),
  inventoryHold: z.object({ expiresAt: z.string().datetime() }),
  offer: z.object({
    currency: z.literal("USD"),
    currentVersion: z.number().int().positive(),
    currentTotalCents: z.number().int().nonnegative(),
    acceptedVersion: z.number().int().nonnegative(),
    acceptedTotalCents: z.number().int().nonnegative(),
  }),
  phase: CheckoutPhaseSchema,
  payment: z.object({
    status: z.enum(["idle", "pending", "failed", "succeeded"]),
  }),
  order: z
    .object({
      id: z.string().min(1),
      completedAt: z.string().datetime(),
      completedByDeviceId: z.string().min(1),
    })
    .optional(),
});

export const CheckoutSnapshotSchema = z.object({
  serverNow: z.string().datetime(),
  session: CheckoutSessionSnapshotSchema,
  allowedActions: z.array(AllowedActionSchema),
  status: CheckoutStatusSchema,
});

export const CreateCheckoutSessionRequestSchema = z.object({
  listingId: z.string().min(1),
  surface: z.literal("web"),
  deviceId: z.string().min(1).max(128),
});

export const ResumeCheckoutRequestSchema = z.object({
  surface: SurfaceSchema,
});

export const LeaveCheckoutRequestSchema = z.object({
  surface: SurfaceSchema,
  deviceId: z.string().min(1).max(128),
});

export const AcceptOfferRequestSchema = z.object({
  offerVersion: z.number().int().positive(),
  surface: SurfaceSchema,
  deviceId: z.string().min(1).max(128),
});

export const PurchaseRequestSchema = z.object({
  surface: SurfaceSchema,
  deviceId: z.string().min(1).max(128),
});

export const CheckoutLinksSchema = z.object({
  webPath: z.string().min(1),
  deepLink: z.string().min(1),
});

export const CreatedCheckoutResponseSchema = z.object({
  snapshot: CheckoutSnapshotSchema,
  resumeToken: z.string().min(1),
  links: CheckoutLinksSchema,
});

export const PurchaseResponseSchema = z.object({
  disposition: z.enum(["pending", "completed", "failed"]),
  snapshot: CheckoutSnapshotSchema,
  duplicatePrevented: z.boolean(),
});

export const ApiErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  snapshot: CheckoutSnapshotSchema.optional(),
});

export type Surface = z.infer<typeof SurfaceSchema>;
export type PaymentOutcome = z.infer<typeof PaymentOutcomeSchema>;
export type CheckoutPhase = z.infer<typeof CheckoutPhaseSchema>;
export type CheckoutStatus = z.infer<typeof CheckoutStatusSchema>;
export type AllowedAction = z.infer<typeof AllowedActionSchema>;
export type CheckoutSessionSnapshot = z.infer<
  typeof CheckoutSessionSnapshotSchema
>;
export type CheckoutSnapshot = z.infer<typeof CheckoutSnapshotSchema>;
export type CreateCheckoutSessionRequest = z.infer<
  typeof CreateCheckoutSessionRequestSchema
>;
export type ResumeCheckoutRequest = z.infer<typeof ResumeCheckoutRequestSchema>;
export type LeaveCheckoutRequest = z.infer<typeof LeaveCheckoutRequestSchema>;
export type AcceptOfferRequest = z.infer<typeof AcceptOfferRequestSchema>;
export type PurchaseRequest = z.infer<typeof PurchaseRequestSchema>;
export type CheckoutLinks = z.infer<typeof CheckoutLinksSchema>;
export type CreatedCheckoutResponse = z.infer<
  typeof CreatedCheckoutResponseSchema
>;
export type PurchaseResponse = z.infer<typeof PurchaseResponseSchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;
