"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLayoutEffect } from "react";
import {
  applyCheckoutState,
  checkoutQueryKey,
  getCheckoutState,
  type CheckoutState,
} from "../cache/checkout-cache";

export function useCheckoutState(
  sessionId: string,
  initialState: CheckoutState,
): CheckoutState {
  const queryClient = useQueryClient();

  useLayoutEffect(() => {
    applyCheckoutState(queryClient, sessionId, initialState);
  }, [initialState, queryClient, sessionId]);

  const query = useQuery<CheckoutState>({
    queryKey: checkoutQueryKey(sessionId),
    queryFn: async () => initialState,
    initialData: () => getCheckoutState(queryClient, sessionId) ?? initialState,
    enabled: false,
    staleTime: Infinity,
  });

  return query.data;
}
