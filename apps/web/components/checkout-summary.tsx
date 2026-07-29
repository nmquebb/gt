"use client";

import {
  formatUsd,
  useAcceptCheckoutOffer,
  useCheckoutStore,
  type CheckoutClientContext,
} from "@checkout/sdk";
import { LoaderCircle } from "lucide-react";
import { CheckoutStatus } from "@/components/checkout-status";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useCheckoutScreen } from "@/lib/checkout-screen-context";

interface OfferAcceptanceProps {
  context: CheckoutClientContext;
  currentVersion: number;
}

function OfferAcceptance({ context, currentVersion }: OfferAcceptanceProps) {
  const { client, isInteractive } = useCheckoutScreen();
  const acceptOffer = useAcceptCheckoutOffer(client, context);

  return (
    <div className="space-y-2">
      <Button
        aria-describedby="price-change-status"
        disabled={!isInteractive || acceptOffer.isPending}
        onClick={() => acceptOffer.mutate(currentVersion)}
        type="button"
      >
        {acceptOffer.isPending ? (
          <>
            <LoaderCircle
              aria-hidden="true"
              className="mr-2 size-4 animate-spin"
            />
            Accepting price…
          </>
        ) : (
          "Accept new price"
        )}
      </Button>
      {acceptOffer.error ? (
        <p className="text-sm text-red-700" role="alert">
          The current price could not be accepted. Please try again.
        </p>
      ) : null}
    </div>
  );
}

export function CheckoutSummary() {
  const event = useCheckoutStore((state) => state.snapshot.session.event);
  const listing = useCheckoutStore((state) => state.snapshot.session.listing);
  const offer = useCheckoutStore((state) => state.snapshot.session.offer);
  const order = useCheckoutStore((state) => state.snapshot.session.order);
  const allowedActions = useCheckoutStore(
    (state) => state.snapshot.allowedActions,
  );
  const { context } = useCheckoutScreen();
  const requiresOfferReview = offer.currentVersion !== offer.acceptedVersion;
  const canAcceptOffer = allowedActions.includes("accept_offer");

  return (
    <Card className="space-y-5 overflow-hidden p-5 shadow-sm sm:p-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight">{event.name}</h2>
        <p className="text-sm text-neutral-500">
          {event.venue} · {event.timeLabel}
        </p>
      </div>
      <div className="border-t border-neutral-100 pt-4">
        <p className="text-sm">
          Section {listing.section} · Row {listing.row} · Seat {listing.seat}
        </p>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
          <div className="flex items-baseline gap-2">
            {requiresOfferReview ? (
              <span
                aria-label={`Previously accepted price ${formatUsd(offer.acceptedTotalCents)}`}
                className="text-sm text-neutral-500 line-through decoration-2"
              >
                {formatUsd(offer.acceptedTotalCents)}
              </span>
            ) : null}
            <p className="text-2xl font-semibold tracking-tight">
              {formatUsd(offer.currentTotalCents)}
            </p>
          </div>
          {canAcceptOffer ? (
            <OfferAcceptance
              context={context}
              currentVersion={offer.currentVersion}
            />
          ) : null}
        </div>
      </div>
      {order === undefined ? null : (
        <p className="text-sm text-emerald-700">
          Order <span data-testid="order-id">{order.id}</span> confirmed
        </p>
      )}
      <div id="price-change-status">
        <CheckoutStatus />
      </div>
    </Card>
  );
}
