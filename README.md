![Checkout continuity web experience](<docs/Screenshot 2026-07-29 at 8.01.29 PM.png>)

![Checkout continuity mobile handoff](<docs/Screenshot 2026-07-29 at 8.01.50 PM.png>)

# Checkout continuity

For this exercise I went the full AI route. After working through requirements and familiarizing myself with the problem I generated a summarizing document that I can then take to Codex for a proper spec/plan/implement process. 

For skills I installed Superpowers. I've found it to be thorough, but also a little token heavy and slow at times. Alternatively, I thought about using Matt Pocock's suite of skills or even chunking through it in plan mode, but felt the workflow with Superpower's was more representative of how I'd treat a real feature - iterate on a spec, create a plan, implement, review.

**What you built and how to run it**

I went with a monorepo setup that resembles many of the projects I've worked on lately. Hono, Next, Expo, React Query, Tailwind. I originally had Zustand and `better-result` but they were deemed unnecessary after reviewing the initial implementation.

The server covers delivering static listings, creating checkout sessions and processing session events with safeguards. Clients consume an `sdk` package that distribute network calls and common logic.

The bottom of this document is the AI generated README.md that does a good job covering how to get it up and running.

**The checkout session state model**

[checkout.contract.ts - Checkout session zod schemas and type definitions](packages/sdk/src/contracts/checkout.contract.ts)

The server owns the checkout session that is then shared by web and mobile. The record contains event/listing details, inventory hold expiration (countdown), current/accepted offer versions/prices ("accept price change" UI), payment status, lifecycle phase, and optional completed order.

The lifecycle moves through active, purchasing, and then completed/expired/abandoned. With each of these steps the app derives a customer facing status and allowed actions from this data. Both clients receive session snapshots (either via request or websocket events) and apply the newest revisions to keep web and mobile synchronized.

**How web and mobile resume the same session**

I didn't go with a mock user or assume authentication during this exercise. Each device generates a `deviceId` that it stores locally. When the web creates a checkout session it is returned an `id` to identify the session, but also a `resumeToken` that is used to share/validate that session with mobile via deeplink. The web retains that resume token as I wanted to be sure the checkout page demonstrated SSR with relevant information and proper hydration + UX improvement. 

**How you handle stale inventory, price changes, or duplicate completion**

After the client lands on the checkout page it establishes a websocket connection. This connection immediately returns a snapshot of the latest state. From here the 2 clients are kept in sync as events are handled for price changes, accepting those changes, expiration, purchases, etc.

This websocket **is not** the mechanism that guarantees a listing is only purchased once. 

A per client idempotency key is sent with the request to purchase the listing. The idempotency key dedupes requests coming in from a single client. If they fire off the same request multiple times the pending/failed/successful purchase is returned without creating another purchase attempt. 

The server also maintains a lock on both the listing (probably not necessary here, but useful for a full build out) and session. These locks are the strongest purchase safeguard. Any time a purchase is attempted there is a sequence of locking the resource, validating it's current state and then either updates it, or if an error occurs returns the previous state and an error.

**What tradeoffs you made**
**What you'd do differently with more time**

Sorry, combined these 2 sections as I had a "do differently" for many of my tradeoffs.

- In going the full AI route I feel like I lost some comfort with the codebase. It's not just that it was all created in one big swing - it's more that without some time in the saddle to provide feedback and generate steering documents from actual work within the project you end up with a codebase that may not be entirely up to your standards or your preferred code style. I probably should've broke it down into smaller chunks and went through that feedback loop early on so the next chunk was improved, but I was concerned with trying to stay within the 2-3 hours.. but I also went over that time a bit anyways.
- Instead of mocking auth I had to come up with the token handoff system. For this prototype the `resumeToken` setup works _fine_, but in practice the it could be handled in a more secure fashion. Instead of issuing a single resume token I would create a "share with a friend" feature that generates short lived, one time handoff tokens to assign users to a session. For the individuals I would include a request to fetch my current checkout sessions when opening on another device, and optionally navigate to it from there.
- The websockets events return a full snapshot each time. At scale I would probably go for an initial snapshot with subsequent deltas. Sequencing would have to be hardened here too, especially in Gametime's use-case where people are probably dealing with network performance issues from high population density and already poor venue reception.
- The presence system was thrown in because I didn't like the idea of a mobile checkout being expired if the web client navigates back to the listings page. We currently keep a record of `observedClients` which is really just a websocket connection counter. An identity based system would be more accurate (think multiple browser tabs) and a grace period would accomodate recovery after network hiccups.

---

# Original AI generated readme

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
