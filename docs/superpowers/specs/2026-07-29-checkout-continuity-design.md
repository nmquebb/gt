# Checkout Continuity Design

> **Historical record:** This document describes the original implementation.
> The current simplification design is
> `docs/superpowers/specs/2026-07-29-prototype-simplification-design.md`.

**Status:** Implemented

**Date:** 2026-07-29

**Audience:** Implementers and engineering reviewers

## 1. Purpose

Checkout continuity is a local prototype for starting a single-seat ticket
checkout on the web and continuing the same server-owned session in an Expo
iOS app.

The prototype demonstrates the systems behavior that matters to the checkout
journey:

- a scarce listing is claimed atomically;
- the hold and checkout state remain authoritative on the server;
- web and mobile continue the same session instead of creating separate holds;
- complete updates converge across both surfaces in realtime;
- a changed price requires explicit acceptance;
- the hold countdown remains stable when the device wall clock changes;
- payment can fail and be retried while the hold is valid;
- concurrent purchase commands create at most one pending attempt and one
  order; and
- the important transitions are visible in an activity timeline.

The implementation is intentionally local and in-memory. It favors a direct,
readable path through each workflow over infrastructure intended for a
production deployment.

## 2. Product Workflow

The primary walkthrough is:

1. Open the web listing page.
2. Choose an available seat and press **Buy now**.
3. Atomically create a 90-second inventory hold and checkout session.
4. Render the checkout on the server, then resume it in the browser.
5. Press **Open in app** to launch the same checkout in the iOS Simulator.
6. Resume the session in Expo using the authenticated deep link.
7. Keep a realtime connection open from each active surface.
8. Change the price from the web development controls.
9. Observe the same authoritative price and status on both surfaces.
10. Accept the exact new offer version.
11. Configure the next payment to fail and submit the purchase.
12. Observe the shared failure state, configure success, and retry.
13. Observe one completed order on every connected surface.
14. Review the server-sourced activity timeline.

The development experience also supports forced expiry and a concurrent
purchase scenario. Leaving the web checkout preserves the hold when another
realtime client is connected and releases it when the departing client appears
to be the final active client.

## 3. Scope

The repository contains four workspaces:

```text
apps/
  api/       Hono API and in-memory domain implementation
  web/       Next.js App Router experience
  mobile/    Expo Router iOS experience
packages/
  sdk/       Public contracts, HTTP client, realtime client, store, and hooks
```

The prototype uses:

- TypeScript in strict mode;
- Bun for workspaces, scripts, the API runtime, and tests;
- Hono for REST and WebSocket routes;
- Zod for external runtime contracts;
- `better-result` inside API services and fallible providers;
- Next.js, React, Tailwind CSS, and a small set of shadcn/ui primitives;
- Expo Router and native React Native components;
- Zustand for the portable checkout store;
- TanStack React Query for queries and mutation lifecycle;
- Oxlint and Oxfmt; and
- Playwright for the browser-level continuity walkthrough.

The system does not model a cart, quantity, seat map, customer account, real
authentication, real payment collection, database, queue, or deployment
platform.

## 4. Architecture

The dependency direction is:

```text
web ─────┐
         ├──> SDK contracts, client, store, and React hooks
mobile ──┘
                ▲
                │ public contracts
API ────────────┘
```

The SDK owns all public Zod schemas and types inferred from them. The API
imports `@checkout/sdk/contracts`; the SDK has no dependency on the API or on a
generated Hono application type.

The API path is:

```text
validated route input
  -> CheckoutService
  -> providers (CheckoutMemoryRepository, InMemoryKeyedLock,
                DelayedPaymentSimulator, RealtimeHub)
  -> projected public snapshot
  -> validated HTTP or realtime output
```

One `CheckoutService` owns:

- listing reads;
- session creation and supersession;
- authenticated reads and cross-surface resume;
- explicit leave behavior;
- expiration reconciliation;
- repricing and offer acceptance;
- purchase start and finalization;
- forced development expiry;
- handoff recording; and
- activity reads.

