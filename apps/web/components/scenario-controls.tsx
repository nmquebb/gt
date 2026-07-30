"use client";

import {
  type PaymentOutcome,
  useExpireCheckout,
  useRepriceCheckout,
  useSetNextPaymentOutcome,
} from "@checkout/sdk";
import { Check, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Collapsible } from "@/components/ui/collapsible";
import { useCheckoutScreen } from "@/lib/checkout-screen-context";

export function ScenarioControls() {
  const { checkout, client, context } = useCheckoutScreen();
  const reprice = useRepriceCheckout(client, context);
  const expire = useExpireCheckout(client, context);
  const setNextOutcome = useSetNextPaymentOutcome(client, context);
  const status = checkout.snapshot.status;
  const [selectedOutcome, setSelectedOutcome] = useState<PaymentOutcome>();

  useEffect(() => {
    if (status === "purchase_pending") {
      setSelectedOutcome(undefined);
    }
  }, [status]);

  const isChangingScenario =
    reprice.isPending || expire.isPending || setNextOutcome.isPending;
  const hasError = Boolean(
    reprice.error || expire.error || setNextOutcome.error,
  );

  function chooseOutcome(outcome: PaymentOutcome) {
    setNextOutcome.mutate(outcome, {
      onSuccess: () => setSelectedOutcome(outcome),
    });
  }

  function outcomeButton(outcome: PaymentOutcome, label: string) {
    const isSelected = selectedOutcome === outcome;
    const isSetting =
      setNextOutcome.isPending && setNextOutcome.variables === outcome;

    return (
      <Button
        aria-pressed={isSelected}
        className="w-full justify-between"
        disabled={isChangingScenario}
        onClick={() => chooseOutcome(outcome)}
        type="button"
        variant={isSelected ? "default" : "outline"}
      >
        <span>{isSetting ? "Setting outcome…" : label}</span>
        {isSetting ? (
          <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
        ) : (
          isSelected && <Check aria-hidden="true" className="size-4" />
        )}
      </Button>
    );
  }

  return (
    <Collapsible
      className="fixed right-4 bottom-4 z-50 w-auto overflow-hidden shadow-lg open:w-[min(280px,calc(100vw-2rem))]"
      title="Dev"
    >
      <div className="grid gap-2">
        <Button
          className="w-full justify-start"
          disabled={isChangingScenario}
          onClick={() => reprice.mutate(undefined)}
          type="button"
          variant="outline"
        >
          {reprice.isPending ? (
            <>
              <LoaderCircle
                aria-hidden="true"
                className="mr-2 size-4 animate-spin"
              />
              Changing price…
            </>
          ) : (
            "Change price"
          )}
        </Button>
        <Button
          className="w-full justify-start"
          disabled={isChangingScenario}
          onClick={() => expire.mutate()}
          type="button"
          variant="outline"
        >
          {expire.isPending ? (
            <>
              <LoaderCircle
                aria-hidden="true"
                className="mr-2 size-4 animate-spin"
              />
              Expiring hold…
            </>
          ) : (
            "Expire hold"
          )}
        </Button>
        <div className="my-1 border-t border-neutral-200" />
        <p className="px-1 text-xs font-medium text-neutral-500">
          Next payment
        </p>
        {outcomeButton("success", "Next payment succeeds")}
        {outcomeButton("failure", "Next payment fails")}
        {hasError && (
          <p
            className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700"
            role="alert"
          >
            The scenario change failed. Please try again.
          </p>
        )}
      </div>
    </Collapsible>
  );
}
