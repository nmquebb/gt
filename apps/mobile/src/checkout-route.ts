import { z } from "zod";

const CheckoutRouteContextSchema = z.object({
  sessionId: z.string().min(1),
  token: z.string().min(1),
});

export type CheckoutRouteContext = z.infer<typeof CheckoutRouteContextSchema>;

export function parseCheckoutDeepLink(
  incomingUrl: string | null,
): CheckoutRouteContext | undefined {
  if (!incomingUrl) {
    return;
  }

  try {
    const url = new URL(incomingUrl);
    const tokens = url.searchParams.getAll("token");
    if (
      url.protocol !== "gametime:" ||
      url.hostname !== "checkout" ||
      tokens.length !== 1
    ) {
      return;
    }

    return CheckoutRouteContextSchema.parse({
      sessionId: url.pathname.replace(/^\/+/, ""),
      token: tokens[0],
    });
  } catch {
    return;
  }
}
