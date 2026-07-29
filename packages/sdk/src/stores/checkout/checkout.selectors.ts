import type { CheckoutStoreState } from "./checkout.store";

export function selectSnapshot(state: CheckoutStoreState) {
  return state.snapshot;
}

export function selectStatus(state: CheckoutStoreState) {
  return state.snapshot.status;
}

export function selectOffer(state: CheckoutStoreState) {
  return state.snapshot.session.offer;
}

export function selectHoldDeadline(state: CheckoutStoreState) {
  return state.snapshot.session.inventoryHold.expiresAt;
}

export function selectOrder(state: CheckoutStoreState) {
  return state.snapshot.session.order;
}

export function selectAllowedActions(state: CheckoutStoreState) {
  return state.snapshot.allowedActions;
}

export function selectHasSynchronizedClock(state: CheckoutStoreState) {
  return (
    state.clockAnchor.expiresAtEpochMs ===
    Date.parse(state.snapshot.session.inventoryHold.expiresAt)
  );
}

export function selectCanPurchase(state: CheckoutStoreState) {
  return (
    (state.snapshot.allowedActions.includes("purchase") ||
      state.snapshot.allowedActions.includes("retry_purchase")) &&
    selectHasSynchronizedClock(state)
  );
}
