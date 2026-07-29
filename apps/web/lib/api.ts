import { createCheckoutClient } from "@checkout/sdk";

export const publicApiUrl = "http://127.0.0.1:3000";

export function createServerCheckoutClient() {
  return createCheckoutClient({
    baseUrl: publicApiUrl,
    fetch: globalThis.fetch,
    monotonicNow: () => performance.now(),
  });
}
