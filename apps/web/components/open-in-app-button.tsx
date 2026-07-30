"use client";

import { useOpenIosSimulator } from "@checkout/sdk";
import { Button } from "@/components/ui/button";
import { useCheckoutScreen } from "@/lib/checkout-screen-context";

export function OpenInAppButton() {
  const { client, context, isInteractive } = useCheckoutScreen();
  const openInApp = useOpenIosSimulator(client, context);

  return (
    <div className="space-y-2">
      <Button
        disabled={!isInteractive || openInApp.isPending}
        onClick={() => openInApp.mutate()}
        type="button"
        variant="outline"
      >
        {openInApp.isPending ? "Opening app…" : "Open in app"}
      </Button>
      {Boolean(openInApp.error) && (
        <p className="text-sm text-red-700" role="alert">
          The app could not be opened. Please try again.
        </p>
      )}
    </div>
  );
}
