"use client";

import {
  checkoutCopy,
  type CheckoutStatus as CheckoutStatusValue,
} from "@checkout/sdk";
import {
  CircleAlert,
  CircleCheck,
  Clock3,
  LoaderCircle,
  type LucideIcon,
} from "lucide-react";
import { useCheckoutScreen } from "@/lib/checkout-screen-context";
import { cn } from "@/lib/utils";

const connectionCopy = {
  idle: "Preparing live updates…",
  connecting: "Connecting to live updates…",
  connected: "Live updates connected",
  disconnected: "Reconnecting to live updates…",
  stopped: "Checkout updates complete",
} as const;

const statusPresentation: Record<
  CheckoutStatusValue,
  {
    icon: LucideIcon;
    tone: string;
    iconTone: string;
  }
> = {
  ready: {
    icon: Clock3,
    tone: "border-sky-200 bg-sky-50",
    iconTone: "text-sky-700",
  },
  offer_review_required: {
    icon: CircleAlert,
    tone: "border-amber-200 bg-amber-50",
    iconTone: "text-amber-700",
  },
  purchase_pending: {
    icon: LoaderCircle,
    tone: "border-sky-200 bg-sky-50",
    iconTone: "animate-spin text-sky-700",
  },
  purchase_failed: {
    icon: CircleAlert,
    tone: "border-red-200 bg-red-50",
    iconTone: "text-red-700",
  },
  expired: {
    icon: CircleAlert,
    tone: "border-neutral-300 bg-neutral-100",
    iconTone: "text-neutral-600",
  },
  abandoned: {
    icon: CircleAlert,
    tone: "border-neutral-300 bg-neutral-100",
    iconTone: "text-neutral-600",
  },
  completed: {
    icon: CircleCheck,
    tone: "border-emerald-200 bg-emerald-50",
    iconTone: "text-emerald-700",
  },
};

export function CheckoutStatus() {
  const { checkout, realtimeStatus } = useCheckoutScreen();
  const status = checkout.snapshot.status;
  const presentation = statusPresentation[status];
  const Icon = presentation.icon;

  return (
    <output
      className={cn(
        "-mx-5 -mb-5 flex gap-3 border-t px-5 py-4 sm:-mx-6 sm:-mb-6 sm:px-6",
        presentation.tone,
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn("mt-0.5 size-5 shrink-0", presentation.iconTone)}
      />
      <div className="min-w-0">
        <p className="font-semibold">{checkoutCopy[status].heading}</p>
        <p className="mt-0.5 text-sm text-neutral-700">
          {checkoutCopy[status].description}
        </p>
        <p className="mt-2 text-xs text-neutral-500">
          {connectionCopy[realtimeStatus]}
        </p>
      </div>
    </output>
  );
}
