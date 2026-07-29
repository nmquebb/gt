# Prototype Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the local checkout continuity prototype easier to read, explain,
and extend while preserving its UI and demonstrated workflows.

**Architecture:** Keep the API, web, mobile, and SDK workspaces. Simplify the
API around direct return values and typed exceptions, and make TanStack Query
the only client-side server-state system. Preserve validation, locking,
realtime convergence, and purchase uniqueness while removing configuration,
wrapper, dependency, helper, generated-file, and low-value-test overhead.

**Tech Stack:** Bun, strict TypeScript, Hono, Zod, TanStack Query, Next.js,
React, Expo/React Native, Playwright, Oxlint, and Oxfmt.

## Global Constraints

- Preserve the existing web and mobile UI, presentation, and customer copy.
- Preserve checkout creation, authenticated iOS handoff, realtime convergence,
  expiration, repricing and acceptance, payment failure and retry, activity,
  explicit leave, and at-most-one-attempt/order behavior.
- Keep the four runtime workspaces and the shared SDK boundary.
- Keep runtime validation at every HTTP and WebSocket boundary.
- Keep `checkout.service.ts` as one workflow-oriented file.
- Use `http://127.0.0.1:8000` for web and
  `http://127.0.0.1:3000` for the API.
- Use one permissive REST `cors()` middleware; do not add it to WebSocket
  upgrade routes.
- Remove `better-result` and Zustand.
- Keep `.agents/`, `skills-lock.json`, and the existing design/plan documents.
- Stop tracking generated `apps/mobile/ios/`.
- Do not optimize for coverage percentage, test count, or line count.
- Add tests for the intended end state and core invariants, not for incidental
  refactor regressions.
- Preserve the pre-existing staged `apps/web/next-env.d.ts` change and never
  include it accidentally in a task commit.

---

## Target File Map

### API

- `apps/api/src/app.ts` — REST CORS, health/listing composition, route/error
  composition.
- `apps/api/src/composition.ts` — fixed local dependency construction.
- `apps/api/src/server.ts` — fixed port startup.
- `apps/api/src/services/checkout/checkout.service.ts` — all checkout
  workflows, transitions, locking, and post-lock publication.
- `apps/api/src/services/checkout/checkout.errors.ts` — typed domain
  exceptions and optional mutation updates.
- `apps/api/src/http/error-response.ts` — the single domain-to-HTTP error
  translation boundary.
- `apps/api/src/routes/checkout.routes.ts` — validated production checkout
  endpoints.
- `apps/api/src/routes/dev.routes.ts` — validated local scenario endpoints.
- `apps/api/src/routes/realtime.routes.ts` — authenticated WebSocket upgrade
  lifecycle.
- `apps/api/src/providers/payment-simulator.ts` — delayed
  `"success" | "failure"` authorization.
- `apps/api/src/providers/ios-simulator-launcher.ts` — launcher that resolves
  or throws.
- Delete `apps/api/src/config.ts`,
  `apps/api/src/routes/health.routes.ts`, and
  `apps/api/src/routes/listing.routes.ts`.

### SDK

- `packages/sdk/src/clients/checkout.client.ts` — parsed HTTP/WebSocket
  transport and clock anchoring.
- `packages/sdk/src/contracts/checkout.contract.ts` — public checkout schemas
  without a snapshot-only response wrapper.
- Create `packages/sdk/src/cache/checkout-cache.ts` — query key and
  revision-aware checkout cache updates.
- Create `packages/sdk/src/react/use-checkout-state.ts` — Query-backed
  checkout observation and initial seeding.
- `packages/sdk/src/react/use-checkout-commands.ts` — named mutations sharing
  one application/invalidation path.
- `packages/sdk/src/react/use-checkout-realtime.ts` — subscription wired to the
  Query cache.
- `packages/sdk/src/realtime/checkout-subscription.ts` — framework-independent
  reconnect and message lifecycle.
- Create `packages/sdk/test-utils/react-test-renderer.ts` — the repository’s
  shared renderer harness.
- Delete `packages/sdk/src/react/checkout-context.ts`,
  `packages/sdk/src/react/checkout-provider.tsx`,
  `packages/sdk/src/stores/checkout/checkout.selectors.ts`, and
  `packages/sdk/src/stores/checkout/checkout.store.ts`.

### Web and mobile

- `apps/web/app/checkout/[sessionId]/checkout-client-boundary.tsx` — seed,
  resume, and render the Query-backed checkout.
- `apps/web/lib/checkout-screen-context.tsx` — web runtime plus current
  checkout state.
- `apps/web/components/*` — read current checkout state from the web context.
- `apps/mobile/src/checkout-screen.tsx` — observe Query state and pass it
  through the shallow native screen tree.
- `apps/mobile/src/hold-countdown.tsx` — render the supplied clock anchor.
- `apps/mobile/app/checkout/[sessionId].tsx` — fixed local API URL and mobile
  resume bootstrap.
- Delete `apps/web/lib/format.ts` and
  `apps/web/test-utils/react-test-renderer.ts`.

### Repository

- `package.json` and workspace manifests — remove obsolete dependencies and
  keep verification scripts direct.
- `playwright.config.ts` — fixed local commands with no URL environment.
- `README.md` — concise current runtime, architecture, and verification guide.
- Existing design/plan docs — retain with historical-record notices.
- `apps/mobile/.gitignore` — ignore generated native output.
- Delete all tracked files under `apps/mobile/ios/`.

---

### Task 1: Make the runtime explicitly local

**Files:**

- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/composition.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/test/fixtures.ts`
- Modify: `apps/api/test/routes.test.ts`
- Modify: `apps/web/lib/api.ts`
- Modify: `apps/web/components/buy-now-button.tsx`
- Modify: `apps/web/components/listing-list.tsx`
- Modify: `apps/mobile/app/checkout/[sessionId].tsx`
- Modify: `apps/web/e2e/checkout-continuity.spec.ts`
- Modify: `playwright.config.ts`
- Delete: `apps/api/src/config.ts`
- Delete: `apps/api/src/routes/health.routes.ts`
- Delete: `apps/api/src/routes/listing.routes.ts`

**Interfaces:**

- Produces: `createAppDependencies(): AppDependencies`
- Produces: API startup fixed to port `3000`
- Produces: all web/mobile checkout clients fixed to
  `http://127.0.0.1:3000`
- Produces: permissive REST CORS and no REST CORS on the events upgrade route

- [ ] **Step 1: Change the route test to state the local CORS contract**

Replace the origin allow-list assertion in
`apps/api/test/routes.test.ts` with a non-local example:

```ts
const response = await fixture.app.request("/v1/listings", {
  headers: { origin: "https://prototype-review.example" },
});

expect(response.headers.get("access-control-allow-origin")).toBe("*");
```

Keep the realtime test that proves the events upgrade route does not run
through REST CORS.

- [ ] **Step 2: Run the focused test and observe the old allow-list fail**

Run:

```sh
bun test apps/api/test/routes.test.ts apps/api/test/realtime.test.ts
```

Expected: the new arbitrary-origin assertion fails because the current CORS
callback rejects it.

- [ ] **Step 3: Replace configurable CORS and tiny route factories**

In `apps/api/src/app.ts`:

```ts
const rest = new Hono()
  .use("*", cors())
  .get("/v1/health", (context) => context.json({ status: "ok" }))
  .get("/v1/listings", async (context) =>
    context.json(await dependencies.checkoutService.listListings()),
  )
  .route("/v1", createCheckoutRoutes(dependencies))
  .route("/v1", createDevRoutes(dependencies));
```

Keep `createRealtimeRoutes(dependencies)` mounted on the outer app after the
REST app so WebSocket upgrades do not traverse `cors()`. Remove
`REST_RESOURCE_PATHS`, `localWebOrigins`, the empty `AppEnv`, and the unused
`AppType`.

- [ ] **Step 4: Remove API environment parsing**

Change composition and startup to:

```ts
export function createAppDependencies(): AppDependencies {
  // Construct the existing repository, lock, payment, realtime, launcher,
  // and CheckoutService exactly once.
}
```

```ts
const app = createApp(createAppDependencies());

Bun.serve({
  fetch: app.fetch,
  websocket,
  port: 3000,
});
```

Delete `config.ts` and remove `webBaseUrl` from `AppDependencies` and test
fixtures.

- [ ] **Step 5: Hardcode the only supported API URL**

Use:

```ts
const apiUrl = "http://127.0.0.1:3000";
```

at browser/mobile client construction sites. In `apps/web/lib/api.ts`, export
the same literal as `publicApiUrl` and use it for the server client. Remove
`NEXT_PUBLIC_API_URL`, `API_INTERNAL_URL`, and `EXPO_PUBLIC_API_URL` reads.

- [ ] **Step 6: Remove URL environment prefixes from Playwright**

Set the web server command to:

```ts
command: "bun run dev:web";
```

Keep the existing fixed server URLs and e2e `apiUrl` literal.

- [ ] **Step 7: Run the local-shell verification**

Run:

```sh
bun test apps/api/test/routes.test.ts apps/api/test/realtime.test.ts
bun run typecheck
bun run lint
```

Expected: all commands pass and `rg` finds no supported runtime environment
branches:

```sh
rg -n "NEXT_PUBLIC_API_URL|API_INTERNAL_URL|EXPO_PUBLIC_API_URL|WEB_BASE_URL|process\\.env" apps playwright.config.ts
```

Expected: no matches.

- [ ] **Step 8: Commit only Task 1 files**

```sh
git add apps/api/src/app.ts apps/api/src/composition.ts apps/api/src/server.ts \
  apps/api/src/config.ts apps/api/src/routes/health.routes.ts \
  apps/api/src/routes/listing.routes.ts apps/api/test/fixtures.ts \
  apps/api/test/routes.test.ts apps/web/lib/api.ts \
  apps/web/components/buy-now-button.tsx apps/web/components/listing-list.tsx \
  'apps/mobile/app/checkout/[sessionId].tsx' \
  apps/web/e2e/checkout-continuity.spec.ts playwright.config.ts
git commit -m "refactor: make prototype runtime explicitly local"
```

Before committing, confirm `apps/web/next-env.d.ts` is not part of
`git diff --cached --name-only`.

---

### Task 2: Focus the test suite and share one renderer harness

**Files:**

- Create: `packages/sdk/test-utils/react-test-renderer.ts`
- Modify: `packages/sdk/package.json`
- Modify: `packages/sdk/test/checkout-hooks.test.tsx`
- Modify: `packages/sdk/test/checkout-realtime-hook.test.tsx`
- Modify: `apps/mobile/src/checkout-screen.test.ts`
- Modify: `apps/web/app/checkout/[sessionId]/checkout-client-boundary.test.tsx`
- Modify: `apps/web/components/checkout-summary.test.tsx`
- Modify: `apps/web/components/hold-countdown.test.tsx`
- Modify: `apps/web/components/purchase-action.test.tsx`
- Modify: `apps/web/components/scenario-controls.test.tsx`
- Delete: `apps/web/test-utils/react-test-renderer.ts`
- Delete: `packages/sdk/test/checkout-context.test.ts`
- Delete: `apps/web/lib/checkout-copy.test.ts`
- Delete: `apps/web/lib/format.test.ts`
- Delete: `apps/mobile/src/checkout-presentation.test.ts`

**Interfaces:**

- Produces:
  `createReactTestHarness(): { render(element), textContent(value) }`
- Produces package export:
  `@checkout/sdk/test-utils/react-test-renderer`

- [ ] **Step 1: Record the current meaningful component behavior**

