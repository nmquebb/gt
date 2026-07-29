import { createStore, type StoreApi } from "zustand/vanilla";
import type { ClockAnchor } from "../../clients/clock-anchor";
import type { CheckoutSnapshot } from "../../contracts";

export interface CheckoutStoreState {
  snapshot: CheckoutSnapshot;
  clockAnchor: ClockAnchor;
}

export type SnapshotApplicationResult =
  | "snapshot_applied"
  | "clock_refreshed"
  | "ignored";

export interface CheckoutStoreActions {
  applySnapshot(
    snapshot: CheckoutSnapshot,
    clockAnchor?: ClockAnchor,
  ): SnapshotApplicationResult;
}

export type CheckoutStore = StoreApi<CheckoutStoreState & CheckoutStoreActions>;

export function createCheckoutStore(
  initialState: CheckoutStoreState,
): CheckoutStore {
  const boundSessionId = initialState.snapshot.session.id;

  return createStore<CheckoutStoreState & CheckoutStoreActions>((set, get) => ({
    ...initialState,
    applySnapshot: (snapshot, clockAnchor) => {
      const current = get();
      const currentRevision = current.snapshot.session.revision;

      if (snapshot.session.id !== boundSessionId) {
        return "ignored";
      }

      if (snapshot.session.revision < currentRevision) {
        return "ignored";
      }

      if (snapshot.session.revision === currentRevision) {
        if (clockAnchor === undefined) {
          return "ignored";
        }

        set({ clockAnchor });

        return "clock_refreshed";
      }

      set({
        snapshot,
        ...(clockAnchor === undefined ? {} : { clockAnchor }),
      });

      return "snapshot_applied";
    },
  }));
}
