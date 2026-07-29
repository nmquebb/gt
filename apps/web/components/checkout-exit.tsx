"use client";

import {
  CheckoutClientError,
  useCheckoutStore,
  useCheckoutStoreApi,
} from "@checkout/sdk";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useCheckoutScreen } from "@/lib/checkout-screen-context";

export function CheckoutExit({
  isPurchasePending = false,
}: {
  isPurchasePending?: boolean;
}) {
  const router = useRouter();
  const store = useCheckoutStoreApi();
  const status = useCheckoutStore((state) => state.snapshot.status);
  const { client, context, isInteractive } = useCheckoutScreen();
  const [isLeaving, setIsLeaving] = useState(false);
  const [error, setError] = useState<string>();

  async function leaveCheckout() {
    setIsLeaving(true);
    setError(undefined);
    try {
      const result = await client.leave(context);
      store.getState().applySnapshot(result.snapshot, result.clockAnchor);
      router.replace("/");
    } catch (caught) {
      if (
        caught instanceof CheckoutClientError &&
        caught.snapshot &&
        caught.clockAnchor
      ) {
        store.getState().applySnapshot(caught.snapshot, caught.clockAnchor);
      }
      setError("Unable to leave this checkout. Please try again.");
      setIsLeaving(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button
        disabled={
          !isInteractive ||
          isLeaving ||
          isPurchasePending ||
          status === "purchase_pending"
        }
        onClick={leaveCheckout}
        type="button"
        variant="outline"
      >
        {isLeaving ? "Leaving checkout…" : "Back to listings"}
      </Button>
      {error === undefined ? null : (
        <p aria-live="polite" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
