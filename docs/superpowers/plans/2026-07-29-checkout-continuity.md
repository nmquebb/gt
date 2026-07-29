# Checkout Continuity Implementation Plan

> **Historical record:** This document describes the original implementation.
> The current simplification design is
> `docs/superpowers/specs/2026-07-29-prototype-simplification-design.md`.

**Status:** Implemented

**Date:** 2026-07-29

**Design:** `docs/superpowers/specs/2026-07-29-checkout-continuity-design.md`

## Goal

Build a local four-workspace prototype in which a web checkout and an Expo iOS
app resume one server-owned single-seat checkout, converge through complete
realtime snapshots, and complete at most one order.

This plan reflects the repository as implemented. File names, test locations,
response wrappers, and verification commands below are the current codebase,
not a proposed reorganization.

## Architecture

The SDK owns public Zod contracts, the parsed HTTP client, monotonic clock
logic, the session-bound Zustand store, realtime lifecycle, and React bindings.

The Hono API validates external input and delegates canonical values to one
`CheckoutService`. The service coordinates the in-memory repository, stable
multi-key lock, delayed payment simulator, realtime hub, and pure checkout
projection. Next.js and Expo Router build platform-specific interfaces around
the same SDK session context and authoritative snapshots.

## Technology and Scope

- Strict TypeScript and Bun workspaces, runtime, scripts, and tests.
- Hono, Zod, and `better-result` in the API.
- Next.js App Router, React, Tailwind CSS, and small local shadcn-style
  primitives on web.
- Expo Router, React Native, and SecureStore on iOS.
- Zustand and TanStack React Query through the portable SDK bindings.
- Oxlint, Oxfmt, Playwright, Next production build, and Expo iOS export for
  verification.
- Local, in-memory behavior only. No database, queue, real authentication,
  payment collection, customer account, cart, quantity, or deployment
  infrastructure.

## Implemented Repository Layout

```text
package.json
bunfig.toml
tsconfig.base.json
oxlint.config.ts
.oxfmtrc.json
playwright.config.ts

packages/sdk/
  src/contracts/                  Public Zod contracts
  src/clients/                    HTTP client, errors, and clock anchors
  src/presentation/               Shared currency and checkout copy
  src/stores/checkout/            Session-bound vanilla Zustand store
  src/realtime/                   Parsed WebSocket subscription lifecycle
  src/react/                      Provider and command/realtime hooks
  test/                           SDK boundary, hook, and realtime tests

apps/api/
  src/fixtures.ts                 Demo event and deterministic listings
  src/providers/                  Repository, lock, payment, realtime, launcher
  src/services/checkout/          Domain errors, projection, and service
  src/http/                       Authentication, links, and error translation
  src/routes/                     REST, development, and WebSocket routes
  src/config.ts                   Startup environment parsing
  src/composition.ts              Dependency composition
  src/app.ts                      Hono application composition
  src/server.ts                   Bun startup and WebSocket adapter
  test/                           Service, route, provider, and realtime tests

apps/web/
  app/                            Dynamic listing and checkout routes
  components/                     Listing and checkout presentation
  components/ui/                  Local UI primitives
  lib/                            API, QueryClient, device, and view adapters
  e2e/                            Playwright continuity walkthrough

apps/mobile/
  app/                            Expo Router entry and checkout route
  src/                            Deep-link, identity, theme, and checkout UI
  ios/                            Generated native iOS project

docs/
  superpowers/specs/              Implemented design
  superpowers/plans/              This implementation record
```

## Global Invariants

- [x] There are exactly four workspaces: `apps/api`, `apps/web`,
  `apps/mobile`, and `packages/sdk`.
- [x] Public schemas and inferred types live in `@checkout/sdk/contracts`; the
  SDK does not depend on API implementation types.
- [x] Hono routes parse params, queries, bodies, bearer credentials, and
  idempotency headers before invoking service behavior.
