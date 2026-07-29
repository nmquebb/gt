# Checkout continuity

Checkout continuity is a local prototype for starting a single-seat ticket
checkout on the web and continuing the same session in an Expo iOS app. The API
owns the checkout snapshot, while both clients render its status, allowed
actions, price, hold, and order.

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