Run:

```sh
bun test \
  packages/sdk/test/checkout-hooks.test.tsx \
  packages/sdk/test/checkout-realtime-hook.test.tsx \
  apps/mobile/src/checkout-screen.test.ts \
  apps/web/components \
  'apps/web/app/checkout/[sessionId]/checkout-client-boundary.test.tsx'
```

Expected: the existing interaction tests pass before harness replacement.

- [ ] **Step 2: Add the shared harness**

Create `packages/sdk/test-utils/react-test-renderer.ts` with this public shape:

```ts
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterAll, afterEach, beforeAll } from "bun:test";
import type { ReactElement } from "react";

export function createReactTestHarness() {
  const renderers: ReactTestRenderer[] = [];
  let originalConsoleError: typeof console.error = console.error;

  beforeAll(() => {
    originalConsoleError = console.error;
    console.error = (message?: unknown, ...rest: unknown[]) => {
      if (
        typeof message === "string" &&
        message.includes("react-test-renderer is deprecated")
      ) {
        return;
      }
      originalConsoleError(message, ...rest);
    };
  });

  afterEach(async () => {
    await act(async () => {
      for (const renderer of renderers.splice(0)) {
        renderer.unmount();
      }
    });
  });

  afterAll(() => {
    console.error = originalConsoleError;
  });

  async function render(element: ReactElement) {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(element);
    });
    renderers.push(renderer);
    return renderer;
  }

  return { render, textContent };
}

export function textContent(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(textContent).join("");
  }
  if (typeof value === "object" && value !== null && "props" in value) {
    return textContent(
      (value as { props?: { children?: unknown } }).props?.children,
    );
  }
  if (typeof value === "object" && value !== null && "children" in value) {
    return textContent((value as { children?: unknown }).children);
  }
  return "";
}
```

If a test needs a tree-specific finder, keep that finder beside the test; do
not add screen-specific behavior to the shared harness.

- [ ] **Step 3: Export and adopt the harness**

Add:

```json
"./test-utils/react-test-renderer": "./test-utils/react-test-renderer.ts"
```

to `packages/sdk/package.json#exports`.

In each renderer test file, replace local renderer arrays, console filters,
render wrappers, and generic text walkers with:

```ts
const { render, textContent } = createReactTestHarness();
```

Use the package export from web/mobile tests and a relative import from SDK
tests.

- [ ] **Step 4: Delete trivia-only tests**

Delete the four test files listed above. They assert a four-field object copy,
currency formatting, static customer-copy/tone tables, or similarly direct
lookup data. Do not delete the production copy and presentation maps because
the UI still uses them.

Within retained component files, remove duplicate terminal-status permutations
when one table-driven case proves the rendering rule. Keep separate cases for
purchase, retry, pending, expired-clock disabling, resume failure, realtime
completion, and explicit leave.

- [ ] **Step 5: Run the focused and full unit suites**

Run:

```sh
bun test \
  packages/sdk/test/checkout-hooks.test.tsx \
  packages/sdk/test/checkout-realtime-hook.test.tsx \
  apps/mobile/src/checkout-screen.test.ts \
  apps/web/components \
  'apps/web/app/checkout/[sessionId]/checkout-client-boundary.test.tsx'
bun test
bun run typecheck
```

Expected: all retained behavior passes without per-file renderer
implementations.

- [ ] **Step 6: Commit only Task 2 files**

```sh
git add packages/sdk/package.json packages/sdk/test-utils \
  packages/sdk/test/checkout-hooks.test.tsx \
  packages/sdk/test/checkout-realtime-hook.test.tsx \
  packages/sdk/test/checkout-context.test.ts \
  apps/mobile/src/checkout-screen.test.ts \
  apps/mobile/src/checkout-presentation.test.ts \
  apps/web/test-utils apps/web/lib/checkout-copy.test.ts \
  apps/web/lib/format.test.ts \
  apps/web/components/checkout-summary.test.tsx \
  apps/web/components/hold-countdown.test.tsx \
  apps/web/components/purchase-action.test.tsx \
  apps/web/components/scenario-controls.test.tsx \
  'apps/web/app/checkout/[sessionId]/checkout-client-boundary.test.tsx'
git commit -m "test: focus prototype coverage on behavior"
```

---

### Task 3: Replace Result plumbing with typed exceptions

**Files:**

- Modify: `apps/api/src/services/checkout/checkout.errors.ts`
- Modify: `apps/api/src/services/checkout/checkout.service.ts`
- Modify: `apps/api/src/http/error-response.ts`
- Modify: `apps/api/src/routes/checkout.routes.ts`
- Modify: `apps/api/src/routes/dev.routes.ts`
- Modify: `apps/api/src/routes/realtime.routes.ts`
- Modify: `apps/api/src/providers/payment-simulator.ts`
- Modify: `apps/api/src/providers/ios-simulator-launcher.ts`
- Modify: `apps/api/test/fixtures.ts`
- Modify: `apps/api/test/checkout.service.test.ts`
- Modify: `apps/api/test/payment-simulator.test.ts`
- Modify: `apps/api/test/realtime.test.ts`
- Modify: `apps/api/test/routes.test.ts`

**Interfaces:**

- Produces direct service methods:
  `Promise<T>` on success and typed `CheckoutError` throws on expected failure.
- Produces:
  `DelayedPaymentSimulator.authorize(input): Promise<PaymentOutcome>`
- Produces: `IosSimulatorLauncher.open(deepLink): Promise<void>`
- Produces: `Mutation<T> = { value: T; updates?: readonly CheckoutUpdate[] }`
- Produces a typed checkout error with optional post-lock `updates`.

- [ ] **Step 1: Rewrite the service tests around direct values and throws**

Replace `Result.isOk`/`Result.isError` test helpers with direct awaits:

```ts
const created = await fixture.service.createSession(createInput());
expect(created.snapshot.status).toBe("ready");
```