- [x] The SDK parses every HTTP success/error body and every WebSocket message.
- [x] `RealtimeHub` validates complete outbound events before routing or
  serialization.
- [x] One checkout owns one seat, one offer, and one 90-second inventory hold.
- [x] Resume tokens use cryptographic entropy and are absent from public
  snapshots and activity.
- [x] Payment authorization defaults to success after 1,500 milliseconds and
  runs outside keyed-lock critical sections.
- [x] Public state changes increment `revision`; observational activity and
  idempotent reads do not.
- [x] `projectCheckout` is the only source of public `status` and
  `allowedActions`.
- [x] Realtime publishes complete snapshots, never patches or countdown ticks.
- [x] Countdown state uses server time plus monotonic elapsed time and disables
  purchase locally at zero.
- [x] The simulator launcher accepts only a server-constructed deep link and
  passes an argument array to `bunx uri-scheme open`.
- [x] Documentation identifies URL-carried capability-token and in-memory
  durability limits.

## Task 1: Establish Workspaces, Tooling, and Public Contracts

**Implemented files**

- `package.json`
- `bunfig.toml`
- `tsconfig.base.json`
- `oxlint.config.ts`
- `.oxfmtrc.json`
- `.eslintignore`
- `.prettierignore`
- `.gitignore`
- `packages/sdk/package.json`
- `packages/sdk/tsconfig.json`
- `packages/sdk/src/contracts/common.contract.ts`
- `packages/sdk/src/contracts/listing.contract.ts`
- `packages/sdk/src/contracts/checkout.contract.ts`
- `packages/sdk/src/contracts/activity.contract.ts`
- `packages/sdk/src/contracts/realtime.contract.ts`
- `packages/sdk/src/contracts/index.ts`
- `packages/sdk/test/contracts.test.ts`

**Completed work**

- [x] Configure Bun workspaces, root development/quality scripts, and
  repository verification commands for Playwright, the web build, and mobile
  export.
- [x] Enable strict TypeScript, including unchecked-index and exact-optional
  checking.
- [x] Define the demo event, listing, checkout snapshot, activity, realtime,
  request, response, link, and API error schemas in the SDK.
- [x] Model checkout snapshot endpoints with
  `CheckoutSnapshotResponseSchema`, creation with
  `CreatedCheckoutResponseSchema`, and purchase with
  `PurchaseResponseSchema`.
- [x] Restrict session creation to `surface: "web"` and accept any non-empty
  idempotency header value.
- [x] Infer exported public types from their Zod schemas.
- [x] Verify that private checkout data cannot appear in production REST or
  realtime serialization.

## Task 2: Build the In-Memory Domain Foundation

**Implemented files**

- `apps/api/package.json`
- `apps/api/tsconfig.json`
- `apps/api/src/fixtures.ts`
- `apps/api/src/providers/memory-checkout-repository.ts`
- `apps/api/src/providers/keyed-lock.ts`
- `apps/api/src/providers/realtime-hub.ts`
- `apps/api/src/services/checkout/checkout.errors.ts`
- `apps/api/src/services/checkout/checkout.projection.ts`
- `apps/api/test/contract.test.ts`
- `apps/api/test/realtime.test.ts`

**Completed work**

- [x] Seed the labeled Bears/Packers demo event and six deterministic,
  distinct single-seat listings.
- [x] Store private listing ownership, checkout sessions, payment attempts,
  orders, and append-only activity in `CheckoutMemoryRepository`.
- [x] Acquire deduplicated lock keys in sorted order with
  `InMemoryKeyedLock.withKeys`.
- [x] Project only public checkout fields from private session records.
- [x] Apply the status precedence `completed`, `abandoned`,
  `purchase_pending`, `expired`, `offer_review_required`,
  `purchase_failed`, then `ready`.
- [x] Derive `purchase`, `accept_offer`, and `retry_purchase` exclusively from
  the projected status.
- [x] Validate realtime events before sending and remove failed socket
  transports from the registry.

