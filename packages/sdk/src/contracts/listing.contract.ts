import { z } from "zod";

export const DemoEventSchema = z.object({
  name: z.literal("Chicago Bears vs. Green Bay Packers"),
  venue: z.literal("Soldier Field"),
  timeLabel: z.literal("Sunday at 12:00 PM"),
  isDemo: z.literal(true),
});

export const ListingSchema = z.object({
  id: z.string().min(1),
  section: z.string().min(1),
  row: z.string().min(1),
  seat: z.string().min(1),
  priceCents: z.number().int().nonnegative(),
  status: z.enum(["available", "held", "sold"]),
});

export const ListingsResponseSchema = z.object({
  event: DemoEventSchema,
  listings: z.array(ListingSchema),
});

export type DemoEvent = z.infer<typeof DemoEventSchema>;
export type Listing = z.infer<typeof ListingSchema>;
export type ListingsResponse = z.infer<typeof ListingsResponseSchema>;