For expected errors:

```ts
expect(
  fixture.service.acceptOffer({
    ...fixture.authentication,
    surface: "web",
    deviceId: "web-device",
    offerVersion: 99,
  }),
).rejects.toBeInstanceOf(OfferVersionMismatch);
```

Retain the seven service behaviors: connected-client leave, last-client
abandonment, idempotent resume, reprice/accept, authoritative expiration,
failure/retry, and concurrent purchase uniqueness.

- [ ] **Step 2: Run the service tests and verify they fail against Result**

Run:

```sh
bun test apps/api/test/checkout.service.test.ts
```

Expected: direct snapshot assertions fail because current methods return
`Result`.

- [ ] **Step 3: Replace tagged errors with ordinary typed exceptions**

Use one base class that can transport state changes out of the lock:

```ts
export interface CheckoutUpdate {
  cause: CheckoutSessionUpdatedCause;
  snapshot: CheckoutSnapshot;
}

export class CheckoutError extends Error {
  constructor(
    message: string,
    readonly updates: readonly CheckoutUpdate[] = [],
  ) {
    super(message);
  }
}

export class ListingUnavailable extends CheckoutError {
  constructor(readonly listingId: string) {
    super("Listing unavailable");
  }
}

export class CheckoutSessionNotFound extends CheckoutError {
  constructor(readonly sessionId: string) {
    super("Checkout session not found");
  }
}

export class InvalidResumeToken extends CheckoutError {
  constructor() {
    super("Invalid resume token");
  }
}

export class InvalidPriceAdjustment extends CheckoutError {
  constructor() {
    super("Invalid price adjustment");
  }
}

export class CheckoutSessionExpired extends CheckoutError {
  constructor(
    readonly snapshot: CheckoutSnapshot,
    updates: readonly CheckoutUpdate[] = [],
  ) {
    super("Checkout session expired", updates);
  }
}

export class OfferVersionMismatch extends CheckoutError {
  constructor(readonly snapshot: CheckoutSnapshot) {
    super("Offer version mismatch");
  }
}

export class PurchaseNotAllowed extends CheckoutError {
  constructor(readonly snapshot: CheckoutSnapshot) {
    super("Purchase not allowed");
  }
}
```

Set `this.name = new.target.name` in the base constructor if required for
readable failures.

- [ ] **Step 4: Simplify fallible providers**

Make authorization return the configured outcome after the delay:

```ts
async authorize(input: PaymentInput): Promise<PaymentOutcome> {
  const outcome = this.outcomes.get(input.sessionId) ?? "success";
  this.outcomes.delete(input.sessionId);
  await wait(this.delayMs);
  return outcome;
}
```

Make the launcher resolve on exit code zero and throw
`SimulatorLaunchFailure` on spawn, wait, or nonzero-exit failure. Update the
test launcher to either resolve or throw.

- [ ] **Step 5: Convert service signatures and locked mutations**

Use:

```ts
interface Mutation<T> {
  value: T;
  updates?: readonly CheckoutUpdate[];
}

type PurchaseStart =
  | { kind: "resolved"; response: PurchaseResponse }
  | {
      kind: "authorize";
      response: PurchaseResponse;
      attempt: PurchaseAttemptRecord;
    };
```

Convert every public service method from `Promise<Result<T, CheckoutError>>`
to `Promise<T>`. Return `.value` directly and throw the typed errors.

The common locked helper must publish after lock release on both success and
mutation-then-error:

```ts
private async withSession<T>(
  sessionId: string,
  operation: (input: SessionOperationInput) => Mutation<T>,
): Promise<T> {
  try {
    const mutation = await this.lockSession(sessionId, operation);
    this.publishUpdates(mutation.updates);
    return mutation.value;
  } catch (error) {
    if (error instanceof CheckoutError) {
      this.publishUpdates(error.updates);
    }
    throw error;
  }
}
```

`lockSession` must resolve the listing association, acquire sorted listing and
session keys, reload both records, and throw `CheckoutSessionNotFound` if the
association disappears.

When expiration is persisted immediately before rejecting a command, throw:

```ts
throw new CheckoutSessionExpired(expired.snapshot, [expired.update]);
```

Keep payment authorization outside the lock and reacquire the same keys for
finalization.

- [ ] **Step 6: Authenticate once inside service operations**

Replace repository re-reads in `authenticate` with:

```ts
private authenticate(session: CheckoutSessionRecord, token: string): void {
  if (session.resumeToken !== token) {
    throw new InvalidResumeToken();
  }
}
```

Add `resumeToken` to reprice input so all developer operations authenticate
inside the service. Remove the preliminary `getSession` authentication call
from `dev.routes.ts`.

- [ ] **Step 7: Make Hono the only error translation boundary**

Keep `toHttpError(error)` and `respondWithError`, but delete `serviceResponse`
and all `better-result` imports. Route handlers should follow:

```ts
const snapshot = await dependencies.checkoutService.getSession({
  sessionId,
  resumeToken,
});
return context.json({ snapshot });
```

Expected domain exceptions flow to `app.onError`, which calls
`respondWithError(context, toHttpError(error))`. Validation callbacks continue
to return the existing `INVALID_REQUEST`, `INVALID_IDEMPOTENCY_KEY`, and
`UNAUTHORIZED_SESSION` bodies directly.

- [ ] **Step 8: Update route, realtime, and provider tests**

Remove `Result` fixtures and assertions. Preserve representative tests for:

- invalid/missing inputs;
- invalid credentials;
- not found;
- listing conflict;
- stale offer with authoritative snapshot;
- pending/completed purchase status;
- sanitized unexpected launcher/provider failure;
- realtime initial synchronization and socket retirement; and
- launcher use of the server-constructed deep link only.

Do not repeat every service workflow in route tests.

- [ ] **Step 9: Run the API suite and static checks**