## Task 3: Implement Checkout Creation, Resume, Leave, and Expiration

**Implemented files**

- `apps/api/src/services/checkout/checkout.service.ts`
- `apps/api/test/checkout.service.test.ts`
- `apps/api/test/routes.test.ts`
- `apps/api/test/fixtures.ts`

**Completed work**

- [x] Reconcile an expired listing hold before listing reads and session
  creation.
- [x] Serialize creation by initiating-device ownership plus affected listing
  and session keys.
- [x] Reject an unavailable listing without disturbing the initiating
  device's prior active checkout.
- [x] Supersede a prior active checkout only after the requested listing can be
  claimed; block replacement while purchase is pending.
- [x] Create a cryptographically authenticated session, accepted offer version
  1, and 90-second hold.
- [x] Resume a new surface/device pair idempotently and record observational
  activity without changing public revision.
- [x] Preserve an active checkout when explicit leave observes another
  realtime socket.
- [x] Abandon and release the hold when explicit leave appears to come from the
  final active client.
- [x] Expire active sessions against server time, release only their own held
  listing, publish a terminal snapshot, and leave purchasing sessions alone
  until authorization settles.
- [x] Support development-forced expiry through the same terminal transition.

## Task 4: Implement Repricing and Exact Offer Acceptance

**Implemented files**

- `apps/api/src/services/checkout/checkout.service.ts`
- `apps/api/src/routes/checkout.routes.ts`
- `apps/api/src/routes/dev.routes.ts`
- `apps/api/test/checkout.service.test.ts`
- `apps/api/test/routes.test.ts`

**Completed work**

- [x] Increase an active offer by a positive safe-integer amount, defaulting to
  2,000 cents.
- [x] Reject invalid or unsafe reprice arithmetic with
  `INVALID_PRICE_ADJUSTMENT`.
- [x] Preserve accepted offer fields while advancing the current offer version
  and total.
- [x] Require acceptance of the exact current version and return
  `OFFER_VERSION_MISMATCH` with a current snapshot for stale acceptance.
- [x] Make repeated acceptance of the already accepted current version an
  idempotent no-op.
- [x] Record typed `price_changed` and `price_change_accepted` activity and
  publish complete snapshots.

## Task 5: Implement Payment Failure, Retry, and Purchase Uniqueness

**Implemented files**

- `apps/api/src/providers/payment-simulator.ts`
- `apps/api/src/services/checkout/checkout.service.ts`
- `apps/api/test/payment-simulator.test.ts`
- `apps/api/test/checkout.service.test.ts`
- `apps/api/test/routes.test.ts`

**Completed work**

- [x] Configure one next payment outcome per session, consume it when
  authorization begins, and default to success.
- [x] Create the payment attempt and persisted `purchase_pending` snapshot
  under the session/listing lock.
- [x] Capture offer version, total, currency, surface, device, and idempotency
  key on the private attempt.
- [x] Run the delayed provider call outside all locks.
- [x] Return an existing key's recorded disposition without creating a second
  attempt.
- [x] Return `pending` with `duplicatePrevented: true` for a competing unseen
  key while an attempt is in progress.
- [x] Finalize only the still-current pending attempt under the same lock keys.
- [x] Create at most one order, mark the listing sold on success, and publish
  one completed snapshot.
- [x] Return to active `purchase_failed` state when a failed authorization
  settles before expiry.
- [x] Expire and release the listing when a failed authorization settles after
  the hold deadline.
- [x] Permit retry with a new intent and idempotency key while the hold remains
  valid.

## Task 6: Expose HTTP, Development, and WebSocket Boundaries

**Implemented files**

