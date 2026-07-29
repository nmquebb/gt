import type { CheckoutSnapshot } from "../contracts";

export interface ClockAnchor {
  serverEpochAtAnchorMs: number;
  monotonicAtAnchorMs: number;
  requestStartedAtMonotonicMs: number;
  expiresAtEpochMs: number;
}

export interface ClockHandoff {
  remainingHoldMsAtRender: number;
  expiresAtEpochMs: number;
}

export interface ClockAnchorInput {
  serverNow: string;
  expiresAt: string;
  requestStartedAtMs: number;
  responseReceivedAtMs: number;
}

export function createClockAnchor({
  serverNow,
  expiresAt,
  requestStartedAtMs,
  responseReceivedAtMs,
}: ClockAnchorInput): ClockAnchor {
  return {
    serverEpochAtAnchorMs:
      Date.parse(serverNow) + (responseReceivedAtMs - requestStartedAtMs) / 2,
    monotonicAtAnchorMs: responseReceivedAtMs,
    requestStartedAtMonotonicMs: requestStartedAtMs,
    expiresAtEpochMs: Date.parse(expiresAt),
  };
}

export function remainingHoldMs(
  anchor: ClockAnchor,
  monotonicNowMs: number,
): number {
  return Math.max(
    0,
    anchor.expiresAtEpochMs -
      (anchor.serverEpochAtAnchorMs +
        (monotonicNowMs - anchor.monotonicAtAnchorMs)),
  );
}

export function createClockHandoff(
  anchor: ClockAnchor,
  monotonicNowMs: number,
): ClockHandoff {
  return {
    remainingHoldMsAtRender: remainingHoldMs(anchor, monotonicNowMs),
    expiresAtEpochMs: anchor.expiresAtEpochMs,
  };
}

export function hydrateClockHandoff(
  handoff: ClockHandoff,
  monotonicNowMs: number,
): ClockAnchor {
  return {
    serverEpochAtAnchorMs:
      handoff.expiresAtEpochMs - handoff.remainingHoldMsAtRender,
    monotonicAtAnchorMs: monotonicNowMs,
    requestStartedAtMonotonicMs: monotonicNowMs,
    expiresAtEpochMs: handoff.expiresAtEpochMs,
  };
}

export function createRealtimeClockAnchor(
  snapshot: CheckoutSnapshot,
  monotonicNowMs: number,
): ClockAnchor {
  return createClockAnchor({
    serverNow: snapshot.serverNow,
    expiresAt: snapshot.session.inventoryHold.expiresAt,
    requestStartedAtMs: monotonicNowMs,
    responseReceivedAtMs: monotonicNowMs,
  });
}
