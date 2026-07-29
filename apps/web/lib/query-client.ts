import { QueryClient, queryOptions } from "@tanstack/react-query";
import type { CheckoutClient } from "@checkout/sdk/checkout-client";

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

export const listingQueryKey = ["listings"] as const;

export function listingsQueryOptions(client: CheckoutClient) {
  return queryOptions({
    queryKey: listingQueryKey,
    queryFn: () => client.listListings(),
    staleTime: 30_000,
  });
}