Run:

```sh
bun test apps/api
bun run typecheck:api
bun run lint
rg -n "better-result|Result\\.|ResultType" apps/api
```

Expected: tests and checks pass; the final search has no matches in API source
or tests.

- [ ] **Step 10: Commit only Task 3 files**

```sh
git add apps/api/src/services/checkout/checkout.errors.ts \
  apps/api/src/services/checkout/checkout.service.ts \
  apps/api/src/http/error-response.ts \
  apps/api/src/routes/checkout.routes.ts apps/api/src/routes/dev.routes.ts \
  apps/api/src/routes/realtime.routes.ts \
  apps/api/src/providers/payment-simulator.ts \
  apps/api/src/providers/ios-simulator-launcher.ts \
  apps/api/test/fixtures.ts apps/api/test/checkout.service.test.ts \
  apps/api/test/payment-simulator.test.ts apps/api/test/realtime.test.ts \
  apps/api/test/routes.test.ts
git commit -m "refactor: use exceptions for checkout failures"
```

---

### Task 4: Return snapshot resources directly

**Files:**

- Modify: `packages/sdk/src/contracts/checkout.contract.ts`
- Modify: `packages/sdk/src/clients/checkout.client.ts`
- Modify: `packages/sdk/test/contracts.test.ts`
- Modify: `packages/sdk/test/checkout.client.test.ts`
- Modify: `apps/api/src/routes/checkout.routes.ts`
- Modify: `apps/api/src/routes/dev.routes.ts`
- Modify: `apps/api/test/contract.test.ts`
- Modify: `apps/api/test/routes.test.ts`

**Interfaces:**

- Deletes: `CheckoutSnapshotResponseSchema`
- Deletes: `CheckoutSnapshotResponse`
- Produces snapshot-only endpoints whose JSON body is `CheckoutSnapshot`
- Preserves `CheckoutCommandResult = { snapshot, clockAnchor }` inside the SDK

- [ ] **Step 1: Change contract/client tests to direct snapshots**

For a snapshot command response, return:

```ts
new Response(JSON.stringify(checkoutSnapshot), {
  status: 200,
  headers: { "content-type": "application/json" },
});
```

Assert that the client still returns:

```ts
expect(result.snapshot).toEqual(checkoutSnapshot);
expect(result.clockAnchor.expiresAtEpochMs).toBe(
  Date.parse(checkoutSnapshot.session.inventoryHold.expiresAt),
);
```

- [ ] **Step 2: Run the focused tests and observe schema failure**

Run:

```sh
bun test packages/sdk/test/checkout.client.test.ts apps/api/test/routes.test.ts
```

Expected: current route/client wrapper assumptions fail.

- [ ] **Step 3: Remove the redundant response contract**

Delete:

```ts
export const CheckoutSnapshotResponseSchema = z.object({
  snapshot: CheckoutSnapshotSchema,
});
```

and its inferred type.

- [ ] **Step 4: Split client command parsing by response kind**

Use one helper for a direct snapshot:

```ts
async function snapshotCommand(
  operation: string,
  send: () => Promise<Response>,
): Promise<CheckoutCommandResult> {
  const timing = { requestStartedAtMs: monotonicNow() };
  const snapshot = await request(
    CheckoutSnapshotSchema,
    operation,
    send,
    timing,
  );
  return {
    snapshot,
    clockAnchor: clockAnchor(
      snapshot,
      timing as Required<RequestTiming>,
    ),
  };
}
```

Keep a generic composite-command helper for creation and purchase responses,
which still contain `.snapshot`.

- [ ] **Step 5: Return direct snapshots from routes**

Change read, leave, resume, acceptance, reprice, and expire handlers to:

```ts
return context.json(snapshot);
```

Keep creation and purchase response shapes unchanged.

- [ ] **Step 6: Run contract, route, client, and full unit tests**

Run:

```sh
bun test \
  packages/sdk/test/contracts.test.ts \
  packages/sdk/test/checkout.client.test.ts \
  apps/api/test/contract.test.ts \
  apps/api/test/routes.test.ts
bun test
bun run typecheck
```

Expected: all commands pass and:

```sh
rg -n "CheckoutSnapshotResponse" apps packages
```

returns no matches.

- [ ] **Step 7: Commit only Task 4 files**

```sh
git add packages/sdk/src/contracts/checkout.contract.ts \
  packages/sdk/src/clients/checkout.client.ts packages/sdk/test \
  apps/api/src/routes/checkout.routes.ts apps/api/src/routes/dev.routes.ts \
  apps/api/test/contract.test.ts apps/api/test/routes.test.ts
git commit -m "refactor: return checkout snapshots directly"
```

---

### Task 5: Add the revision-aware Query cache

**Files:**

- Create: `packages/sdk/src/cache/checkout-cache.ts`
- Create: `packages/sdk/test/checkout-cache.test.ts`
- Modify: `packages/sdk/src/index.ts`

**Interfaces:**

- Produces:
  `checkoutQueryKey(sessionId: string): readonly ["checkout", string]`
- Produces: `CheckoutState = CheckoutCommandResult`
- Produces:
  `applyCheckoutState(queryClient, sessionId, incoming): CheckoutStateApplication`
- Produces:
  `getCheckoutState(queryClient, sessionId): CheckoutState | undefined`

- [ ] **Step 1: Write cache behavior tests**

Cover all five decisions with a real `QueryClient`:

```ts
test("a newer checkout result replaces the matching cached state", () => {
  const queryClient = new QueryClient();
  applyCheckoutState(queryClient, sessionId, stateAtRevision(1));

  expect(
    applyCheckoutState(queryClient, sessionId, stateAtRevision(2)),
  ).toBe("state_applied");
  expect(
    getCheckoutState(queryClient, sessionId)?.snapshot.session.revision,
  ).toBe(2);
});
```

