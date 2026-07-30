![Checkout continuity web experience](<docs/Screenshot 2026-07-29 at 8.01.29 PM.png>)

![Checkout continuity mobile handoff](<docs/Screenshot 2026-07-29 at 8.01.50 PM.png>)

# Checkout continuity

For this exercise I went pretty much all-in on an AI-assisted workflow. I worked through the requirements, got familiar with the problem, and wrote a summary that I could take into Codex for a spec/plan/implement/review loop.

I installed Superpowers for that workflow. I've found it to be thorough, although it can be a little token-heavy and slow at times. I considered Matt Pocock's suite of skills or working through the project in plan mode, but Superpowers felt the most representative of how I'd handle a real feature: agree on the requirements, write a plan, implement it, and review the result.

My workflow is fairly stock:
- Brainstorming & plan with `gpt-5.6-sol` on `medium` or `high`
- Dig in and iterate on the spec/plan
- Implement with `gpt-5.6-terra` on `high`
- Scan touched tests for obvious breakage or cheating
- Adversarial review with either `gpt-5.6-sol` on `high` or if I have it available `opus-5`
- Dig into code for correctness and code style refinement

Adversarial review is the only thing I may drop depending on how involved the feature was and if the skills include a heavy verification step (in this case Superpowers does).

I should note that I think Superpowers is great, but it is not by any means perfect. I play around with various skill sets and methodologies constantly. In this case it was something I could use to get up and running quickly without much ceremony.

## What you built and how to run it

I built a monorepo with a Hono API, a Next.js web app, an Expo iOS app, and a shared SDK built around React Query and Zod. I originally included Zustand and `better-result`, but removed both after reviewing the initial implementation because they weren't earning their place.

The API serves the static listings and owns the checkout state. The SDK centralizes the contracts, network calls, cache behavior, and realtime logic so the web and mobile clients don't each have to solve consistency on their own.

To run everything:

```sh
bun install
bun run dev
```

The implementation reference at the bottom has the individual commands, walkthrough, and full verification suite.

## The checkout session state model

The server owns the canonical checkout session shared by web and mobile. The [`checkout.contract.ts`](packages/sdk/src/contracts/checkout.contract.ts) schema contains the event and listing details, inventory hold expiration, current and accepted offer versions and prices, payment state, lifecycle phase, and optional completed order.

The lifecycle moves through `active` and `purchasing`, then into `completed`, `expired`, or `abandoned`. The API derives the customer-facing status and allowed actions from that state rather than asking each client to interpret it independently.

Both clients receive full snapshots over HTTP and WebSocket. Each snapshot carries a revision, and the SDK only applies newer revisions, so a late response or event can't roll the UI back to stale state.

## How web and mobile resume the same session

I didn't mock a user or assume an authentication system for this exercise. Each device generates and stores a stable `deviceId`. When the web creates a checkout session, the API returns both a session `id` and a `resumeToken`; the **Open in app** deep link carries those values to mobile, which can then fetch and continue the same server-owned session.

The web retains the token so the checkout route can fetch the current session during server rendering, then hydrate the client with that snapshot and its clock anchor. That avoids showing an empty checkout first or resetting the hold countdown during hydration.

The `resumeToken` is intentionally a prototype-level capability token, not a replacement for production authentication. In a real system I would associate the session with the signed-in user and make explicit sharing a separate, short-lived handoff flow.

## How you handle stale inventory, price changes, or duplicate completion

Once either client opens checkout it establishes a WebSocket connection and receives the latest snapshot. Subsequent events keep both surfaces synchronized, and revision checks prevent out-of-order updates from overwriting newer state.

That realtime connection is **not** what guarantees a listing is only purchased once. A changed offer has its own version and must be accepted before purchase is allowed. The purchase path also rechecks the session state and hold expiration while the relevant resources are locked.

Each client sends an idempotency key with its purchase request. Repeating the same request returns the existing pending, failed, or completed attempt instead of creating another one. The server also locks both the session and listing around the state transition, then re-reads and validates the current state before writing the attempt or order. Together, the idempotency record and locks are the actual duplicate-completion safeguards; WebSocket events just make the result visible quickly.

## What tradeoffs you made and what you'd do differently with more time

I combined these because most of the tradeoffs have a pretty direct “what I'd do next” attached to them.

- Going all-in on AI gave me a lot of breadth quickly, but I lost some comfort with the codebase by generating too much in one pass. With more time I'd split the work into smaller vertical slices and get a tighter feedback loop going earlier. The later review did catch unnecessary pieces like Zustand and `better-result`; I'd rather apply that kind of steering after each slice.
- The API uses an in-memory repository and process-local locks. That kept the prototype focused on checkout behavior, but it isn't a scaling story. In production I'd move the state and idempotency records into durable storage and enforce the critical transitions with transactional or conditional writes.
- Instead of mocking auth I used the `resumeToken` handoff. It works for this prototype, but I wouldn't use one long-lived token for both access and sharing in production. I'd associate sessions with the signed-in user, let their other devices discover active checkouts, and generate a short-lived, one-time token for an explicit “share with a friend” flow.
- WebSocket events currently send a full snapshot each time. At scale I'd probably use an initial snapshot followed by deltas, with hardened sequencing and reconnect behavior. That matters even more for Gametime's use case, where customers may already be dealing with congested networks and poor venue reception.
- Presence is intentionally best-effort. The current observed-client and socket tracking is enough to avoid expiring a mobile checkout just because the web navigated away, but a production version should use identity-aware leases, handle multiple tabs correctly, and allow a grace period for brief network drops.

---

# Implementation reference

Checkout continuity is a local prototype for starting a single-seat ticket
checkout on the web and continuing the same session in an Expo iOS app. The API
owns the checkout snapshot, while both clients render its status, allowed
actions, price, hold, and order.

## Architecture

API validates requests and owns the in-memory checkout. SDK validates responses
and applies HTTP/WebSocket snapshots to one revision-aware TanStack Query entry.
Web and mobile render that shared state model.

The web checkout exposes an authenticated **Open in app** handoff to the local
iOS simulator. Web and mobile then receive complete checkout updates over
realtime connections and can continue the same repricing, payment, and
completion workflow.

## Install and run

```sh
bun install
bun run dev
```

The combined development command starts the API, web app, and Expo iOS
development client. They can also be started separately:

```sh
bun run dev:api
bun run dev:web
bun run dev:mobile
```

The API always runs on `http://127.0.0.1:3000` and the web app on
`http://127.0.0.1:8000`. REST routes use permissive CORS for this local
prototype. On the first `bun run dev:mobile` (or `expo run:ios`), Expo generates
the iOS native project before launching the simulator; that generated `ios/`
directory is intentionally untracked.

## Walkthrough

1. Open the web listings and choose **Buy now**.
2. On checkout, choose **Open in app** to resume the same session in iOS, or
   continue in the browser.
3. Expand the collapsed **Dev** panel to change the price, expire the hold, or
   make the next payment succeed or fail.
4. Accept a changed price, purchase, retry a failed payment, and review the
   activity timeline and confirmed order.

Purchase start and finalization use the same session/listing lock keys plus a
recorded pending attempt and order, so concurrent commands still create at most
one attempt and one order. The countdown is derived from a server clock anchor
and local monotonic time, so wall-clock changes do not extend the hold. Presence
is best effort: active realtime socket count keeps the session available across
handoff, while explicit leave reports navigation without pretending disconnected
clients are durable presence.

## Verify

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