The concrete implementation keeps domain errors, projection, and orchestration
in `apps/api/src/services/checkout`; infrastructure-like in-memory
collaborators live in `apps/api/src/providers`; and Hono boundary modules live
in `apps/api/src/routes` and `apps/api/src/http`. `new Date()`, UUID helpers,
and process timers are used at their call sites. Tests may supply a
deterministic `now` function and a controlled payment simulator.

Checkout projection is a pure function and is the only place that derives
public `status` and `allowedActions`.

## 5. Boundary Parsing and Types

External values are parsed once at system boundaries:

- Hono validates params, query values, headers, and JSON bodies before calling
  the service.
- The SDK parses every HTTP success and error body before exposing it.
- The realtime client parses every WebSocket message before updating the
  store.
- `RealtimeHub` parses the complete outbound event before routing and
  serializing it.
- Web and mobile validate checkout URLs before constructing client context.
- API configuration is parsed at startup.

Internal services receive canonical parsed inputs. Public types are inferred
with `z.infer`; local types use schema inference, function return types, or
indexed access where those forms remain readable.

An idempotency key is any non-empty string. Its behavior is significant; a UUID
shape is not required.

## 6. Static Event and Listings

The prototype has one explicitly labeled demo event:

```ts
{
  name: "Chicago Bears vs. Green Bay Packers";
  venue: "Soldier Field";
  timeLabel: "Sunday at 12:00 PM";
  isDemo: true;
}
```

Six deterministic listings represent individual seats:

```ts
{
  id: string;
  section: string;
  row: string;
  seat: string;
  priceCents: number;
  status: "available" | "held" | "sold";
}
```

Each listing is exactly one seat and one ticket. Public listing responses expose
availability but never expose the owning session, order association, or lock
keys.

The internal listing record may additionally contain:

```ts
{
  heldBySessionId?: string;
  orderId?: string;
}
```

## 7. Checkout Model

One server-owned checkout record coordinates the hold, offer, payment, and
order for a listing.

```ts
interface CheckoutSessionRecord {
  id: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  resumeToken: string;

  initiatedBy: {
    surface: "web" | "mobile";
    deviceId: string;
  };

  event: DemoEvent;

  listing: {
    id: string;
    section: string;
    row: string;
    seat: string;
  };

  inventoryHold: {
    id: string;
    expiresAt: string;
  };

  offer: {
    currency: "USD";
    currentVersion: number;
    currentTotalCents: number;
    acceptedVersion: number;
    acceptedTotalCents: number;
  };

  phase: "active" | "purchasing" | "completed" | "expired" | "abandoned";

  payment: {
    status: "idle" | "pending" | "failed" | "succeeded";
    attemptId?: string;
  };

  order?: {
    id: string;
    completedAt: string;
    completedByDeviceId: string;
  };

  observedClients: Array<{
    surface: "web" | "mobile";
    deviceId: string;
  }>;
}
```

The listing identity and seat details are copied into the session so the
checkout and completed order do not depend on later catalog mutation.

The inventory hold is a persisted business reservation and is distinct from
the short-lived keyed lock used to serialize an operation.

The resume token is an opaque capability credential generated with
cryptographic entropy. It authorizes session reads, commands, development
controls, and realtime connection establishment.

### Public snapshot

Clients receive one complete public projection:

```ts
interface CheckoutSnapshot {
  serverNow: string;
  session: {
    id: string;
    revision: number;
    createdAt: string;
    updatedAt: string;
    event: DemoEvent;
    listing: {
      id: string;
      section: string;
      row: string;
      seat: string;
    };
    inventoryHold: {
      expiresAt: string;
    };
    offer: {
      currency: "USD";
      currentVersion: number;
      currentTotalCents: number;
      acceptedVersion: number;
      acceptedTotalCents: number;
    };
    phase:
      | "active"
      | "purchasing"
      | "completed"
      | "expired"
      | "abandoned";
    payment: {
      status: "idle" | "pending" | "failed" | "succeeded";
    };
    order?: {
      id: string;
      completedAt: string;
      completedByDeviceId: string;
    };
  };
  allowedActions: Array<
    "accept_offer" | "purchase" | "retry_purchase"
  >;
  status:
    | "ready"
    | "offer_review_required"
    | "purchase_pending"
    | "purchase_failed"
    | "expired"
    | "abandoned"
    | "completed";
}
```

