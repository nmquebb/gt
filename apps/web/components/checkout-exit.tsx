"use client";

import { applyCheckoutState, CheckoutClientError } from "@checkout/sdk";
import { useQueryClient } from "@tanstack/react-query";
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
  const queryClient = useQueryClient();
  const { checkout, client, context, isInteractive } = useCheckoutScreen();
  const [isLeaving, setIsLeaving] = useState(false);
  const [error, setError] = useState<string>();

  async function leaveCheckout() {
    setIsLeaving(true);
    setError(undefined);
    try {
      const result = await client.leave(context);
      applyCheckoutState(queryClient, context.sessionId, result);
      router.replace("/");
    } catch (caught) {
      if (
        caught instanceof CheckoutClientError &&
        caught.snapshot &&
        caught.clockAnchor
      ) {
        applyCheckoutState(queryClient, context.sessionId, {
          snapshot: caught.snapshot,
          clockAnchor: caught.clockAnchor,
        });
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
          checkout.snapshot.session.phase === "purchasing"
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
