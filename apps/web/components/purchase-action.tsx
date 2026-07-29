"use client";

import {
  remainingHoldMs,
  useCheckoutStore,
  usePurchaseCheckout,
} from "@checkout/sdk";
import { LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useCheckoutScreen } from "@/lib/checkout-screen-context";

export function PurchaseAction({
  onPendingChange,
}: {
  onPendingChange?: (isPending: boolean) => void;
}) {
  const allowedActions = useCheckoutStore(
    (state) => state.snapshot.allowedActions,
  );
  const status = useCheckoutStore((state) => state.snapshot.status);
  const clockAnchor = useCheckoutStore((state) => state.clockAnchor);
  const { client, context, isInteractive } = useCheckoutScreen();
  const purchase = usePurchaseCheckout(client, context);
  const [remainingMs, setRemainingMs] = useState(() =>
    remainingHoldMs(clockAnchor, performance.now()),
  );

  useEffect(() => {
    function update() {
      setRemainingMs(remainingHoldMs(clockAnchor, performance.now()));
    }

    update();
    const interval = globalThis.setInterval(update, 1_000);

    return () => globalThis.clearInterval(interval);
  }, [clockAnchor]);

  const action = allowedActions.includes("retry_purchase")
    ? "retry_purchase"
    : allowedActions.includes("purchase")
      ? "purchase"
      : undefined;

  if (action === undefined) {
    return status === "purchase_pending" ? (
      <output className="flex items-center text-sm text-neutral-600">
        <LoaderCircle aria-hidden="true" className="mr-2 size-4 animate-spin" />
        Completing purchase…
      </output>
    ) : null;
  }

  const enabled =
    allowedActions.some(
      (allowedAction) =>
        allowedAction === "purchase" || allowedAction === "retry_purchase",
    ) &&
    remainingMs > 0 &&
    !purchase.isPending &&
    isInteractive;

  return (
    <div className="space-y-2">
      <Button
        disabled={!enabled}
        onClick={() => {
          onPendingChange?.(true);
          purchase.mutate(undefined, {
            onSettled: () => onPendingChange?.(false),
          });
        }}
        type="button"
      >
        {purchase.isPending ? (
          <>
            <LoaderCircle
              aria-hidden="true"
              className="mr-2 size-4 animate-spin"
            />
            Completing purchase…
          </>
        ) : action === "retry_purchase" ? (
          "Retry purchase"
        ) : (
          "Purchase"
        )}
      </Button>
      {purchase.error ? (
        <p className="text-sm text-red-700" role="alert">
          The purchase could not be completed. Please try again.
        </p>
      ) : null}
    </div>
  );
}