The public projection contains no resume token, hold ID, payment-attempt ID,
idempotency key, internal ownership field, or observed-client collection.

### Status precedence

The projection derives one dominant status in this order:

1. `completed`;
2. `abandoned`;
3. `purchase_pending`;
4. `expired`;
5. `offer_review_required`;
6. `purchase_failed`;
7. `ready`.

The projection derives allowed actions:

| Status | Allowed actions |
| --- | --- |
| `ready` | `purchase` |
| `offer_review_required` | `accept_offer` |
| `purchase_failed` | `retry_purchase` |
| all other statuses | none |

Clients render these fields directly and do not recreate server business rules
from timestamps, offer versions, payment fields, or phase.

## 8. Core Invariants

### Server authority

The API is the only authority for:

- checkout phase and public status;
- allowed actions;
- inventory ownership;
- offer acceptance;
- payment-attempt state;
- order creation; and
- abandonment or expiry.

The countdown is a presentation aid. Every command rechecks authoritative state
on the server.

### Purchase uniqueness

For one checkout session:

- at most one payment attempt may be pending at a time;
- at most one order may exist;
- a competing purchase command observes the existing pending attempt;
- finalization applies only to the attempt that is still current; and
- every command after completion returns the existing order state.

### Revision ordering

Every change to public checkout state increments `revision`. Reads and
idempotent no-ops do not. Append-only activity or observational history that
does not change the public projection does not manufacture a revision.

A checkout store is permanently bound to its initial session ID. It ignores:

- snapshots for another session;
- snapshots with an older revision; and
- equal-revision snapshot data.

An equal-revision HTTP result may refresh the checkout's clock anchor without
replacing snapshot data.

### Terminal behavior

`completed`, `expired`, and `abandoned` are terminal business phases. They
remain readable, expose no allowed actions, and stop client realtime work.

## 9. Locking

The in-memory keyed lock accepts one or more resource keys and acquires them in
a stable, deduplicated order.

```text
checkout-owner:<deviceId>
listing:<listingId>
session:<sessionId>
```

- Session creation uses the initiating-device key and the required listing and
  session keys.
- Session mutations use the session and immutable associated-listing keys.
- Expiration and purchase finalization use both listing and session keys.
- Payment authorization runs outside the critical section.

The protected operation reloads records after acquiring its keys. Decisions are
never based solely on a preliminary lookup.

The lock and repository are single-process prototype components. Their
guarantees apply only within the running API process.

## 10. Session Creation and Ownership

Pressing **Buy now**:

1. reconciles an expired hold on the requested listing;
2. serializes work for the initiating device;
3. discovers that device's active or purchasing checkout;
4. acquires the required session and listing keys;
5. rejects creation while the device's existing checkout is purchasing;
6. verifies that the requested listing can be claimed;
7. abandons the device's previous active checkout, if one exists;
8. creates one session and 90-second hold;
9. marks the listing held by the new session;
10. creates and accepts offer version 1;
11. records `checkout_session_created`; and
12. returns the snapshot, resume token, web path, and Expo deep link.

The initiating device may have only one active checkout. Starting a different
checkout supersedes its previous active checkout atomically. A failed attempt
to acquire the requested listing leaves the prior active checkout intact.

Two concurrent creation requests for one available listing produce one session
and one `LISTING_UNAVAILABLE` conflict.

The session is not created by listing load, visibility, focus, or mobile resume.

## 11. Resume, Presence, and Leave

Presence is advisory and is represented by authenticated realtime sockets, not
durable application state.

`resume(surface, deviceId)`:

- authenticates the resume token;
- reconciles expiration;
- records a surface/device pair in `observedClients` only once;
- appends `checkout_session_resumed` only for a newly observed pair; and
- returns the current canonical snapshot.

Repeated resume calls for the same surface and device are safe.

`leave(surface, deviceId)` is an explicit best-effort navigation command:

- an expired session returns its expired snapshot;
- a non-active session is unchanged;
- an active session remains active when more than one realtime socket is
  registered for it; and
- an active session becomes `abandoned` and releases its listing when the
  departing client appears to be the final active socket.

The transition to `abandoned` increments the revision, records
`checkout_session_abandoned` with reason `navigation`, and publishes the
complete terminal snapshot.