Add cases for initial state, another session, older revision, and equal
revision refreshing only the incoming clock anchor.

- [ ] **Step 2: Run the cache test and verify the missing module fails**

Run:

```sh
bun test packages/sdk/test/checkout-cache.test.ts
```

Expected: failure because `checkout-cache.ts` does not exist.

- [ ] **Step 3: Implement the cache primitive**

Use:

```ts
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
```

`applyCheckoutState` must:

1. reject `incoming.snapshot.session.id !== sessionId`;
2. set an empty cache;
3. ignore an older revision;
4. retain the current snapshot but replace `clockAnchor` on equal revision;
5. replace the full state on newer revision; and
6. return the corresponding application result.

- [ ] **Step 4: Export and verify the primitive**

Export the cache API from `packages/sdk/src/index.ts`.

Run:

```sh
bun test packages/sdk/test/checkout-cache.test.ts
bun run typecheck:sdk
```

Expected: both pass.

- [ ] **Step 5: Commit only Task 5 files**

```sh
git add packages/sdk/src/cache packages/sdk/test/checkout-cache.test.ts \
  packages/sdk/src/index.ts
git commit -m "refactor: centralize checkout query state"
```

---

### Task 6: Move web and mobile checkout state to TanStack Query

**Files:**

- Create: `packages/sdk/src/react/use-checkout-state.ts`
- Modify: `packages/sdk/src/react/use-checkout-commands.ts`
- Modify: `packages/sdk/src/react/use-checkout-realtime.ts`
- Modify: `packages/sdk/src/index.ts`
- Modify: `packages/sdk/test/checkout-hooks.test.tsx`
- Modify: `packages/sdk/test/checkout-realtime-hook.test.tsx`
- Modify: `apps/web/lib/checkout-screen-context.tsx`
- Modify: `apps/web/app/checkout/[sessionId]/checkout-client-boundary.tsx`
- Modify: `apps/web/app/checkout/[sessionId]/checkout-client-boundary.test.tsx`
- Modify: `apps/web/components/checkout-exit.tsx`
- Modify: `apps/web/components/checkout-status.tsx`
- Modify: `apps/web/components/checkout-summary.tsx`
- Modify: `apps/web/components/hold-countdown.tsx`
- Modify: `apps/web/components/purchase-action.tsx`
- Modify: `apps/web/components/scenario-controls.tsx`
- Modify: `apps/mobile/src/checkout-screen.tsx`
- Modify: `apps/mobile/src/checkout-screen.test.ts`
- Modify: `apps/mobile/src/hold-countdown.tsx`
- Delete: `packages/sdk/src/react/checkout-context.ts`
- Delete: `packages/sdk/src/react/checkout-provider.tsx`
- Delete: `packages/sdk/src/stores/checkout/checkout.selectors.ts`
- Delete: `packages/sdk/src/stores/checkout/checkout.store.ts`
- Delete: `packages/sdk/src/stores/checkout/checkout.store.test.ts`

**Interfaces:**

- Produces:
  `useCheckoutState(sessionId, initialState): CheckoutState`
- Keeps named hooks:
  `useResumeCheckoutClient`, `useAcceptCheckoutOffer`,
  `usePurchaseCheckout`, `useRepriceCheckout`, `useExpireCheckout`,
  `useSetNextPaymentOutcome`, and `useOpenIosSimulator`
- Changes `CheckoutScreenRuntime` to include
  `checkout: CheckoutState`

- [ ] **Step 1: Rewrite the SDK hook tests around Query cache state**

Wrap hook probes only in `QueryClientProvider`; remove
`CheckoutProvider`/store fixtures.

Seed with:

```ts
applyCheckoutState(queryClient, context.sessionId, initialState);
```

After a successful mutation, authoritative conflict, or realtime message,
assert `getCheckoutState(queryClient, context.sessionId)`.

- [ ] **Step 2: Run hook tests and verify old provider assumptions fail**

Run:

```sh
bun test \
  packages/sdk/test/checkout-hooks.test.tsx \
  packages/sdk/test/checkout-realtime-hook.test.tsx
```

Expected: failures until hooks use the Query cache.

- [ ] **Step 3: Add Query-backed checkout observation**

Implement:

```ts
export function useCheckoutState(
  sessionId: string,
  initialState: CheckoutState,
): CheckoutState {
  const queryClient = useQueryClient();

  useLayoutEffect(() => {
    applyCheckoutState(queryClient, sessionId, initialState);
  }, [initialState, queryClient, sessionId]);

  const query = useQuery<CheckoutState>({
    queryKey: checkoutQueryKey(sessionId),
    queryFn: async () => initialState,
    initialData: () =>
      getCheckoutState(queryClient, sessionId) ?? initialState,
    enabled: false,
    staleTime: Infinity,
  });

  return query.data;
}
```

Keep `initialState` referentially stable at call sites so the layout effect
does not loop. If the installed TanStack Query overload still types `data` as
optional, use the defined-initial-data overload rather than a non-null cast.

- [ ] **Step 4: Consolidate command mutations**

Replace store access with `useQueryClient` and
`applyCheckoutState(queryClient, context.sessionId, result)`.

Use one private mutation option helper that:

- calls the supplied client operation;
- applies a successful `CheckoutCommandResult`;
- applies `CheckoutClientError` state when both snapshot and clock anchor are
  present; and
- invalidates activity/listings according to explicit flags.

Keep separate exported named hooks so UI call sites remain descriptive.

- [ ] **Step 5: Wire realtime to the Query cache**

Remove `copyCheckoutClientContext` and construct the memoized object directly
from scalar fields.

Pass subscription callbacks:

```ts
getSnapshot: () => {
  const state = getCheckoutState(queryClient, immutableContext.sessionId);
  if (!state) {
    throw new Error("Checkout state must be seeded before realtime starts.");
  }
  return state.snapshot;
},
applySnapshot: (snapshot, clockAnchor) =>
  applyCheckoutState(queryClient, immutableContext.sessionId, {
    snapshot,
    clockAnchor,
  }),
```

