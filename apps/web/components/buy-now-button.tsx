"use client";

import { CheckoutClientError, createCheckoutClient } from "@checkout/sdk";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { getWebDeviceId } from "@/lib/device-id";

const apiUrl = "http://127.0.0.1:3000";

function errorMessage(error: unknown) {
  return error instanceof CheckoutClientError
    ? `Unable to start checkout (${error.code}). Please try again.`
    : "Unable to start checkout. Please try again.";
}

interface BuyNowButtonProps {
  listingId: string;
  unavailable: boolean;
}

export function BuyNowButton({ listingId, unavailable }: BuyNowButtonProps) {
  const router = useRouter();
  const [client] = useState(() =>
    createCheckoutClient({
      baseUrl: apiUrl,
      fetch: globalThis.fetch,
      monotonicNow: () => performance.now(),
    }),
  );
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onBuyNow() {
    setIsPending(true);
    setError(null);

    try {
      const created = await client.createCheckout({
        listingId,
        surface: "web",
        deviceId: getWebDeviceId(),
      });

      router.push(created.links.webPath);
    } catch (caught) {
      setError(errorMessage(caught));
      setIsPending(false);
    }
  }

  if (unavailable) {
    return null;
  }

  return (
    <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:items-end">
      <Button
        className="w-full min-w-[168px] whitespace-nowrap sm:w-auto"
        disabled={isPending}
        onClick={onBuyNow}
        type="button"
      >
        {isPending ? "Starting checkout…" : "Buy now"}
      </Button>
      {error === null ? null : (
        <p aria-live="polite" className="max-w-48 text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