Web reload does not send a leave command. It reloads the authoritative snapshot,
resumes, and reconnects. Explicit **Back to listings** waits for leave before
navigating. Mobile route removal sends a best-effort leave; backgrounding the
app is not an explicit exit.

If a disconnect or exit signal is missed, the session may remain active until
its normal hold deadline. This is acceptable for the local prototype.

## 12. Expiration

Expiration is reconciled against server time on relevant listing reads,
session reads, and mutations.

- An active session at or past `expiresAt` becomes `expired`.
- Expiration releases the listing only if it is still held by that session.
- A session already in `purchasing` is allowed to finish authorization.
- A payment failure at or after the hold deadline produces an expired session
  and releases the listing.
- Expired sessions remain readable and expose no commands.

Forced development expiry applies the same terminal transition to an active
session.

The server records `inventory_hold_expired` and publishes an `expired` snapshot
whenever it performs the transition.

## 13. Repricing and Offer Acceptance

Repricing is available only while the session is active.

A successful price change:

- adds a positive safe-integer cent amount, defaulting to 2,000 cents;
- verifies that the resulting total and version remain safe integers;
- increments `currentVersion`;
- updates `currentTotalCents`;
- preserves the accepted version and total;
- increments the session revision;
- records `price_changed`; and
- publishes the complete updated snapshot.

The checkout becomes `offer_review_required`, and Purchase is unavailable.

Offer acceptance:

- is authenticated;
- requires an active, unexpired session;
- accepts only the exact current version;
- is idempotent when that version is already accepted;
- copies the current version and total into the accepted fields;
- records the actor and `price_change_accepted`; and
- publishes `offer_accepted`.

A stale version returns `OFFER_VERSION_MISMATCH` with the latest snapshot.

## 14. Purchase and Idempotency

The purchase command includes surface, device ID, resume token, and a non-empty
idempotency key.

### Start critical section

Under the listing and session locks, the service:

1. authenticates the session;
2. reconciles expiry;
3. resolves a known idempotency key to its own recorded attempt disposition;
4. returns the existing order if the checkout is complete;
5. returns the existing pending state and records
   `duplicate_purchase_prevented` if an attempt is already pending;
6. verifies the hold, listing ownership, phase, and exact accepted offer;
7. creates one pending payment-attempt record;
8. changes the session to `purchasing`;
9. increments the revision;
10. records `checkout_purchase_started`; and
11. publishes `purchase_started`.

The payment attempt captures the offer version, total, currency, initiating
surface, and initiating device.

### Authorization

The delayed payment simulator runs outside the lock. Its default delay is 1,500
milliseconds. The next outcome for a session may be configured as:

```ts
"success" | "failure"
```

The configured outcome is consumed by the next authorization. Success is the
default.

While authorization is running, reads and competing commands can observe the
persisted `purchase_pending` snapshot. A competing purchase returns a pending
disposition without creating another attempt.

### Finalization critical section

The service reacquires the listing and session locks and verifies that the same
attempt remains current.

On success, it:

- marks the attempt succeeded;
- creates one order;
- marks the listing sold;
- marks the checkout completed;
- records `order_completed`; and
- publishes the completed snapshot.

On failure, it:

- marks the attempt failed;
- returns the session to active when the hold remains valid;
- exposes `retry_purchase`;
- records `purchase_failed`; and
- publishes the failed snapshot.

If the deadline elapsed during authorization, failure also expires the session
and releases the listing.

A retry after a definite failure is a new purchase intent with a new
idempotency key. Replaying an earlier key returns the disposition of that key's
attempt along with the latest checkout snapshot. An unseen key after completion
returns the existing completed order.

## 15. REST API

Successful responses use contract-specific resource shapes without a universal
`data` envelope:

- listing and health reads return their resources directly;
- creation returns `{ snapshot, resumeToken, links: { webPath, deepLink } }`;
- session reads and state-changing snapshot commands return `{ snapshot }`;
- purchase returns `{ disposition, snapshot, duplicatePrevented }`;
- activity returns the typed entry array directly; and
- development commands without a resource body return JSON `null`.

Errors use:

```ts
{
  code: string;
  message: string;
  snapshot?: CheckoutSnapshot;
}
```

