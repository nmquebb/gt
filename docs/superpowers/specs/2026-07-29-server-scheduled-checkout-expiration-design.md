# Server-Scheduled Checkout Expiration Design

## Goal

Transition an active checkout to the canonical `expired` state when its
inventory hold deadline arrives, without requiring another client or API
request.

## Approach

Use one server-side timer per created checkout session. The checkout service
schedules the timer only after the session and listing hold have been persisted.
The timer callback re-enters the existing service locking and transition path so
scheduled expiration has the same behavior as request-driven expiration.

A small scheduler interface keeps wall-clock timers outside the domain service.
The production implementation uses `setTimeout` without keeping the process
alive. Tests use a controllable fake scheduler.

## State Transition

When a scheduled task runs, it acquires the session and listing locks and
re-reads both records.

- An active session at or beyond `inventoryHold.expiresAt` transitions to
  `expired`.
- The listing hold is released.
- An `inventory_hold_expired` activity entry is appended.
- One `checkout_session_updated` event with cause `expired` is published.
- A task that runs before the authoritative clock reaches the deadline is
  rescheduled for the remaining duration.
- A completed, abandoned, expired, or purchasing session is unchanged.

The existing request-driven `expireIfNeeded` checks remain as a fallback and
continue to protect commands at the trust boundary.

## Failure Handling

The production scheduler reports an unexpected task rejection instead of
allowing an unhandled promise rejection. A failed background task does not
fabricate client state; subsequent authenticated reads and commands retain the
existing lazy-expiration fallback.

## Testing

Focused service tests will use the real checkout service with a fake scheduler
and controlled authoritative clock:

1. Creating a session schedules its expiration deadline.
2. Running the task at the deadline expires the session, releases inventory,
   records activity, and publishes the canonical realtime update.
3. Running the task early schedules the remaining delay and does not mutate
   state.
4. Running the task after the session becomes terminal does not create another
   transition or event.

Existing service, route, SDK, web, mobile, build, and browser tests remain the
regression suite. No client behavior or public API contract changes are needed.

## Scope

This change does not add durable scheduling, distributed coordination, or timer
recovery across process restarts. Those guarantees would require durable
checkout storage and are outside this in-memory prototype.
