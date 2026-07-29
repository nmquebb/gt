# Mobile Source Organization Design

## Goal

Reorganize the Expo mobile app so its source tree communicates ownership and
responsibility clearly, while preserving the app's runtime behavior, user-facing
copy, and deep-link contract.

## Structure

Use a feature-first hybrid structure:

```text
apps/mobile/
├── app/
│   ├── _layout.tsx
│   ├── index.tsx
│   └── checkout/[sessionId].tsx
└── src/
    ├── components/
    │   └── screen-shell.tsx
    ├── features/
    │   └── checkout/
    │       ├── components/
    │       │   ├── checkout-action.tsx
    │       │   ├── checkout-status-panel.tsx
    │       │   ├── hold-countdown.tsx
    │       │   └── offer-acceptance.tsx
    │       ├── checkout-presentation.ts
    │       ├── checkout-screen.test.ts
    │       ├── checkout-screen.tsx
    │       ├── parse-checkout-deep-link.test.ts
    │       └── parse-checkout-deep-link.ts
    ├── lib/
    │   ├── deep-link-config.test.ts
    │   ├── device-id.test.ts
    │   └── device-id.ts
    └── theme/
        ├── styles.ts
        └── tokens.ts
```

The existing Expo Router `app/` directory remains outside `src/`, because its
filesystem layout defines navigation. Route modules are thin framework adapters:
they receive navigation or linking input, validate and bootstrap it, then render
a screen from `src/`.

## Boundaries

`src/features/checkout/` owns code used only by the checkout experience. Its
screen is the feature composition root, and its private components remain
co-located under `components/`. Extracting these components reduces the size and
mixed responsibilities of the current checkout screen without creating
application-wide abstractions.

`src/components/` contains reusable presentation components that are not owned
by one feature. Initially this contains `ScreenShell`.

`src/lib/` contains app-wide, non-visual infrastructure. The persisted device
identifier and the app configuration contract test belong here.

`src/theme/` separates design tokens from the React Native style sheet. Tokens
contain the color, radius, and spacing values. Styles consume those tokens and
remain shared until a feature demonstrates a need for private styles.

## Naming and Imports

Rename `checkout-route.ts` to `parse-checkout-deep-link.ts`. The old name makes a
deep-link parsing utility sound like an Expo Router entrypoint.

Configure the existing TypeScript path alias so `@/` resolves to `src/`.
Application modules use `@/components/...`, `@/features/...`, `@/lib/...`, and
`@/theme/...` imports. Relative imports are acceptable within a tightly
co-located checkout component folder when they improve locality.

Avoid barrel files. Direct imports keep ownership and dependency direction
visible in this small app.

## Checkout Composition

`checkout-screen.tsx` retains checkout state subscription, realtime connection,
navigation-leave handling, and page composition. The following focused visual
units move into private checkout components:

- `OfferAcceptance` owns the accept-offer mutation and its feedback.
- `CheckoutAction` owns purchase and retry mutations plus hold-expiry gating.
- `CheckoutStatusPanel` maps checkout and realtime status to visible feedback.
- `HoldCountdown` renders the monotonic hold countdown.

The purchase-progress placeholder may remain in `checkout-screen.tsx` because it
is a small composition detail with no independent behavior.

The route entrypoint `app/checkout/[sessionId].tsx` continues to own resume
bootstrap behavior and failure states. Splitting that workflow is outside this
organization refactor.

## Behavior and Error Handling

This is a behavior-preserving refactor. Existing loading, invalid-link,
authorization, not-found, offline, retry, checkout, purchase, and terminal
states retain their current behavior and copy. Device ID fallback behavior,
best-effort leave reporting, realtime updates, and monotonic hold expiration
remain unchanged.

No dependencies or new runtime abstractions are introduced.

## Verification

Move tests alongside the modules whose behavior they cover and update imports
without weakening assertions. Verify the refactor with:

```sh
bun test apps/mobile/src
bun run --cwd apps/mobile typecheck
bun run fmt:check
bun run lint
(cd apps/mobile && bun x expo export --platform ios)
```

The refactor is complete when these checks pass and the resulting source tree
matches the documented ownership boundaries.
