"use client";

import { createCheckoutClient } from "@checkout/sdk";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { BuyNowButton } from "@/components/buy-now-button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatUsd } from "@/lib/format";
import { listingsQueryOptions } from "@/lib/query-client";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3000";

function formatAvailability(status: "available" | "held" | "sold") {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

const availabilityClassName = {
  available: "bg-emerald-100 text-emerald-800",
  held: "bg-amber-100 text-amber-800",
  sold: "bg-neutral-200 text-neutral-600",
} as const;

export function ListingList() {
  const [client] = useState(() =>
    createCheckoutClient({
      baseUrl: apiUrl,
      fetch: globalThis.fetch,
      monotonicNow: () => performance.now(),
    }),
  );
  const { data, error, isPending } = useQuery(listingsQueryOptions(client));

  if (isPending) {
    return <p className="text-sm text-neutral-600">Loading listings…</p>;
  }

  if (error) {
    return (
      <p className="text-sm text-red-700" role="alert">
        Listings are unavailable. Please refresh and try again.
      </p>
    );
  }
  if (data === undefined) {
    return null;
  }

  const { event, listings } = data;

  return (
    <section aria-labelledby="event-name" className="space-y-7">
      <header className="space-y-3">
        <Badge className="bg-neutral-950 text-white">Demo event</Badge>
        <h1
          className="max-w-xl text-3xl font-semibold tracking-tight"
          id="event-name"
        >
          {event.name}
        </h1>
        <p className="text-sm text-neutral-500">
          {event.venue} · {event.timeLabel}
        </p>
      </header>

      <div className="space-y-3">
        {listings.map((listing) => (
          <Card className="p-5 shadow-sm" key={listing.id}>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-2.5">
                <p className="font-medium">
                  {`Section ${listing.section} · Row ${listing.row} · Seat ${listing.seat}`}
                </p>
                <p className="text-sm text-neutral-500">
                  {formatUsd(listing.priceCents)} total
                </p>
                <Badge className={availabilityClassName[listing.status]}>
                  {formatAvailability(listing.status)}
                </Badge>
              </div>
              <BuyNowButton
                listingId={listing.id}
                unavailable={listing.status !== "available"}
              />
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}
