# Prototype Simplification Design

**Status:** Approved for implementation

**Date:** 2026-07-29

**Audience:** Implementers and engineering reviewers

## 1. Purpose

Simplify the checkout continuity prototype without changing its user interface
or demonstrated behavior.

The end state should be easy to navigate, explain, defend, and extend. The
prototype runs only on a local development machine, so production deployment
flexibility is explicitly less important than direct code and visible
assumptions.

This design treats the demonstrated product behavior as the compatibility
contract. Internal HTTP payloads, module boundaries, dependencies, and testing
structure may change when doing so makes the system easier to understand.

## 2. Baseline

At the start of the audit:

- the repository has four runtime workspaces: API, web, mobile, and SDK;
- the TypeScript source is approximately 6,200 lines;
- the test suite is approximately 4,900 lines across 24 files;
- all 115 unit tests pass;
- typechecking, linting, and formatting pass;
- `checkout.service.ts` is 1,163 lines;
- the API uses `better-result` throughout expected-error paths;
- checkout state is split between Zustand and TanStack Query;
- local URLs and ports are configurable through environment variables despite
  having only one supported local topology; and
- generated iOS output is checked in even though there is no custom native
  implementation.

The existing staged change to `apps/web/next-env.d.ts` predates this work and
must not be overwritten or included in cleanup commits unintentionally.

## 3. Behavior Contract

The cleanup must preserve:

1. the existing web and mobile interface, presentation, and customer copy;
2. web listing selection and checkout creation;
3. authenticated handoff of the same checkout to the iOS simulator;
4. complete realtime state convergence across web and mobile;
5. the server-authoritative inventory hold and monotonic client countdown;
6. price change followed by explicit acceptance of the exact offer version;
7. payment failure, retry, and successful completion;
8. protection against concurrent purchase commands creating more than one
   pending attempt or order;
9. the activity timeline and current development scenario controls; and
10. explicit leave behavior that preserves a checkout while another realtime
    client remains connected.

Endpoint URLs remain stable. Internal response wrappers may be simplified.

## 4. Non-goals

This work does not:

- add production configuration, persistence, observability, security
  infrastructure, deployment support, or browser-origin policy;
- redesign the web or mobile UI;
- add product behavior, screens, or developer controls;
- collapse the four runtime workspaces;
- remove runtime validation at HTTP or WebSocket boundaries;
- optimize for a coverage percentage, test count, or source-line target;
- preserve incidental internal APIs solely to reduce the refactor diff;
- remove `.agents/` or `skills-lock.json`; or
- delete the existing design and implementation-plan documents.

## 5. Target Architecture

The four workspaces remain:

```text
apps/api       Hono boundaries and in-memory checkout domain
apps/web       Next.js presentation
apps/mobile    Expo/React Native presentation
packages/sdk   Shared contracts, transport, clock, cache, and realtime logic
```

The dependency direction remains:

```text
web ─────┐
         ├──> SDK
mobile ──┘     ▲
               │ validated public contracts
API ───────────┘
```

The SDK remains a meaningful boundary because both clients require the same
schemas, HTTP client, clock behavior, revision ordering, and realtime
subscription behavior.

The API retains:

- Hono route composition;
- Zod parsing of external values;
- one in-memory repository;
- stable multi-key locking;
- one payment simulator;
- one realtime hub;
- one iOS simulator launcher; and
- one checkout service.

Modules remain separate when they name and enforce a real boundary. Pass-through
modules, redundant aliases, re-export-only helpers, and tiny route factories
should be removed when inline code is clearer.

## 6. Local Runtime Configuration

There is one supported topology:

```text
Web: http://127.0.0.1:8000
API: http://127.0.0.1:3000
iOS client API: http://127.0.0.1:3000
```

These values are explicit at their entry points. The implementation removes
API startup environment parsing and the `NEXT_PUBLIC_API_URL`,
`API_INTERNAL_URL`, `EXPO_PUBLIC_API_URL`, and `WEB_BASE_URL` branches.

