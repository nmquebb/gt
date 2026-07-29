import { createCheckoutClient } from "@checkout/sdk";

const internalApiUrl = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:3000";

export const publicApiUrl =
  process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3000";

export function createServerCheckoutClient() {
  return createCheckoutClient({
    baseUrl: internalApiUrl,
    fetch: globalThis.fetch,
    monotonicNow: () => performance.now(),
  });
}