State conflicts include the latest snapshot when it is safe and useful.
Authentication and not-found failures do not expose session state.

### Fan-facing resources

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/v1/health` | Local readiness |
| `GET` | `/v1/listings` | Demo event and listings |
| `POST` | `/v1/checkout-sessions` | Claim a listing and create a session |
| `GET` | `/v1/checkout-sessions/:sessionId` | Authenticated authoritative read |
| `PUT` | `/v1/checkout-sessions/:sessionId/clients/:deviceId` | Resume on a surface |
| `DELETE` | `/v1/checkout-sessions/:sessionId` | Explicit best-effort leave |
| `PUT` | `/v1/checkout-sessions/:sessionId/offer-acceptance` | Accept the current offer |
| `POST` | `/v1/checkout-sessions/:sessionId/purchase` | Start, observe, retry, or recover purchase |
| `GET` | `/v1/checkout-sessions/:sessionId/events` | Authenticated WebSocket upgrade |

Session creation accepts:

```ts
{
  listingId: string;
  surface: "web";
  deviceId: string;
}
```

Resume accepts the surface in the body and the device ID in the path. Leave,
offer acceptance, and purchase identify the actor with `surface` and
`deviceId`.

Session reads and commands use:

```text
Authorization: Bearer <resume-token>
```

Purchase additionally uses:

```text
Idempotency-Key: <non-empty-string>
```

Purchase returns `202` when a competing request observes pending work and `200`
for a settled disposition. State conflicts use `409`; expired commands use
`410`.

### Development resources

The local prototype always exposes:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/v1/dev/checkout-sessions/:sessionId/activity` | Read activity |
| `POST` | `/v1/dev/checkout-sessions/:sessionId/reprice` | Increase the offer |
| `POST` | `/v1/dev/checkout-sessions/:sessionId/expire` | Force expiry |
| `PUT` | `/v1/dev/checkout-sessions/:sessionId/next-payment-outcome` | Set success or failure |
| `POST` | `/v1/dev/checkout-sessions/:sessionId/open-ios-simulator` | Launch the Expo deep link |

Every development resource is authenticated with the session resume token.

The simulator launcher constructs the trusted deep link from server-owned
session data and invokes:

```text
bunx uri-scheme open <deep-link> --ios
```

It passes an argument array directly and never accepts an arbitrary URL or
shell command from the request.

## 16. Error Semantics

Expected service failures are represented explicitly with `better-result`.
Hono translates them into stable HTTP errors:

| Status | Code | Meaning |
| --- | --- | --- |
| `400` | `INVALID_REQUEST` | Request input failed validation |
| `400` | `INVALID_IDEMPOTENCY_KEY` | Purchase key is absent or empty |
| `400` | `INVALID_PRICE_ADJUSTMENT` | Reprice arithmetic is invalid |
| `401` | `UNAUTHORIZED_SESSION` | Resume credential is invalid |
| `404` | `CHECKOUT_SESSION_NOT_FOUND` | Session does not exist |
| `404` | `REST_RESOURCE_NOT_FOUND` | REST path or method is not exposed |
| `409` | `LISTING_UNAVAILABLE` | Listing cannot be claimed |
| `409` | `OFFER_VERSION_MISMATCH` | A stale offer was submitted |
| `409` | `PURCHASE_NOT_ALLOWED` | Current state disallows purchase |
| `410` | `CHECKOUT_SESSION_EXPIRED` | Hold has expired |
| `500` | `INTERNAL_SERVER_ERROR` | Unexpected server failure |

The SDK uses ordinary rejected promises for application consumption. A
`CheckoutClientError` represents network failure, malformed server data, and
API errors. When an API conflict contains a snapshot, the error also carries
that parsed snapshot and its clock anchor so command hooks can reconcile the
store before presenting the error.

## 17. Realtime Protocol

The WebSocket endpoint authenticates with the session ID and resume token. The
token is passed as the `token` query parameter for the local connection.

Every message has one schema:

```ts
interface CheckoutSessionUpdatedEvent {
  type: "checkout_session_updated";
  cause:
    | "initial_sync"
    | "repriced"
    | "offer_accepted"
    | "purchase_started"
    | "purchase_failed"
    | "completed"
    | "expired"
    | "abandoned";
  snapshot: CheckoutSnapshot;
}
```

