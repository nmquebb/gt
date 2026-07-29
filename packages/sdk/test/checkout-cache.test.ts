import { QueryClient } from "@tanstack/react-query";
import { describe, expect, test } from "bun:test";
import type { CheckoutCommandResult } from "../src/clients/checkout.client";
import {
  applyCheckoutState,
  getCheckoutState,
} from "../src/cache/checkout-cache";
import { checkoutSnapshotFixture, clockAnchorFixture } from "./fixtures";

const sessionId = "chk_1";

function stateAtRevision(
  revision: number,
  stateSessionId = sessionId,
): CheckoutCommandResult {
  const snapshot = checkoutSnapshotFixture({
    sessionId: stateSessionId,
    revision,
  });

  return {
    snapshot,
    clockAnchor: clockAnchorFixture(snapshot, {
      monotonicAtAnchorMs: revision * 100,
    }),
  };
}

describe("checkout query cache", () => {
  test("an initial checkout result populates its session cache", () => {
    const queryClient = new QueryClient();
    const incoming = stateAtRevision(1);

    expect(applyCheckoutState(queryClient, sessionId, incoming)).toBe(
      "state_applied",
    );
    expect(getCheckoutState(queryClient, sessionId)).toBe(incoming);
  });

  test("a result for another checkout session is ignored", () => {
    const queryClient = new QueryClient();

    expect(
      applyCheckoutState(queryClient, sessionId, stateAtRevision(1, "chk_2")),
    ).toBe("ignored");
    expect(getCheckoutState(queryClient, sessionId)).toBeUndefined();
  });

  test("an older checkout result leaves the cached state intact", () => {
    const queryClient = new QueryClient();
    const current = stateAtRevision(2);
    applyCheckoutState(queryClient, sessionId, current);

    expect(applyCheckoutState(queryClient, sessionId, stateAtRevision(1))).toBe(
      "ignored",
    );
    expect(getCheckoutState(queryClient, sessionId)).toBe(current);
  });

  test("an equal revision refreshes only the incoming clock anchor", () => {
    const queryClient = new QueryClient();
    const current = stateAtRevision(1);
    const incomingSnapshot = checkoutSnapshotFixture({
      revision: 1,
      expiresAt: "2026-07-27T17:02:30.000Z",
    });
    const incoming: CheckoutCommandResult = {
      snapshot: incomingSnapshot,
      clockAnchor: clockAnchorFixture(incomingSnapshot, {
        monotonicAtAnchorMs: 200,
      }),
    };
    applyCheckoutState(queryClient, sessionId, current);

    expect(applyCheckoutState(queryClient, sessionId, incoming)).toBe(
      "clock_refreshed",
    );
    const cached = getCheckoutState(queryClient, sessionId);
    expect(cached?.snapshot).toBe(current.snapshot);
    expect(cached?.snapshot.session.inventoryHold.expiresAt).toBe(
      "2026-07-27T17:01:30.000Z",
    );
    expect(cached?.clockAnchor).toEqual(incoming.clockAnchor);
  });

  test("a newer checkout result replaces the matching cached state", () => {
    const queryClient = new QueryClient();
    applyCheckoutState(queryClient, sessionId, stateAtRevision(1));

    expect(applyCheckoutState(queryClient, sessionId, stateAtRevision(2))).toBe(
      "state_applied",
    );
    expect(
      getCheckoutState(queryClient, sessionId)?.snapshot.session.revision,
    ).toBe(2);
  });
});
