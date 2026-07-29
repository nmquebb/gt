import { expect, test } from "bun:test";
import type { CheckoutStatus, RealtimeStatus } from "@checkout/sdk";
import {
  checkoutStatusPresentation,
  realtimeStatusCopy,
} from "./checkout-presentation";

test("defines native presentation for every checkout status", () => {
  const statuses: CheckoutStatus[] = [
    "ready",
    "offer_review_required",
    "purchase_pending",
    "purchase_failed",
    "expired",
    "abandoned",
    "completed",
  ];

  expect(
    statuses.map((status) => checkoutStatusPresentation[status].tone),
  ).toEqual([
    "info",
    "warning",
    "info",
    "danger",
    "neutral",
    "neutral",
    "success",
  ]);
});

test("defines customer copy for every realtime status", () => {
  const statuses: RealtimeStatus[] = [
    "idle",
    "connecting",
    "connected",
    "disconnected",
    "stopped",
  ];

  expect(statuses.map((status) => realtimeStatusCopy[status])).toEqual([
    "Preparing live updates…",
    "Connecting to live updates…",
    "Live updates connected",
    "Reconnecting to live updates…",
    "Checkout updates complete",
  ]);
});