On connection, the API:

1. authenticates the upgrade;
2. registers the socket by session ID;
3. performs a fresh authenticated read; and
4. sends one complete `initial_sync` snapshot.

Registering before the fresh read ensures a concurrent transition is observed
through publication, the initial read, or both. Duplicate delivery is harmless
because clients accept only newer revisions.

The realtime hub:

- validates the complete event before serialization;
- routes it using the parsed snapshot session ID;
- publishes only complete snapshots;
- removes sockets whose sends fail; and
- reports the active socket count used by explicit leave behavior.

The client:

- parses each message with Zod;
- verifies the active session ID;
- applies only a newer revision;
- creates a fresh monotonic clock anchor from a newer realtime snapshot;
- invalidates listing and activity queries after an applied update;
- reconnects after one second when a nonterminal connection closes; and
- stops after a terminal snapshot or unmount.

Realtime sends no countdown ticks or partial state patches.

## 18. SDK State Ownership

The SDK contains:

```text
src/
  clients/
  contracts/
  presentation/
  react/
  realtime/
  stores/checkout/
```

Stable device identity is platform-specific and therefore lives in
`apps/web/lib/device-id.ts` and `apps/mobile/src/device-id.ts`, rather than in
the portable SDK.

### Checkout client context

One immutable context configures commands and realtime for an active checkout:

```ts
interface CheckoutClientContext {
  readonly sessionId: string;
  readonly resumeToken: string;
  readonly surface: "web" | "mobile";
  readonly deviceId: string;
}
```

Credentials and actor identity are configuration, not mutable checkout state.

### Checkout store

One vanilla Zustand store belongs to one checkout subtree:

```ts
interface CheckoutStoreState {
  snapshot: CheckoutSnapshot;
  clockAnchor: ClockAnchor;
}
```

`applySnapshot` returns:

```ts
type SnapshotApplicationResult =
  | "snapshot_applied"
  | "clock_refreshed"
  | "ignored";
```

The store contains no fetch, WebSocket, timer, DOM, Next.js, or React Native
code. It is never process-global.

### React and React Query

React provides:

- a provider around a supplied checkout store;
- narrow selector hooks;
- command hooks that apply returned snapshots;
- conflict reconciliation;
- a realtime lifecycle hook; and
- connection status.

React Query owns listing queries, activity history, development mutations, and
command mutation state. It does not cache a second authoritative checkout
snapshot.

Command hooks invalidate related listing or activity data after successful
mutations. Realtime updates do the same after applying a newer snapshot.

## 19. Monotonic Clock and Countdown

Every snapshot contains:

```text
serverNow
session.inventoryHold.expiresAt
```

For an HTTP response, the SDK records monotonic request start and response
arrival times. It estimates server time at receipt as:

```text
serverNow + half the measured round-trip time
```

The resulting `ClockAnchor` contains:

```ts
{
  serverEpochAtAnchorMs: number;
  monotonicAtAnchorMs: number;
  requestStartedAtMonotonicMs: number;
  expiresAtEpochMs: number;
}
```

Remaining time is:

```text
expiresAt
  - (server time at anchor + monotonic elapsed time)
```

It never depends on repeated device wall-clock reads.

For SSR, the server passes the remaining hold duration and expiration epoch to
the browser. Hydration anchors that duration in the browser's own monotonic time
domain. The browser then resumes the checkout and may refresh the anchor from
the measured HTTP response.

A newer realtime snapshot creates a fresh anchor at message receipt. Countdown
state remains local to the isolated countdown and purchase controls rather than
ticking in Zustand.

Web and mobile update the displayed countdown once per second and use
`Math.ceil` for displayed seconds. Purchase is disabled locally at zero. The
server remains authoritative for the actual expiry transition.

## 20. Web Experience

### Listings

The dynamically rendered `/` route prefetches listings with a request-scoped
React Query client and hydrates the result into the interactive list.

The page shows:

- the demo-event label;
- event, venue, and time;
- section, row, seat, total, and availability for every listing; and
- one **Buy now** action for each available listing.

