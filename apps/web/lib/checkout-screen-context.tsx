"use client";

import { createContext, useContext, type ReactNode } from "react";
import type {
  CheckoutClient,
  CheckoutClientContext,
  RealtimeStatus,
} from "@checkout/sdk";

export interface CheckoutScreenRuntime {
  client: CheckoutClient;
  context: CheckoutClientContext;
  isInteractive: boolean;
  realtimeStatus: RealtimeStatus;
}

const CheckoutScreenContext = createContext<CheckoutScreenRuntime | null>(null);

interface CheckoutScreenProviderProps {
  value: CheckoutScreenRuntime;
  children: ReactNode;
}

export function CheckoutScreenProvider({
  value,
  children,
}: CheckoutScreenProviderProps) {
  return (
    <CheckoutScreenContext.Provider value={value}>
      {children}
    </CheckoutScreenContext.Provider>
  );
}

export function useCheckoutScreen(): CheckoutScreenRuntime {
  const runtime = useContext(CheckoutScreenContext);
  if (runtime === null) {
    throw new Error(
      "useCheckoutScreen must be used within CheckoutScreenProvider",
    );
  }

  return runtime;
}