Keep related listing/activity invalidation and terminal reconnect behavior.

- [ ] **Step 6: Move the web screen context to Query state**

Change:

```ts
export interface CheckoutScreenRuntime {
  checkout: CheckoutState;
  client: CheckoutClient;
  context: CheckoutClientContext;
  isInteractive: boolean;
  realtimeStatus: RealtimeStatus;
}
```

In `CheckoutSubtree`, create the stable initial `CheckoutState` from the SSR
snapshot and hydrated clock handoff, call `useCheckoutState`, and apply resume
results through `applyCheckoutState`.

Remove `CheckoutProvider` and `createCheckoutStore`. Pass the current
`checkout` in both pending and ready screen runtime values.

- [ ] **Step 7: Update web components**

Replace selectors such as:

```ts
useCheckoutStore((state) => state.snapshot.status)
```

with:

```ts
useCheckoutScreen().checkout.snapshot.status
```

Use `checkout.clockAnchor` for countdown and purchase expiry decisions.
For explicit leave, use the current context checkout phase rather than reading
a separate store API.

- [ ] **Step 8: Move the native screen to Query state**

At the top of `CheckoutScreen`, call:

```ts
const checkout = useCheckoutState(context.sessionId, initialResult);
```

Pass `checkout` or the specific `snapshot`/`clockAnchor` value into the shallow
native child components. Keep `useCheckoutRealtime({ client, context })`.

For the navigation listener, retain the latest phase in a ref:

```ts
const phaseRef = useRef(checkout.snapshot.session.phase);
phaseRef.current = checkout.snapshot.session.phase;
```

and notify leave only while `phaseRef.current === "active"`.

- [ ] **Step 9: Delete Zustand modules and update tests**

Delete the store/provider/context-copy modules and their direct tests. Update
web/mobile component fixtures to provide `CheckoutState` through their new
runtime/props.

Run:

```sh
bun test packages/sdk apps/web apps/mobile
bun run typecheck
rg -n "zustand|CheckoutProvider|createCheckoutStore|useCheckoutStore|copyCheckoutClientContext" apps packages
```

Expected: tests and typecheck pass; the search has no matches outside lockfile
and manifests that will be cleaned in Task 7.

- [ ] **Step 10: Commit only Task 6 files**

```sh
git add packages/sdk/src/cache/checkout-cache.ts \
  packages/sdk/src/react/use-checkout-state.ts \
  packages/sdk/src/react/use-checkout-commands.ts \
  packages/sdk/src/react/use-checkout-realtime.ts \
  packages/sdk/src/react/checkout-context.ts \
  packages/sdk/src/react/checkout-provider.tsx \
  packages/sdk/src/stores/checkout/checkout.selectors.ts \
  packages/sdk/src/stores/checkout/checkout.store.ts \
  packages/sdk/src/stores/checkout/checkout.store.test.ts \
  packages/sdk/src/index.ts packages/sdk/test/checkout-hooks.test.tsx \
  packages/sdk/test/checkout-realtime-hook.test.tsx \
  apps/web/lib/checkout-screen-context.tsx \
  'apps/web/app/checkout/[sessionId]/checkout-client-boundary.tsx' \
  'apps/web/app/checkout/[sessionId]/checkout-client-boundary.test.tsx' \
  apps/web/components/checkout-exit.tsx \
  apps/web/components/checkout-status.tsx \
  apps/web/components/checkout-summary.tsx \
  apps/web/components/hold-countdown.tsx \
  apps/web/components/purchase-action.tsx \
  apps/web/components/scenario-controls.tsx \
  apps/mobile/src/checkout-screen.tsx \
  apps/mobile/src/checkout-screen.test.ts \
  apps/mobile/src/hold-countdown.tsx
git commit -m "refactor: move checkout UI to query state"
```

---

### Task 7: Remove obsolete helpers and dependencies

**Files:**

- Modify: `apps/web/components/listing-list.tsx`
- Modify: `apps/web/components/ui/button.tsx`
- Delete: `apps/web/lib/format.ts`
- Modify: `apps/api/package.json`
- Modify: `apps/web/package.json`
- Modify: `apps/mobile/package.json`
- Modify: `packages/sdk/package.json`
- Modify: `package.json`
- Modify: `bun.lock`
- Delete: `apps/web/next.config.ts` if production build proves the experimental
  option unnecessary

**Interfaces:**

- Removes packages: `better-result`, `zustand`, `expo-constants`, and
  `class-variance-authority`
- Keeps `formatUsd` exported directly by `@checkout/sdk`
- Keeps the current two button variants and CSS classes

- [ ] **Step 1: Replace the formatter re-export**

Import:

```ts
import { formatUsd } from "@checkout/sdk";
```

directly in `listing-list.tsx`, then delete `apps/web/lib/format.ts`.

- [ ] **Step 2: Simplify the two-variant button**

Replace `cva` with an explicit lookup:

```ts
type ButtonVariant = "default" | "outline";

const variantClasses: Record<ButtonVariant, string> = {
  default: "bg-neutral-950 text-white hover:bg-neutral-800",
  outline:
    "border border-neutral-300 bg-white text-neutral-950 hover:bg-neutral-100",
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export function Button({
  className,
  variant = "default",
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(baseClasses, variantClasses[variant], className)}
      {...props}
    />
  );
}
```

Reuse the exact existing base and variant class strings so presentation does
not change.

- [ ] **Step 3: Remove obsolete manifest dependencies**

Remove:

- `better-result` from `apps/api/package.json`;
- `class-variance-authority` from `apps/web/package.json`;
- `expo-constants` and `zustand` from `apps/mobile/package.json`; and
- `zustand` from `packages/sdk/package.json`.