The API binds directly to port `3000`. The web scripts continue to bind to
`127.0.0.1:8000`.

The browser still performs cross-origin requests, so REST routes use one
permissive Hono `cors()` middleware. WebSocket upgrade routes remain outside
that REST middleware.

## 7. API Errors and Boundaries

External input is parsed once:

- Hono validates route params, query strings, headers, and JSON bodies;
- the SDK validates successful and unsuccessful HTTP bodies;
- the realtime client validates incoming messages; and
- the realtime hub validates outgoing events.

After parsing, service methods receive canonical values.

`better-result` is removed. Checkout service methods return successful values
directly and throw typed domain errors for expected failures. Providers either
return their small domain value directly or throw a typed provider error.

The Hono error boundary is the only place that translates errors into HTTP
status, code, message, and optional authoritative snapshot. Unknown errors are
sanitized as the existing generic internal error.

Authentication happens inside each authenticated service operation. Developer
routes no longer authenticate by performing a preliminary checkout read and
then call a service operation that authenticates again.

## 8. Checkout Service Structure

`checkout.service.ts` remains one file so the complete domain workflow can be
reviewed in one place. It is reorganized rather than split into many
cross-referencing modules.

The file is ordered as:

1. domain constants and internal types;
2. public service operations in walkthrough order;
3. locked checkout access and publication;
4. purchase start and finalization;
5. expiration and abandonment transitions;
6. record construction and small pure helpers.

Trivial exported aliases and one-use wrappers are removed. Small pure helpers
may be top-level functions; dependency-using workflow helpers remain private
service methods.

A single locked-checkout helper:

1. resolves the session/listing association;
2. acquires sorted session and listing keys;
3. reloads current records under the lock;
4. runs one synchronous domain mutation against those records;
5. releases the lock; and
6. publishes returned complete snapshots.

Internal mutations use one small shape:

```ts
interface Mutation<T> {
  value: T;
  events?: readonly CheckoutUpdate[];
}
```

Expected errors are thrown. They are not embedded in this shape.

Purchase start uses a discriminated result that clearly says whether the
request is already resolved or requires delayed authorization. Authorization
runs outside the keyed lock, and finalization reacquires the same stable keys.

The following invariants remain explicit in code and tests:

- a listing has at most one owning checkout;
- an initiating device has at most one nonterminal checkout;
- an expired active hold releases only its own listing;
- purchasing sessions are not expired while authorization is pending;
- offer acceptance requires the current version;
- idempotency replays the recorded attempt outcome;
- a second purchase key cannot create a second pending attempt; and
- a session has at most one order.

## 9. HTTP Responses and Route Layout

Endpoint URLs remain unchanged.

Creation keeps its composite response because the caller needs a snapshot,
resume token, and handoff links. Purchase keeps its composite response because
the disposition and duplicate-prevention signal are meaningful.

Snapshot-only endpoints return `CheckoutSnapshot` directly:

- checkout read;
- client resume;
- explicit leave;
- offer acceptance;
- development reprice; and
- development expiration.

This removes the otherwise redundant `CheckoutSnapshotResponse` wrapper from
contracts, routes, client parsing, and tests.

Health and listing routes are composed directly in `app.ts` because their
separate factories do not provide a useful boundary. Checkout, development,
and realtime routes remain separate because each represents a coherent API
surface.

The empty `AppEnv` alias, unused application-type exports, repeated validator
callbacks, and three-line authentication helpers should be inlined or
consolidated where that improves readability.

## 10. Client State

TanStack Query becomes the only client-side server-state system.

The checkout cache value is:

```ts
interface CheckoutState {
  snapshot: CheckoutSnapshot;
  clockAnchor: ClockAnchor;
}
```

It is keyed by checkout session ID. One pure SDK cache function applies every
incoming checkout state:

1. an update for another session is rejected;
2. an older revision is ignored;
3. an equal HTTP revision may refresh its supplied clock anchor; and
4. a newer revision replaces the snapshot and supplied anchor.

