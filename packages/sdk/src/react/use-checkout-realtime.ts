"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import type {
  CheckoutClient,
  CheckoutClientContext,
} from "../clients/checkout.client";
import {
  createCheckoutSubscription,
  type RealtimeEnvironment,
} from "../realtime/checkout-subscription";
import { copyCheckoutClientContext } from "./checkout-context";
import { useCheckoutStoreApi } from "./checkout-provider";

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
  const store = useCheckoutStoreApi();
  const queryClient = useQueryClient();
  const { deviceId, resumeToken, sessionId, surface } = context;
  const immutableContext = useMemo(
    () =>
      copyCheckoutClientContext({
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
        getSnapshot: () => store.getState().snapshot,
        applySnapshot: (snapshot, clockAnchor) =>
          store.getState().applySnapshot(snapshot, clockAnchor),
        onRelatedDataChanged,
      }),
    [
      client,
      environment,
      immutableContext,
      monotonicNow,
      onRelatedDataChanged,
      store,
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
