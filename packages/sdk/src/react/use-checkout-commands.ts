"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  CheckoutClient,
  CheckoutClientContext,
  CheckoutCommandResult,
} from "../clients/checkout.client";
import { CheckoutClientError } from "../clients/client.errors";
import type { PaymentOutcome } from "../contracts";
import type { CheckoutStore } from "../stores/checkout/checkout.store";
import { useCheckoutStoreApi } from "./checkout-provider";

function applyConflict(error: unknown, store: CheckoutStore): void {
  if (
    error instanceof CheckoutClientError &&
    error.snapshot &&
    error.clockAnchor
  ) {
    store.getState().applySnapshot(error.snapshot, error.clockAnchor);
  }
}

function useApplyCanonicalSnapshot() {
  const store = useCheckoutStoreApi();

  return <T extends CheckoutCommandResult>(result: T): T => {
    store.getState().applySnapshot(result.snapshot, result.clockAnchor);

    return result;
  };
}

function useApplyConflict() {
  const store = useCheckoutStoreApi();

  return (error: unknown): void => applyConflict(error, store);
}

function useInvalidateActivity(context: CheckoutClientContext) {
  const queryClient = useQueryClient();

  return (): void => {
    void queryClient.invalidateQueries({
      queryKey: ["checkout-activity", context.sessionId],
    });
  };
}

function useInvalidateListings() {
  const queryClient = useQueryClient();

  return (): void => {
    void queryClient.invalidateQueries({ queryKey: ["listings"] });
  };
}

export function useResumeCheckoutClient(
  client: Pick<CheckoutClient, "resume">,
  context: CheckoutClientContext,
) {
  const applyCanonicalSnapshot = useApplyCanonicalSnapshot();
  const applyErrorSnapshot = useApplyConflict();
  const invalidateActivity = useInvalidateActivity(context);

  return useMutation({
    mutationFn: async () =>
      applyCanonicalSnapshot(await client.resume(context)),
    onError: applyErrorSnapshot,
    onSuccess: invalidateActivity,
  });
}

export function useAcceptCheckoutOffer(
  client: Pick<CheckoutClient, "acceptOffer">,
  context: CheckoutClientContext,
) {
  const applyCanonicalSnapshot = useApplyCanonicalSnapshot();
  const applyErrorSnapshot = useApplyConflict();
  const invalidateActivity = useInvalidateActivity(context);

  return useMutation({
    mutationFn: async (offerVersion: number) =>
      applyCanonicalSnapshot(await client.acceptOffer(context, offerVersion)),
    onError: applyErrorSnapshot,
    onSuccess: invalidateActivity,
  });
}

export function usePurchaseCheckout(
  client: Pick<CheckoutClient, "purchase">,
  context: CheckoutClientContext,
  createIdempotencyKey: () => string = () => globalThis.crypto.randomUUID(),
) {
  const applyCanonicalSnapshot = useApplyCanonicalSnapshot();
  const applyErrorSnapshot = useApplyConflict();
  const invalidateActivity = useInvalidateActivity(context);
  const invalidateListings = useInvalidateListings();

  return useMutation({
    mutationFn: async () =>
      applyCanonicalSnapshot(
        await client.purchase(context, createIdempotencyKey()),
      ),
    onError: applyErrorSnapshot,
    onSuccess: () => {
      invalidateActivity();
      invalidateListings();
    },
  });
}

export function useRepriceCheckout(
  client: Pick<CheckoutClient, "reprice">,
  context: CheckoutClientContext,
) {
  const applyCanonicalSnapshot = useApplyCanonicalSnapshot();
  const applyErrorSnapshot = useApplyConflict();
  const invalidateActivity = useInvalidateActivity(context);

  return useMutation({
    mutationFn: async (increaseCents: number | undefined) =>
      applyCanonicalSnapshot(await client.reprice(context, increaseCents)),
    onError: applyErrorSnapshot,
    onSuccess: invalidateActivity,
  });
}

export function useExpireCheckout(
  client: Pick<CheckoutClient, "expire">,
  context: CheckoutClientContext,
) {
  const applyCanonicalSnapshot = useApplyCanonicalSnapshot();
  const applyErrorSnapshot = useApplyConflict();
  const invalidateActivity = useInvalidateActivity(context);
  const invalidateListings = useInvalidateListings();

  return useMutation({
    mutationFn: async () =>
      applyCanonicalSnapshot(await client.expire(context)),
    onError: applyErrorSnapshot,
    onSuccess: () => {
      invalidateActivity();
      invalidateListings();
    },
  });
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
  const invalidateActivity = useInvalidateActivity(context);

  return useMutation({
    mutationFn: () => client.openIosSimulator(context),
    onSuccess: invalidateActivity,
  });
}
