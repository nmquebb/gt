import type { QueryClient } from "@tanstack/react-query";
import type { CheckoutCommandResult } from "../clients/checkout.client";

export type CheckoutState = CheckoutCommandResult;

export type CheckoutStateApplication =
  | "state_applied"
  | "clock_refreshed"
  | "ignored";

export function checkoutQueryKey(sessionId: string) {
  return ["checkout", sessionId] as const;
}

export function getCheckoutState(
  queryClient: QueryClient,
  sessionId: string,
): CheckoutState | undefined {
  return queryClient.getQueryData(checkoutQueryKey(sessionId));
}

export function applyCheckoutState(
  queryClient: QueryClient,
  sessionId: string,
  incoming: CheckoutState,
): CheckoutStateApplication {
  if (incoming.snapshot.session.id !== sessionId) {
    return "ignored";
  }

  const current = getCheckoutState(queryClient, sessionId);

  if (current === undefined) {
    queryClient.setQueryData(checkoutQueryKey(sessionId), incoming);
    return "state_applied";
  }

  const currentRevision = current.snapshot.session.revision;
  const incomingRevision = incoming.snapshot.session.revision;

  if (incomingRevision < currentRevision) {
    return "ignored";
  }

  if (incomingRevision === currentRevision) {
    queryClient.setQueryData(checkoutQueryKey(sessionId), {
      snapshot: current.snapshot,
      clockAnchor: incoming.clockAnchor,
    });
    return "clock_refreshed";
  }

  queryClient.setQueryData(checkoutQueryKey(sessionId), incoming);
  return "state_applied";
}
