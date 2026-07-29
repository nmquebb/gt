"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useStore } from "zustand";
import type {
  CheckoutStore,
  CheckoutStoreActions,
  CheckoutStoreState,
} from "../stores/checkout/checkout.store";

const CheckoutStoreContext = createContext<CheckoutStore | null>(null);

interface CheckoutProviderProps {
  store: CheckoutStore;
  children: ReactNode;
}

export function CheckoutProvider({ store, children }: CheckoutProviderProps) {
  return (
    <CheckoutStoreContext.Provider value={store}>
      {children}
    </CheckoutStoreContext.Provider>
  );
}

export function useCheckoutStore<T>(
  selector: (state: CheckoutStoreState & CheckoutStoreActions) => T,
): T {
  return useStore(useCheckoutStoreApi(), selector);
}

export function useCheckoutStoreApi(): CheckoutStore {
  return useContext(CheckoutStoreContext)!;
}