- `apps/api/src/http/auth.ts`
- `apps/api/src/http/error-response.ts`
- `apps/api/src/http/links.ts`
- `apps/api/src/routes/health.routes.ts`
- `apps/api/src/routes/listing.routes.ts`
- `apps/api/src/routes/checkout.routes.ts`
- `apps/api/src/routes/dev.routes.ts`
- `apps/api/src/routes/realtime.routes.ts`
- `apps/api/src/providers/ios-simulator-launcher.ts`
- `apps/api/src/config.ts`
- `apps/api/src/composition.ts`
- `apps/api/src/app.ts`
- `apps/api/src/server.ts`
- `apps/api/test/routes.test.ts`
- `apps/api/test/realtime.test.ts`

**Completed work**

- [x] Parse startup `PORT` and `WEB_BASE_URL` configuration with Zod and return
  a `better-result` failure for invalid configuration.
- [x] Compose REST and WebSocket routes independently so REST CORS middleware
  does not interfere with upgrade requests.
- [x] Expose health, listings, create, read, resume, leave, accept, purchase,
  activity, reprice, expire, payment scenario, simulator handoff, and events
  resources under `/v1`.
- [x] Translate expected tagged service errors to stable 400, 401, 404, 409,
  and 410 responses; sanitize unexpected errors as
  `INTERNAL_SERVER_ERROR`.
- [x] Return no snapshot for authentication and missing-session failures and a
  parsed snapshot for useful state conflicts.
- [x] Register realtime sockets before the fresh authenticated initial read so
  a concurrent transition is observed by publication, initial sync, or both.
- [x] Clean up registrations after close, error, failed reads, and failed
  sends.
- [x] Construct links centrally as `links.webPath` and `links.deepLink`.
- [x] Launch iOS only with
  `Bun.spawn(["bunx", "uri-scheme", "open", deepLink, "--ios"])` and record
  handoff activity after a successful launch.

## Task 7: Implement the Parsed SDK Client, Clock, and Store

**Implemented files**

- `packages/sdk/src/clients/client.errors.ts`
- `packages/sdk/src/clients/checkout.client.ts`
- `packages/sdk/src/clients/clock-anchor.ts`
- `packages/sdk/src/presentation/checkout-copy.ts`
- `packages/sdk/src/stores/checkout/checkout.selectors.ts`
- `packages/sdk/src/stores/checkout/checkout.store.ts`
- `packages/sdk/src/index.ts`
- `packages/sdk/test/checkout.client.test.ts`
- `packages/sdk/test/checkout-context.test.ts`
- `packages/sdk/src/stores/checkout/checkout.store.test.ts`

**Completed work**

- [x] Parse every successful response and structured API error before exposing
  data to callers.
- [x] Represent network, malformed-response, and API failures with rejected
  `CheckoutClientError` promises.
- [x] Attach a parsed conflict snapshot and measured clock anchor to safe API
  state conflicts.
- [x] Build authenticated REST and encoded WebSocket URLs from one immutable
  `CheckoutClientContext`.
- [x] Estimate server time at HTTP receipt using half the measured round-trip
  time.
- [x] Handoff SSR remaining duration into the browser monotonic clock domain
  and create fresh anchors for realtime snapshots.
- [x] Keep the Zustand store bound permanently to its initial checkout session.
- [x] Ignore foreign and older snapshots, refresh only the clock for
  equal-revision HTTP results, and replace state only for newer revisions.
- [x] Share stable customer copy and integer-cents USD formatting across web
  and mobile.

## Task 8: Implement SDK React Commands and Realtime Lifecycle

**Implemented files**

- `packages/sdk/src/react/checkout-context.ts`
- `packages/sdk/src/react/checkout-provider.tsx`
- `packages/sdk/src/react/use-checkout-commands.ts`
- `packages/sdk/src/react/use-checkout-realtime.ts`
- `packages/sdk/src/realtime/checkout-subscription.ts`
- `packages/sdk/test/checkout-hooks.test.tsx`
- `packages/sdk/test/checkout-realtime-hook.test.tsx`
- `packages/sdk/test/checkout-subscription.test.ts`

**Completed work**