Keep TanStack Query as an SDK peer/dev dependency and as a direct dependency
of web/mobile.

- [ ] **Step 4: Refresh the lockfile**

Run:

```sh
bun install
```

Expected: `bun.lock` no longer resolves dependencies that have no remaining
consumer.

- [ ] **Step 5: Prove optional config is unnecessary**

Temporarily remove `apps/web/next.config.ts` and run:

```sh
bun run --cwd apps/web build
bun run typecheck:web
```

If both pass, keep the file deleted. If Next requires the option, restore the
file and document that evidence in the task commit message body.

- [ ] **Step 6: Run dependency and quality checks**

Run:

```sh
rg -n "better-result|zustand|expo-constants|class-variance-authority" \
  apps packages package.json
bun test
bun run typecheck
bun run lint
bun run fmt:check
```

Expected: the search returns no source/manifest matches and all checks pass.

- [ ] **Step 7: Commit only Task 7 files**

```sh
git add package.json bun.lock apps/api/package.json apps/web/package.json \
  apps/mobile/package.json packages/sdk/package.json \
  apps/web/components/listing-list.tsx apps/web/components/ui/button.tsx \
  apps/web/lib/format.ts apps/web/next.config.ts
git commit -m "refactor: remove obsolete prototype indirection"
```

---

### Task 8: Remove generated native output and align documentation

**Files:**

- Modify: `apps/mobile/.gitignore`
- Delete: every tracked file under `apps/mobile/ios/`
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-07-29-checkout-continuity-design.md`
- Modify: `docs/superpowers/plans/2026-07-29-checkout-continuity.md`

**Interfaces:**

- Produces first-run native generation through the existing
  `bun run dev:mobile` / `expo run:ios` command.
- Produces a README that describes the final architecture and verification.
- Preserves the original design/plan as historical records.

- [ ] **Step 1: Verify the exact generated deletion target**

Run:

```sh
git ls-files apps/mobile/ios
```

Expected: only the generated native project files already reviewed during
design. Do not delete `apps/mobile/app`, `apps/mobile/src`, `app.json`, or
workspace configuration.

- [ ] **Step 2: Ignore generated native output**

Add to `apps/mobile/.gitignore`:

```gitignore
/ios/
```

Delete each tracked file reported by the previous command. This deletion was
explicitly approved in the design interview.

- [ ] **Step 3: Update the README for the end state**

Keep the walkthrough, but make the architecture explanation concise:

```text
API validates requests and owns the in-memory checkout.
SDK validates responses and applies HTTP/WebSocket snapshots to one
revision-aware TanStack Query entry.
Web and mobile render that shared state model.
```

State the fixed ports, permissive local CORS, first-run iOS generation, and the
existing verification commands. Remove environment-variable instructions.

- [ ] **Step 4: Mark original documents as historical**

Immediately below each old document title, add:

```markdown
> **Historical record:** This document describes the original implementation.
> The current simplification design is
> `docs/superpowers/specs/2026-07-29-prototype-simplification-design.md`.
```

Do not rewrite or delete the historical content.

- [ ] **Step 5: Verify native generation-independent outputs**

Run:

```sh
(cd apps/mobile && bun x expo export --platform ios)
bun run --cwd apps/web build
```

Expected: both pass without a tracked `apps/mobile/ios/` directory.

- [ ] **Step 6: Commit only Task 8 files**

```sh
git add apps/mobile/.gitignore apps/mobile/ios README.md \
  docs/superpowers/specs/2026-07-29-checkout-continuity-design.md \
  docs/superpowers/plans/2026-07-29-checkout-continuity.md
git commit -m "docs: align repository with simplified prototype"
```

---

### Task 9: Perform final correctness and simplicity verification

**Files:**

- Modify only files required to correct evidence-backed failures.

**Interfaces:**

- Produces a green repository and a concise final audit summary.

- [ ] **Step 1: Run formatting and static analysis**

```sh
bun run fmt
bun run fmt:check
bun run lint
bun run typecheck
```

Expected: all pass.

- [ ] **Step 2: Run all unit and integration tests**

```sh
bun test
```

Expected: all retained behavior tests pass. Record the final test/file count
for the handoff without treating reduction itself as success.

- [ ] **Step 3: Run build and end-to-end verification**

```sh
bun run --cwd apps/web build
bun run test:e2e
(cd apps/mobile && bun x expo export --platform ios)
```

Expected: all pass.

- [ ] **Step 4: Audit removed concepts**

Run:

```sh
rg -n \
  "better-result|zustand|NEXT_PUBLIC_API_URL|API_INTERNAL_URL|EXPO_PUBLIC_API_URL|WEB_BASE_URL|CheckoutSnapshotResponse|createCheckoutStore|useCheckoutStore" \
  apps packages package.json playwright.config.ts
```

Expected: no matches.

Run:

```sh
git ls-files apps/mobile/ios
```

Expected: no output.

- [ ] **Step 5: Review the four explanation paths**

Manually trace and record the exact files for:

1. validated route to service mutation;
2. transition to realtime publication;
3. HTTP/WebSocket snapshot to Query cache;
4. Query state to web and mobile presentation.

If any path requires a redundant pass-through file or duplicated state
translation, simplify it and rerun the relevant focused checks.

- [ ] **Step 6: Inspect the final diff and working tree**

Run:

```sh
git status --short
git diff --check
git log --oneline --decorate -12
```

Confirm the pre-existing `apps/web/next-env.d.ts` change remains separate from
task commits. Confirm no build output, `.expo`, `.next`, test result, or native
generated files are staged.

- [ ] **Step 7: Route any correction back to its owning task**

If Steps 1–6 expose a failure, return to the task that owns the affected file,
make the smallest evidence-backed correction, rerun that task's focused
verification, and stage only the exact paths listed in that task. Do not make a
catch-all commit and do not create an empty commit when verification is green.