Only the selected action enters a pending state while checkout creation runs.
Navigation occurs after the API returns the created session and hold.

### Checkout

`/checkout/[sessionId]?token=<resumeToken>` is dynamically rendered with
caching disabled.

The server validates the route, performs an authenticated checkout read, and
renders useful event, seat, price, hold, and status content before browser
resume completes.

The browser lifecycle is:

```text
SSR read
  -> hydrate snapshot and clock handoff
  -> resolve stable browser device ID
  -> resume checkout
  -> apply fresh snapshot and anchor
  -> enable commands
  -> connect realtime
```

While resume is pending, the checkout remains visible but non-interactive. A
network failure offers **Retry connection**. Unauthorized and missing sessions
show specific unavailable states.

The interactive checkout contains:

- Back to listings;
- checkout summary and shared status copy;
- isolated hold countdown;
- exact-offer acceptance when allowed;
- Purchase or Retry purchase when allowed;
- pending progress;
- confirmed order;
- Open in app;
- activity timeline; and
- a lazy, collapsed **Dev** control.

The development control changes price, forces expiry, and chooses whether the
next payment succeeds or fails.

## 21. Expo Experience

The native app uses Expo Router and the custom scheme:

```text
gametime://checkout/<sessionId>?token=<resumeToken>
```

The route validates the protocol, host, session ID, and exactly one token. It
then:

1. resolves a stable mobile device ID;
2. resumes the checkout with `surface: "mobile"`;
3. creates a checkout store from the response and HTTP clock anchor;
4. connects realtime;
5. renders the same status, offer, actions, countdown, and order; and
6. sends a best-effort leave if the checkout route is removed while active.

A changed deep link creates a new route subtree keyed by session ID and token.

The native loading states distinguish invalid, unauthorized, missing, offline,
and unexpected failures. Offline bootstrap offers Retry.

The UI uses native `View`, `Text`, `Pressable`, and `ScrollView` components with
local theme tokens. Web DOM components are not shared with React Native.
Platform-neutral contracts, clock logic, status copy, currency formatting,
store behavior, commands, and realtime behavior are shared through the SDK.

## 22. Device Identity

The web stores a non-secret device ID in local storage. When storage is
unavailable, it uses a generated ID for that call.

The Expo app stores a non-secret device ID with SecureStore. When the read or
write fails, it returns a generated runtime ID.

Device IDs identify a browser profile or app installation/runtime. They are
not accounts, authentication credentials, or cross-device customer identity.

## 23. Activity and Measurement

The API records append-only typed activity:

- `checkout_session_created`;
- `app_handoff_opened`;
- `checkout_session_resumed`;
- `price_changed`;
- `price_change_accepted`;
- `checkout_purchase_started`;
- `duplicate_purchase_prevented`;
- `purchase_failed`;
- `inventory_hold_expired`;
- `checkout_session_abandoned`; and
- `order_completed`.

Every entry contains an activity ID, timestamp, session ID, and revision.
Actor-driven entries contain surface and device ID. Event-specific details are
narrow and schema-defined.

No activity entry contains a resume token, idempotency key, payment-attempt ID,
stack trace, or arbitrary request body.

The activity timeline is a diagnostic view of server behavior. The events can
support measures such as:

- cross-surface resume rate;
- completion after a mobile resume;
- time from checkout creation to mobile resume;
- price-change acceptance;
- payment-failure recovery;
- hold expiry or abandonment; and
- prevented duplicate purchases.

These measures describe behavior; they do not establish that continuity causes
higher conversion.

## 24. UI Direction

Web and Expo use the same restrained product language while retaining native
component systems.

- narrow centered content;
- neutral background and primary surfaces;
- simple vertical listing rows;
- consistent spacing, radius, border, typography, and button height;
- one primary checkout action at a time;
- shared status headings and descriptions;
- visible previous and current prices during offer review;
- collapsed development controls; and
- no dashboard shell, seat map, QR code, decorative animation, or large
  illustration.

Components subscribe to the smallest useful checkout-store selection. The
countdown updates its own text instead of rerendering the entire checkout.

## 25. Security and Prototype Limits

The resume token is a local capability credential. The browser route, Expo deep
link, and WebSocket URL carry it in a URL. Local access logs, browser history,
or development tooling may therefore observe it.