- [x] Provide a checkout store per mounted checkout subtree and narrow selector
  subscriptions.
- [x] Apply canonical command results and reconcile snapshots carried by
  `CheckoutClientError`.
- [x] Generate one new idempotency key for each purchase mutation.
- [x] Invalidate related listing and activity queries after applicable
  commands.
- [x] Parse WebSocket messages, reject foreign/malformed/stale events, and
  apply only a newer complete snapshot.
- [x] Re-anchor the monotonic clock at realtime receipt and invalidate related
  queries after an applied event.
- [x] Reconnect after one second for nonterminal disconnections.
- [x] Stop realtime work after a completed, expired, or abandoned snapshot or
  subtree unmount.

## Task 9: Build Dynamic Web Listings and Checkout Bootstrap

**Implemented files**

- `apps/web/package.json`
- `apps/web/app/layout.tsx`
- `apps/web/app/providers.tsx`
- `apps/web/app/page.tsx`
- `apps/web/app/checkout/[sessionId]/page.tsx`
- `apps/web/app/checkout/[sessionId]/checkout-client-boundary.tsx`
- `apps/web/components/listing-list.tsx`
- `apps/web/components/buy-now-button.tsx`
- `apps/web/lib/api.ts`
- `apps/web/lib/query-client.ts`
- `apps/web/lib/device-id.ts`
- `apps/web/lib/realtime-environment.ts`
- `apps/web/app/checkout/[sessionId]/checkout-client-boundary.test.tsx`
- `apps/web/lib/device-id.test.ts`

**Completed work**

- [x] Dynamically prefetch listings with a request-scoped QueryClient and
  hydrate the interactive listing view.
- [x] Render all six seats with event metadata, availability, total, and
  isolated per-listing Buy now state.
- [x] Create checkout from a stable browser device ID and navigate with the
  API-provided authenticated `links.webPath`.
- [x] Force dynamic, no-store checkout SSR and validate one session ID and one
  token before the authenticated read.
- [x] Render useful checkout content from the server snapshot before browser
  resume completes.
- [x] Hydrate the server clock handoff in the browser, resolve the browser
  device ID, resume, apply the measured HTTP anchor, enable commands, and then
  connect realtime.
- [x] Key the checkout subtree by session ID and token.
- [x] Distinguish invalid/unauthorized/missing checkout links from retryable
  resume failures.

## Task 10: Complete the Interactive Web Checkout

**Implemented files**

- `apps/web/components/activity-timeline.tsx`
- `apps/web/components/checkout-exit.tsx`
- `apps/web/components/checkout-status.tsx`
- `apps/web/components/checkout-summary.tsx`
- `apps/web/components/hold-countdown.tsx`
- `apps/web/components/open-in-app-button.tsx`
- `apps/web/components/purchase-action.tsx`
- `apps/web/components/scenario-controls.tsx`
- `apps/web/components/ui/badge.tsx`
- `apps/web/components/ui/button.tsx`
- `apps/web/components/ui/card.tsx`
- `apps/web/components/ui/collapsible.tsx`
- `apps/web/components/ui/separator.tsx`
- `apps/web/lib/checkout-screen-context.tsx`
- `apps/web/lib/format.ts`
- Corresponding colocated `*.test.ts` and `*.test.tsx` files

**Completed work**

- [x] Render server-owned status, allowed actions, price, seat, order, and
  realtime connection state.
- [x] Show previous and current totals during offer review and expose exact
  offer acceptance only when `accept_offer` is allowed.
- [x] Render Purchase or Retry purchase solely from `allowedActions`; render
  progress without inventing a client-side business state.
- [x] Update the countdown locally once per second with `Math.ceil` and disable
  an otherwise authorized purchase at zero.
- [x] Await explicit web leave before returning to listings and disable exit
  while a purchase command is pending.
- [x] Launch the authenticated native handoff and display typed activity.
- [x] Lazy-load a collapsed Dev control for reprice, force-expire, and next
  payment success/failure.
