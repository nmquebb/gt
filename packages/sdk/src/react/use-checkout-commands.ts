"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  CheckoutClient,
  CheckoutClientContext,
  CheckoutCommandResult,
} from "../clients/checkout.client";
import { applyCheckoutState } from "../cache/checkout-cache";
import { CheckoutClientError } from "../clients/client.errors";
import type { PaymentOutcome } from "../contracts";

interface CheckoutMutationInvalidations {
  activity: boolean;
  listings: boolean;
}

interface CheckoutMutationOptions<TVariables, TResult> {
  queryClient: ReturnType<typeof useQueryClient>;
  sessionId: string;
  operation: (variables: TVariables) => Promise<TResult>;
  invalidations: CheckoutMutationInvalidations;
}

function checkoutMutationOptions<
  TVariables,
  TResult extends CheckoutCommandResult,
>({
  queryClient,
  sessionId,
  operation,
  invalidations,
}: CheckoutMutationOptions<TVariables, TResult>) {
  return {
    mutationFn: async (variables: TVariables): Promise<TResult> => {
      const result = await operation(variables);
      applyCheckoutState(queryClient, sessionId, result);

      return result;
    },
    onError: (error: unknown): void =>
      applyConflict(error, queryClient, sessionId),
    onSuccess: (): void => {
      if (invalidations.activity) {
        void queryClient.invalidateQueries({
          queryKey: ["checkout-activity", sessionId],
        });
      }
      if (invalidations.listings) {
        void queryClient.invalidateQueries({ queryKey: ["listings"] });
      }
    },
  };
}

function useCheckoutCommandMutation<
  TVariables,
  TResult extends CheckoutCommandResult,
>(
  sessionId: string,
  operation: (variables: TVariables) => Promise<TResult>,
  invalidations: CheckoutMutationInvalidations,
) {
  const queryClient = useQueryClient();

  return useMutation(
    checkoutMutationOptions({
      queryClient,
      sessionId,
      operation,
      invalidations,
    }),
  );
}

function applyConflict(
  error: unknown,
  queryClient: ReturnType<typeof useQueryClient>,
  sessionId: string,
): void {
  if (
    error instanceof CheckoutClientError &&
    error.snapshot &&
    error.clockAnchor
  ) {
    applyCheckoutState(queryClient, sessionId, {
      snapshot: error.snapshot,
      clockAnchor: error.clockAnchor,
    });
  }
}

export function useResumeCheckoutClient(
  client: Pick<CheckoutClient, "resume">,
  context: CheckoutClientContext,
) {
  return useCheckoutCommandMutation(
    context.sessionId,
    (_variables: void) => client.resume(context),
    { activity: true, listings: false },
  );
}

export function useAcceptCheckoutOffer(
  client: Pick<CheckoutClient, "acceptOffer">,
  context: CheckoutClientContext,
) {
  return useCheckoutCommandMutation(
    context.sessionId,
    (offerVersion: number) => client.acceptOffer(context, offerVersion),
    { activity: true, listings: false },
  );
}

export function usePurchaseCheckout(
  client: Pick<CheckoutClient, "purchase">,
  context: CheckoutClientContext,
  createIdempotencyKey: () => string = () => globalThis.crypto.randomUUID(),
) {
  return useCheckoutCommandMutation(
    context.sessionId,
    (_variables: void) => client.purchase(context, createIdempotencyKey()),
    { activity: true, listings: true },
  );
}

export function useRepriceCheckout(
  client: Pick<CheckoutClient, "reprice">,
  context: CheckoutClientContext,
) {
  return useCheckoutCommandMutation(
    context.sessionId,
    (increaseCents: number | undefined) =>
      client.reprice(context, increaseCents),
    { activity: true, listings: false },
  );
}

export function useExpireCheckout(
  client: Pick<CheckoutClient, "expire">,
  context: CheckoutClientContext,
) {
  return useCheckoutCommandMutation(
    context.sessionId,
    (_variables: void) => client.expire(context),
    { activity: true, listings: true },
  );
}

export function useSetNextPaymentOutcome(
  client: Pick<CheckoutClient, "setNextPaymentOutcome">,
  context: CheckoutClientContext,
) {
  return useMutation({
    mutationFn: (outcome: PaymentOutcome) =>
      client.setNextPaymentOutcome(context, outcome),
  });
}

export function useOpenIosSimulator(
  client: Pick<CheckoutClient, "openIosSimulator">,
  context: CheckoutClientContext,
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => client.openIosSimulator(context),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["checkout-activity", context.sessionId],
      });
    },
  });
}
