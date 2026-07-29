import type { CheckoutLinks } from "@checkout/sdk/contracts";

export function createCheckoutLinks(
  sessionId: string,
  resumeToken: string,
): CheckoutLinks {
  return {
    webPath: `/checkout/${sessionId}?token=${encodeURIComponent(resumeToken)}`,
    deepLink:
      `gametime://checkout/${encodeURIComponent(sessionId)}` +
      `?token=${encodeURIComponent(resumeToken)}`,
  };
}