- [x] Use narrow centered content, neutral cards, and one primary action
  without a dashboard, seat map, QR code, or decorative illustration.

## Task 11: Build the Expo Deep-Link Bootstrap and Native Checkout

**Implemented files**

- `apps/mobile/package.json`
- `apps/mobile/app.json`
- `apps/mobile/app/_layout.tsx`
- `apps/mobile/app/index.tsx`
- `apps/mobile/app/checkout/[sessionId].tsx`
- `apps/mobile/src/checkout-route.ts`
- `apps/mobile/src/device-id.ts`
- `apps/mobile/src/checkout-presentation.ts`
- `apps/mobile/src/checkout-screen.tsx`
- `apps/mobile/src/hold-countdown.tsx`
- `apps/mobile/src/screen-shell.tsx`
- `apps/mobile/src/theme.ts`
- `apps/mobile/ios/`
- Corresponding `apps/mobile/src/*.test.ts` and `*.test.tsx` files

**Completed work**

- [x] Configure Expo Router and the `gametime` custom URL scheme.
- [x] Validate the complete incoming URL, requiring protocol `gametime:`, host
  `checkout`, a non-empty session path, and exactly one token.
- [x] Resolve a stable SecureStore-backed device ID with an ephemeral UUID
  fallback.
- [x] Resume the same server session before creating the checkout store and
  realtime subscription.
- [x] Key the bootstrap subtree by session ID and token so changed deep links
  cannot reuse state.
- [x] Classify loading, invalid, unauthorized, missing, offline, and unexpected
  bootstrap outcomes; offer Retry for offline failure.
- [x] Render shared status copy, offer review, allowed actions, monotonic
  countdown, payment progress, and completed order using native components.
- [x] Send best-effort leave when the checkout route is removed while the
  session is still active.
- [x] Stop realtime work for terminal snapshots.

## Task 12: Prove the Cross-Surface Workflow and Document Operation

**Implemented files**

- `apps/web/e2e/checkout-continuity.spec.ts`
- `playwright.config.ts`
- `README.md`
- `docs/superpowers/specs/2026-07-29-checkout-continuity-design.md`
- `docs/superpowers/plans/2026-07-29-checkout-continuity.md`

**Completed work**

- [x] Start the API and web servers from Playwright configuration.
- [x] Create a checkout through the browser and open an authenticated
  mobile-equivalent WebSocket peer.
- [x] Resume the mobile peer and prove web exit does not abandon the shared
  checkout.
- [x] Resume web, reprice, accept the current offer, fail a mobile purchase,
  retry successfully from web, and assert one confirmed order.
- [x] Assert activity contains cross-surface resume, reprice, acceptance,
  failure, and completion transitions.
- [x] Document install, local run commands, the operator walkthrough,
  concurrency behavior, monotonic countdown, advisory presence, and the full
  verification set.

## Verification

Run the repository checks from the root:

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

The iOS simulator handoff is a manual verification because it requires macOS,
Xcode, a running Simulator, and the installed Expo development build.

## Requirement Traceability

| Design area | Implementing tasks |
| --- | --- |
| Workspaces, tooling, strict types, and scope | 1 |
| Public contracts and parse-once boundaries | 1, 6, 7 |
| Static event, listings, private records, and projection | 2 |
| Creation, ownership, resume, presence, leave, and expiry | 3 |
| Repricing and exact offer acceptance | 4 |
| Payment, idempotency, retry, concurrency, and order uniqueness | 5 |
| REST, development resources, errors, and WebSockets | 6 |
| Parsed client, monotonic clocks, store, and shared presentation | 7 |
| React command and realtime lifecycle | 8 |
| Dynamic web SSR and browser bootstrap | 9 |
| Interactive web checkout and development controls | 10 |
| Expo deep link, bootstrap, identity, and native UI | 11 |
| Cross-surface acceptance walkthrough and operations documentation | 12 |
