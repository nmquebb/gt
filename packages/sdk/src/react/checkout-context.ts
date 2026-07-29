import type { CheckoutClientContext } from "../clients/checkout.client";

export function copyCheckoutClientContext(
  context: CheckoutClientContext,
): CheckoutClientContext {
  return {
    deviceId: context.deviceId,
    resumeToken: context.resumeToken,
    sessionId: context.sessionId,
    surface: context.surface,
  };
}
