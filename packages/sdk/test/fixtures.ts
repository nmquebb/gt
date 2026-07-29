import type { ClockAnchor } from "../src/clients/clock-anchor";
import type { CheckoutSnapshot } from "../src/contracts";

interface CheckoutSnapshotFixtureOverrides {
  sessionId?: string;
  revision?: number;
  status?: CheckoutSnapshot["status"];
  expiresAt?: string;
  phase?: CheckoutSnapshot["session"]["phase"];
  allowedActions?: CheckoutSnapshot["allowedActions"];
  payment?: CheckoutSnapshot["session"]["payment"];
}

export function checkoutSnapshotFixture({
  sessionId = "chk_1",
  revision = 1,
  status = "ready",
  expiresAt = "2026-07-27T17:01:30.000Z",
  phase = "active",
  allowedActions = status === "ready" ? ["purchase"] : [],
  payment = { status: "idle" },
}: CheckoutSnapshotFixtureOverrides = {}): CheckoutSnapshot {
  return {
    serverNow: "2026-07-27T17:00:00.000Z",
    session: {
      id: sessionId,
      revision,
      createdAt: "2026-07-27T17:00:00.000Z",
      updatedAt: "2026-07-27T17:00:00.000Z",
      event: {
        name: "Chicago Bears vs. Green Bay Packers",
        venue: "Soldier Field",
        timeLabel: "Sunday at 12:00 PM",
        isDemo: true,
      },
      listing: { id: "lst_101_a_1", section: "101", row: "A", seat: "1" },
      inventoryHold: { expiresAt },
      offer: {
        currency: "USD",
        currentVersion: 1,
        currentTotalCents: 12_500,
        acceptedVersion: 1,
        acceptedTotalCents: 12_500,
      },
      phase,
      payment,
    },
    allowedActions,
    status,
  };
}

export function clockAnchorFixture(
  snapshot: CheckoutSnapshot,
  overrides: Partial<ClockAnchor> = {},
): ClockAnchor {
  return {
    serverEpochAtAnchorMs: Date.parse(snapshot.serverNow),
    monotonicAtAnchorMs: 100,
    requestStartedAtMonotonicMs: 50,
    expiresAtEpochMs: Date.parse(snapshot.session.inventoryHold.expiresAt),
    ...overrides,
  };
}