A production system requires:

- authenticated customer identity;
- one-time or cookie-based handoff credentials;
- universal links or app links;
- durable transactional storage;
- a unique checkout-to-order constraint;
- durable request and provider idempotency;
- real inventory reservation;
- real payment authorization;
- distributed synchronization;
- a durable outbox or pub/sub path; and
- production analytics, monitoring, and secret handling.

The local repository, lock, payment simulator, socket registry, and activity
history are lost when the API process restarts. Realtime socket count is
advisory and does not claim durable presence.

## 26. Verification Strategy

Tests protect visible workflow behavior, domain invariants, and boundary
validation.

### Service tests

Service tests use the real in-memory repository, locks, projection, activity,
and realtime hub with deterministic clocks or payment behavior where needed.

Required coverage includes:

- seeded single-seat listings;
- concurrent listing acquisition;
- same-device checkout supersession;
- a purchasing checkout blocking replacement;
- cross-surface resume without a second session;
- explicit leave with one and multiple realtime clients;
- expiration and listing release;
- forced expiry;
- reprice and exact-version acceptance;
- stale-offer conflict snapshots;
- generic payment failure;
- retry and success;
- failure after the hold deadline;
- idempotency-key replay;
- concurrent purchase commands;
- one pending attempt and one order;
- status precedence and allowed actions; and
- revision and activity behavior.

### Boundary and SDK tests

Required coverage includes:

- malformed params, headers, bodies, and query values;
- any non-empty idempotency key;
- direct success data and structured errors;
- malformed API success and error responses;
- outbound realtime validation and session routing;
- malformed, foreign, equal, older, and newer realtime events;
- session-bound store behavior;
- equal-revision clock refresh;
- HTTP clock anchoring and SSR handoff;
- terminal realtime shutdown and fixed-delay reconnect;
- command-hook snapshot application and conflict reconciliation; and
- stable browser and native device identity.

### Client tests

Focused web and mobile tests cover:

- listing creation and navigation;
- non-interactive web resume;
- retryable web resume failure;
- explicit web exit;
- shared status and allowed-action presentation;
- countdown and zero-time purchase disabling;
- offer acceptance;
- purchase and retry labels;
- development controls;
- deep-link validation;
- native bootstrap states; and
- native route-removal leave behavior.

### Browser walkthrough

One Playwright scenario proves the full system path:

```text
listing
  -> web checkout
  -> mobile-equivalent realtime connection and resume
  -> web exit without abandonment
  -> web resume
  -> reprice and accept
  -> payment failure from mobile
  -> retry and success from web
  -> one confirmed order and activity history
```

### Verification commands

The normal repository verification set is:

```sh
bun run fmt
bun run fmt:check
bun run lint
bun run typecheck
bun test
bun run --cwd apps/web build
bun run test:e2e
(cd apps/mobile && bun x expo export --platform ios)
```

The simulator handoff is verified manually when macOS, Xcode, and an installed
Expo development build are available.

## 27. Acceptance Criteria

The prototype is complete when:

- the listing page renders the labeled demo event and six single-seat
  listings;
- Buy now atomically claims an available listing;
- concurrent creation cannot give one listing to two sessions;
- an initiating device has at most one active checkout;
- the web checkout includes useful server-rendered content;
- browser resume establishes a fresh snapshot before enabling commands;
- the iOS handoff opens the real Expo route;
- Expo resumes the same session and inventory hold;
- complete authoritative snapshots converge over authenticated WebSockets;
- leaving one of multiple connected surfaces preserves the checkout;
- leaving the final connected surface releases the active checkout;
- normal expiry remains the fallback for missed disconnects;
- repricing blocks purchase until the exact version is accepted;
- the countdown uses server time and monotonic elapsed time;
- payment failure is retryable while the hold remains valid;
- concurrent purchase commands create at most one pending attempt and one
  order;
- both surfaces converge on the same completed order;
- the activity timeline records the important transitions;
- malformed external values cannot enter internal services or stores;
- format, lint, strict typecheck, focused tests, web build, Playwright, and Expo
  export pass; and
- documentation states the in-memory and credential-handling limitations
  accurately.