The following sources all use that function:

- initial server-rendered web state;
- initial resumed mobile state;
- browser resume;
- successful checkout commands;
- authoritative conflict errors; and
- realtime events.

Zustand, its vanilla store, selectors, provider, and React bindings are
removed.

The existing web checkout context exposes the current Query-backed state and
screen runtime to web components. The mobile checkout screen passes the same
state through its shallow component tree rather than introducing another state
container.

Named command hooks remain for readable call sites. They share one internal
mutation helper responsible for:

- applying successful state;
- applying authoritative conflict state;
- exposing pending/error state; and
- invalidating only the related activity or listings query.

Realtime retains a standalone subscription lifecycle because reconnect and
terminal-state behavior are not React concerns. Its read/write callbacks now
target the Query cache.

## 11. Tests

Tests describe the intended end state. They are not required to preserve every
incidental behavior during the refactor.

Keep tests that protect:

- a core walkthrough transition;
- a domain invariant or concurrency rule;
- input/output validation;
- authentication or error translation;
- revision and clock ordering;
- realtime routing, reconnect, or terminal behavior; or
- a meaningful user interaction state.

Remove tests whose only purpose is:

- copying a small object;
- verifying a currency formatter;
- exhaustively restating static copy or tone tables;
- checking obvious prop forwarding;
- asserting implementation-specific helper calls; or
- replaying at the route layer a workflow already proved by the service layer.

Service tests own domain workflows and concurrency. Route tests sample each
external boundary and error category. SDK tests own schemas, transport
rejection, clock math, revision application, and realtime lifecycle. Component
tests own visible interaction decisions. The Playwright test remains the
walkthrough-level proof.

Regression tests are added only when an important invariant would otherwise be
unprotected. The work does not add tests merely to make each refactor step
safer.

One SDK test-support export provides the shared `react-test-renderer` harness:

- known-warning filtering;
- renderer registration and cleanup;
- `act`-wrapped rendering; and
- common text/query helpers.

Per-file copies of this setup are removed.

## 12. Repository Hygiene

The implementation:

- stops tracking `apps/mobile/ios/`;
- updates mobile ignore rules so Expo may regenerate native output locally;
- retains `.agents/`, `skills-lock.json`, and existing documentation;
- marks the old design and plan as the original implementation record where
  their internal descriptions are superseded;
- points readers from the README and historical documents to this cleanup
  design;
- removes `better-result` and Zustand dependencies;
- removes clearly unused dependencies such as `expo-constants`;
- simplifies the two-variant button enough to remove
  `class-variance-authority`;
- removes obsolete URL/configuration branches from Playwright and application
  startup; and
- preserves unrelated working-tree changes.

The dependency audit is evidence-based: a package is removed only when no
runtime or test code needs it after the new design is implemented.

## 13. Verification

The completed cleanup must pass:

```sh
bun run fmt:check
bun run lint
bun run typecheck
bun test
bun run --cwd apps/web build
bun run test:e2e
(cd apps/mobile && bun x expo export --platform ios)
```

The final review also checks:

- no supported startup path reads the removed URL/port environment variables;
- REST browser requests receive permissive CORS headers;
- the browser-to-iOS handoff still resumes one checkout;
- all HTTP and realtime payloads are parsed at their boundary;
- no Zustand or `better-result` code remains;
- generated iOS output is untracked; and
- the existing UI and customer copy are unchanged.

## 14. Success Criteria

The cleanup is successful when a reviewer can follow these paths without
detours:

1. route validation to one service operation to repository mutation;
2. checkout transition to complete realtime publication;
3. HTTP or realtime snapshot to one revision-aware Query cache update; and
4. cached checkout state to web and mobile presentation.

The code should have fewer concepts, dependencies, wrappers, duplicated test
fixtures, and configuration branches. Reduction is a consequence of clearer
ownership, not an independent line-count goal.
