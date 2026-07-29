import { expect, test } from "bun:test";
import {
  checkoutSnapshotFixture,
  clockAnchorFixture,
} from "../../../test/fixtures";
import {
  selectCanPurchase,
  selectHasSynchronizedClock,
} from "./checkout.selectors";
import { createCheckoutStore } from "./checkout.store";

test("applies only a strictly newer authoritative snapshot", () => {
  const initial = checkoutSnapshotFixture({ revision: 3 });
  const initialAnchor = clockAnchorFixture(initial);
  const store = createCheckoutStore({
    snapshot: initial,
    clockAnchor: initialAnchor,
  });

  expect(
    store.getState().applySnapshot(checkoutSnapshotFixture({ revision: 2 })),
  ).toBe("ignored");
  expect(
    store.getState().applySnapshot(checkoutSnapshotFixture({ revision: 3 })),
  ).toBe("ignored");
  expect(
    store.getState().applySnapshot(checkoutSnapshotFixture({ revision: 4 })),
  ).toBe("snapshot_applied");
  expect(store.getState().snapshot.session.revision).toBe(4);
  expect(store.getState().clockAnchor).toBe(initialAnchor);
});

test("never applies a snapshot from a different checkout session", () => {
  const initial = checkoutSnapshotFixture({ revision: 3 });
  const store = createCheckoutStore({
    snapshot: initial,
    clockAnchor: clockAnchorFixture(initial),
  });
  const foreign = checkoutSnapshotFixture({
    sessionId: "chk_other",
    revision: 99,
  });

  expect(
    store.getState().applySnapshot(foreign, clockAnchorFixture(foreign)),
  ).toBe("ignored");
  expect(store.getState().snapshot.session.id).toBe("chk_1");
  expect(store.getState().snapshot.session.revision).toBe(3);
});

test("an equal HTTP snapshot refreshes only the supplied clock anchor", () => {
  const initial = checkoutSnapshotFixture({ revision: 3 });
  const initialAnchor = clockAnchorFixture(initial, {
    requestStartedAtMonotonicMs: 50,
    monotonicAtAnchorMs: 100,
  });
  const store = createCheckoutStore({
    snapshot: initial,
    clockAnchor: initialAnchor,
  });
  const refreshedAnchor = clockAnchorFixture(initial, {
    requestStartedAtMonotonicMs: 25,
    monotonicAtAnchorMs: 200,
  });

  expect(store.getState().applySnapshot(initial, refreshedAnchor)).toBe(
    "clock_refreshed",
  );
  expect(store.getState().snapshot).toBe(initial);
  expect(store.getState().clockAnchor).toBe(refreshedAnchor);
});

test("a newer snapshot replaces its matching clock anchor", () => {
  const initial = checkoutSnapshotFixture({ revision: 1, status: "ready" });
  const newer = checkoutSnapshotFixture({
    revision: 2,
    status: "ready",
    expiresAt: "2026-07-27T17:05:00.000Z",
  });
  const newerAnchor = clockAnchorFixture(newer, {
    requestStartedAtMonotonicMs: 25,
    monotonicAtAnchorMs: 200,
  });
  const store = createCheckoutStore({
    snapshot: initial,
    clockAnchor: clockAnchorFixture(initial),
  });

  expect(store.getState().applySnapshot(newer, newerAnchor)).toBe(
    "snapshot_applied",
  );
  expect(store.getState().snapshot).toBe(newer);
  expect(store.getState().clockAnchor).toBe(newerAnchor);
  expect(selectHasSynchronizedClock(store.getState())).toBe(true);
  expect(selectCanPurchase(store.getState())).toBe(true);
});
