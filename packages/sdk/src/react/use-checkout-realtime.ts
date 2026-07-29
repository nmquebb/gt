"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import type {
  CheckoutClient,
  CheckoutClientContext,
} from "../clients/checkout.client";
import { applyCheckoutState, getCheckoutState } from "../cache/checkout-cache";
import {
  createCheckoutSubscription,
  type RealtimeEnvironment,
} from "../realtime/checkout-subscription";

interface UseCheckoutRealtimeOptions {
  client: Pick<CheckoutClient, "openEvents">;
  context: CheckoutClientContext;
  environment?: RealtimeEnvironment;
  monotonicNow?: () => number;
}

const defaultRealtimeEnvironment: RealtimeEnvironment = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) =>
    globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
};

function defaultMonotonicNow(): number {
  return performance.now();
}

export function useCheckoutRealtime({
  client,
  context,
  environment = defaultRealtimeEnvironment,
  monotonicNow = defaultMonotonicNow,
}: UseCheckoutRealtimeOptions) {
  const queryClient = useQueryClient();
  const { deviceId, resumeToken, sessionId, surface } = context;
  const immutableContext = useMemo(
    () => ({
      deviceId,
      resumeToken,
      sessionId,
      surface,
    }),
    [deviceId, resumeToken, sessionId, surface],
  );
  const onRelatedDataChanged = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["listings"] });
    void queryClient.invalidateQueries({
      queryKey: ["checkout-activity", immutableContext.sessionId],
    });
  }, [immutableContext.sessionId, queryClient]);
  const subscription = useMemo(
    () =>
      createCheckoutSubscription({
        context: immutableContext,
        client,
        environment,
        monotonicNow,
        getSnapshot: () => {
          const state = getCheckoutState(
            queryClient,
            immutableContext.sessionId,
          );
          if (!state) {
            throw new Error(
              "Checkout state must be seeded before realtime starts.",
            );
          }

          return state.snapshot;
        },
        applySnapshot: (snapshot, clockAnchor) =>
          applyCheckoutState(queryClient, immutableContext.sessionId, {
            snapshot,
            clockAnchor,
          }),
        onRelatedDataChanged,
      }),
    [
      client,
      environment,
      immutableContext,
      monotonicNow,
      onRelatedDataChanged,
      queryClient,
    ],
  );

  useEffect(() => {
    subscription.start();

    return () => subscription.stop();
  }, [subscription]);

  const subscribe = useCallback(
    (listener: (status: ReturnType<typeof subscription.getStatus>) => void) =>
      subscription.subscribeStatus(listener),
    [subscription],
  );
  const getStatus = useCallback(() => subscription.getStatus(), [subscription]);

  return useSyncExternalStore(subscribe, getStatus, getStatus);
}
