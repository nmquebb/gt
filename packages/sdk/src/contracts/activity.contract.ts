import { z } from "zod";
import { SurfaceSchema } from "./checkout.contract";

const ActivityBaseSchema = z.object({
  id: z.string().min(1),
  at: z.string().datetime(),
  sessionId: z.string().min(1),
  revision: z.number().int().positive(),
});

const ActorActivitySchema = ActivityBaseSchema.extend({
  surface: SurfaceSchema,
  deviceId: z.string().min(1).max(128),
});

export const ActivityEntrySchema = z.discriminatedUnion("type", [
  ActorActivitySchema.extend({
    type: z.literal("checkout_session_created"),
    details: z.object({
      listingId: z.string().min(1),
      expiresAt: z.string().datetime(),
    }),
  }),
  ActivityBaseSchema.extend({
    type: z.literal("app_handoff_opened"),
    details: z.object({}),
  }),
  ActorActivitySchema.extend({
    type: z.literal("checkout_session_resumed"),
    details: z.object({}),
  }),
  ActivityBaseSchema.extend({
    type: z.literal("price_changed"),
    details: z.object({
      previousTotalCents: z.number().int().nonnegative(),
      currentTotalCents: z.number().int().nonnegative(),
      currentVersion: z.number().int().positive(),
    }),
  }),
  ActorActivitySchema.extend({
    type: z.literal("price_change_accepted"),
    details: z.object({
      acceptedVersion: z.number().int().positive(),
      acceptedTotalCents: z.number().int().nonnegative(),
    }),
  }),
  ActorActivitySchema.extend({
    type: z.literal("checkout_purchase_started"),
    details: z.object({ totalCents: z.number().int().nonnegative() }),
  }),
  ActorActivitySchema.extend({
    type: z.literal("duplicate_purchase_prevented"),
    details: z.object({}),
  }),
  ActorActivitySchema.extend({
    type: z.literal("purchase_failed"),
    details: z.object({}),
  }),
  ActivityBaseSchema.extend({
    type: z.literal("inventory_hold_expired"),
    details: z.object({}),
  }),
  ActorActivitySchema.extend({
    type: z.literal("checkout_session_abandoned"),
    details: z.object({ reason: z.enum(["navigation", "superseded"]) }),
  }),
  ActorActivitySchema.extend({
    type: z.literal("order_completed"),
    details: z.object({ orderId: z.string().min(1) }),
  }),
]);

export type ActivityEntry = z.infer<typeof ActivityEntrySchema>;
