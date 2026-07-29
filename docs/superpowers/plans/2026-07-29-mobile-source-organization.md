# Mobile Source Organization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize the Expo mobile source tree around clear shared and
checkout-feature boundaries while preserving all behavior and user-facing copy.

**Architecture:** Keep Expo Router entrypoints in `app/` and make them consume
modules under `src/`. Put reusable UI, infrastructure, and theme code in
top-level `src` folders; co-locate checkout-only screens, components, helpers,
and tests under `src/features/checkout/`.

**Tech Stack:** Bun, strict TypeScript, Expo Router, React Native, TanStack
Query, Zod, Oxlint, and Oxfmt.

## Global Constraints

- Preserve runtime behavior, navigation behavior, deep-link parsing, and all
  user-facing copy.
- Keep Expo Router entrypoints under `apps/mobile/app/`.
- Keep checkout-specific implementation and tests co-located under
  `apps/mobile/src/features/checkout/`.
- Keep `CheckoutBootstrap` and its resume failure states in
  `apps/mobile/app/checkout/[sessionId].tsx`.
- Introduce no dependencies and no barrel files.
- Make `@/` resolve to `apps/mobile/src/`.
- Leave the pre-existing modification to
  `apps/api/src/services/checkout/checkout.projection.ts` untouched and out of
  every commit.

---

## Target File Map

- `apps/mobile/app/` — filesystem routes and route bootstrap only.
- `apps/mobile/src/components/screen-shell.tsx` — reusable page shell.
- `apps/mobile/src/lib/device-id.ts` — app-wide device identity infrastructure.
- `apps/mobile/src/lib/*.test.ts` — infrastructure and application-contract
  tests.
- `apps/mobile/src/theme/tokens.ts` — colors, radii, and spacing.
- `apps/mobile/src/theme/styles.ts` — shared React Native styles.
- `apps/mobile/src/features/checkout/checkout-screen.tsx` — checkout state,
  realtime, leave handling, and page composition.
- `apps/mobile/src/features/checkout/checkout-presentation.ts` — checkout
  status/realtime presentation mappings.
- `apps/mobile/src/features/checkout/parse-checkout-deep-link.ts` — validated
  deep-link parsing.
- `apps/mobile/src/features/checkout/components/offer-acceptance.tsx` —
  accept-offer mutation UI.
- `apps/mobile/src/features/checkout/components/checkout-action.tsx` —
  purchase/retry mutation UI and hold-expiry gating.
- `apps/mobile/src/features/checkout/components/checkout-status-panel.tsx` —
  checkout and realtime status presentation.
- `apps/mobile/src/features/checkout/components/hold-countdown.tsx` —
  monotonic hold countdown.
- Tests remain beside their subject modules.

### Task 1: Establish shared source boundaries and the `src` alias

**Files:**

- Modify: `apps/mobile/tsconfig.json`
- Modify: `apps/mobile/app/index.tsx`
- Modify: `apps/mobile/app/checkout/[sessionId].tsx`
- Create: `apps/mobile/src/components/screen-shell.tsx`
- Create: `apps/mobile/src/lib/device-id.ts`
- Create: `apps/mobile/src/lib/device-id.test.ts`
- Create: `apps/mobile/src/lib/deep-link-config.test.ts`
- Create: `apps/mobile/src/theme/tokens.ts`
- Create: `apps/mobile/src/theme/styles.ts`
- Modify: `apps/mobile/src/checkout-screen.tsx`
- Modify: `apps/mobile/src/hold-countdown.tsx`
- Delete: `apps/mobile/src/screen-shell.tsx`
- Delete: `apps/mobile/src/device-id.ts`
- Delete: `apps/mobile/src/device-id.test.ts`
- Delete: `apps/mobile/src/deep-link-config.test.ts`
- Delete: `apps/mobile/src/theme.ts`

**Interfaces:**

- Produces: `@/` resolving to `apps/mobile/src/`
- Produces: `ScreenShell({ children }: PropsWithChildren)`
- Produces: `getMobileDeviceId(): Promise<string>`
- Produces: `theme` from `@/theme/tokens`
- Produces: `styles` from `@/theme/styles`
- Preserves: existing device ID and deep-link configuration behavior

- [ ] **Step 1: Record the shared-module characterization baseline**

Run:

```sh
bun test apps/mobile/src/device-id.test.ts \
  apps/mobile/src/deep-link-config.test.ts \
  apps/mobile/src/checkout-screen.test.ts
bun run --cwd apps/mobile typecheck
```

Expected: all existing tests pass and TypeScript reports no errors.

- [ ] **Step 2: Point the existing alias at `src`**

Change `apps/mobile/tsconfig.json` to:

```json
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true,
    "types": ["bun"],
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["**/*.ts", "**/*.tsx", ".expo/types/**/*.ts", "expo-env.d.ts"]
}
```

- [ ] **Step 3: Split the theme into tokens and styles**

Move the current `theme` object unchanged to
`apps/mobile/src/theme/tokens.ts`:

```ts
export const theme = {
  color: {
    accent: "#0a0a0a",
    border: "#e5e5e5",
    canvas: "#f5f5f5",
    danger: "#b91c1c",
    dangerBackground: "#fef2f2",
    dangerBorder: "#fecaca",
    info: "#0369a1",
    infoBackground: "#f0f9ff",
    infoBorder: "#bae6fd",
    muted: "#737373",
    neutralBackground: "#f5f5f5",
    neutralBorder: "#d4d4d4",
    panel: "#ffffff",
    success: "#047857",
    successBackground: "#ecfdf5",
    successBorder: "#a7f3d0",
    text: "#171717",
    warning: "#b45309",
    warningBackground: "#fffbeb",
    warningBorder: "#fde68a",
  },
  radius: {
    card: 8,
    control: 6,
  },
  space: {
    large: 24,
    medium: 16,
    small: 8,
    xlarge: 32,
    xsmall: 4,
  },
} as const;
```

Move the current `StyleSheet.create({...})` call unchanged to
`apps/mobile/src/theme/styles.ts` and add:

```ts
import { StyleSheet } from "react-native";
import { theme } from "./tokens";
```

Delete `apps/mobile/src/theme.ts`.

- [ ] **Step 4: Move shared UI and infrastructure with their tests**

Move `screen-shell.tsx` to `src/components/screen-shell.tsx` and import:

```ts
import { styles } from "@/theme/styles";
```

Move `device-id.ts`, `device-id.test.ts`, and `deep-link-config.test.ts` to
`src/lib/`. Keep their implementation and assertions unchanged. Update the app
configuration test's moved relative imports to:

```ts
import appConfig from "../../app.json";
import { createCheckoutLinks } from "../../../api/src/http/links";
```

- [ ] **Step 5: Update consumers to use ownership-revealing imports**

In `app/index.tsx`, use:

```ts
import { ScreenShell } from "@/components/screen-shell";
import { styles } from "@/theme/styles";
```

In `app/checkout/[sessionId].tsx`, use:

```ts
import { getMobileDeviceId } from "@/lib/device-id";
import { ScreenShell } from "@/components/screen-shell";
import { styles } from "@/theme/styles";
```

In the still-flat `src/checkout-screen.tsx`, use:

```ts
import { ScreenShell } from "@/components/screen-shell";
import { styles } from "@/theme/styles";
```

In the still-flat `src/hold-countdown.tsx`, use:

```ts
import { styles } from "@/theme/styles";
```

- [ ] **Step 6: Verify the shared boundaries**

Run:

```sh
bun test apps/mobile/src/lib apps/mobile/src/checkout-screen.test.ts
bun run --cwd apps/mobile typecheck
bun run fmt:check
bun run lint
```

Expected: all commands pass. Confirm no source import still targets the removed
flat modules:

```sh
rg -n 'src/(screen-shell|device-id|theme)|from "\\./(screen-shell|device-id|theme)"|from "\\.\\./src/(screen-shell|device-id|theme)"' apps/mobile --glob '!ios/**' --glob '!.expo/**'
```

Expected: no matches.

- [ ] **Step 7: Commit Task 1**

```sh
git add apps/mobile/tsconfig.json apps/mobile/app/index.tsx \
  'apps/mobile/app/checkout/[sessionId].tsx' \
  apps/mobile/src/components apps/mobile/src/lib apps/mobile/src/theme \
  apps/mobile/src/checkout-screen.tsx apps/mobile/src/hold-countdown.tsx \
  apps/mobile/src/screen-shell.tsx apps/mobile/src/device-id.ts \
  apps/mobile/src/device-id.test.ts apps/mobile/src/deep-link-config.test.ts \
  apps/mobile/src/theme.ts
git commit -m "refactor: organize shared mobile source"
```

### Task 2: Co-locate and decompose the checkout feature

**Files:**

- Modify: `apps/mobile/app/checkout/[sessionId].tsx`
- Create: `apps/mobile/src/features/checkout/checkout-presentation.ts`
- Create: `apps/mobile/src/features/checkout/checkout-screen.tsx`
- Create: `apps/mobile/src/features/checkout/checkout-screen.test.ts`
- Create: `apps/mobile/src/features/checkout/parse-checkout-deep-link.ts`
- Create: `apps/mobile/src/features/checkout/parse-checkout-deep-link.test.ts`
- Create: `apps/mobile/src/features/checkout/components/checkout-action.tsx`
- Create: `apps/mobile/src/features/checkout/components/checkout-status-panel.tsx`
- Create: `apps/mobile/src/features/checkout/components/hold-countdown.tsx`
- Create: `apps/mobile/src/features/checkout/components/offer-acceptance.tsx`
- Delete: `apps/mobile/src/checkout-presentation.ts`
- Delete: `apps/mobile/src/checkout-route.ts`
- Delete: `apps/mobile/src/checkout-route.test.ts`
- Delete: `apps/mobile/src/checkout-screen.tsx`
- Delete: `apps/mobile/src/checkout-screen.test.ts`
- Delete: `apps/mobile/src/hold-countdown.tsx`

**Interfaces:**

- Produces:
  `parseCheckoutDeepLink(incomingUrl: string | null): CheckoutRouteContext | undefined`
- Produces:
  `CheckoutScreen({ client, context, initialResult }: CheckoutScreenProps)`
- Produces checkout-private `OfferAcceptance`, `CheckoutAction`,
  `CheckoutStatusPanel`, and `HoldCountdown` components
- Preserves the existing `CheckoutScreen` test surface and all rendered copy

- [ ] **Step 1: Record the checkout characterization baseline**

Run:

```sh
bun test apps/mobile/src/checkout-route.test.ts \
  apps/mobile/src/checkout-screen.test.ts
```

Expected: all seven checkout parsing and screen behavior tests pass.

- [ ] **Step 2: Move and clarify checkout-owned modules**

Move the following without changing behavior:

```text
src/checkout-presentation.ts
  → src/features/checkout/checkout-presentation.ts
src/checkout-route.ts
  → src/features/checkout/parse-checkout-deep-link.ts
src/checkout-route.test.ts
  → src/features/checkout/parse-checkout-deep-link.test.ts
src/checkout-screen.tsx
  → src/features/checkout/checkout-screen.tsx
src/checkout-screen.test.ts
  → src/features/checkout/checkout-screen.test.ts
src/hold-countdown.tsx
  → src/features/checkout/components/hold-countdown.tsx
```

In the renamed parser test, retain the local subject import:

```ts
import { parseCheckoutDeepLink } from "./parse-checkout-deep-link";
```

In the moved countdown, import:

```ts
import { styles } from "@/theme/styles";
```

- [ ] **Step 3: Extract offer acceptance**

Create `components/offer-acceptance.tsx` from the current
`OfferAcceptanceProps` and `OfferAcceptance` implementation. Export the
component and preserve its mutation, disabled state, labels, and error copy:

```ts
export function OfferAcceptance({
  client,
  context,
  currentVersion,
}: {
  client: Pick<CheckoutClient, "acceptOffer">;
  context: CheckoutClientContext;
  currentVersion: number;
}) {
  const acceptOffer = useAcceptCheckoutOffer(client, context);

  return (
    <View style={styles.section}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: acceptOffer.isPending }}
        disabled={acceptOffer.isPending}
        onPress={() => acceptOffer.mutate(currentVersion)}
        style={[
          styles.button,
          acceptOffer.isPending ? styles.buttonDisabled : undefined,
        ]}
      >
        <Text style={styles.buttonText}>
          {acceptOffer.isPending ? "Accepting price…" : "Accept new price"}
        </Text>
      </Pressable>
      {acceptOffer.error ? (
        <Text role="alert" style={styles.error}>
          The current price could not be accepted. Please try again.
        </Text>
      ) : null}
    </View>
  );
}
```

Use `@/theme/styles` for styling.

- [ ] **Step 4: Extract the purchase action**

Create `components/checkout-action.tsx` from the current
`CheckoutActionProps` and `CheckoutAction` implementation:

```ts
export function CheckoutAction({
  action,
  allowedActions,
  client,
  clockAnchor,
  context,
}: {
  action: "purchase" | "retry_purchase";
  allowedActions: CheckoutSnapshot["allowedActions"];
  client: Pick<CheckoutClient, "purchase">;
  clockAnchor: ClockAnchor;
  context: CheckoutClientContext;
}) {
  const purchase = usePurchaseCheckout(client, context, randomUUID);
  const [remainingMs, setRemainingMs] = useState(() =>
    remainingHoldMs(clockAnchor, performance.now()),
  );

  useEffect(() => {
    function update() {
      setRemainingMs(remainingHoldMs(clockAnchor, performance.now()));
    }

    update();
    const interval = globalThis.setInterval(update, 1_000);

    return () => globalThis.clearInterval(interval);
  }, [clockAnchor]);

  const enabled =
    allowedActions.includes(action) && remainingMs > 0 && !purchase.isPending;
  const label = purchase.isPending
    ? "Completing purchase…"
    : action === "retry_purchase"
      ? "Retry purchase"
      : "Purchase";

  return (
    <View style={styles.section}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !enabled }}
        disabled={!enabled}
        onPress={() => purchase.mutate()}
        style={[styles.button, enabled ? undefined : styles.buttonDisabled]}
      >
        <Text style={styles.buttonText}>{label}</Text>
      </Pressable>
      {purchase.error ? (
        <Text role="alert" style={styles.error}>
          The purchase could not be completed. Please try again.
        </Text>
      ) : null}
    </View>
  );
}
```

Use `@/theme/styles` for styling.

- [ ] **Step 5: Extract status presentation**

Create `components/checkout-status-panel.tsx` with the existing tone-to-style
mapping and panel JSX:

```ts
const statusToneStyles = {
  danger: styles.statusDanger,
  info: styles.statusInfo,
  neutral: styles.statusNeutral,
  success: styles.statusSuccess,
  warning: styles.statusWarning,
} satisfies Record<CheckoutStatusTone, object>;

export function CheckoutStatusPanel({
  realtimeStatus,
  status,
}: {
  realtimeStatus: RealtimeStatus;
  status: CheckoutSnapshot["status"];
}) {
  const presentation = checkoutStatusPresentation[status];
  const copy = checkoutCopy[status];

  return (
    <View
      accessibilityLiveRegion="polite"
      style={[styles.statusPanel, statusToneStyles[presentation.tone]]}
    >
      <Text style={styles.statusHeading}>{copy.heading}</Text>
      <Text style={styles.statusBody}>{copy.description}</Text>
      <Text style={styles.statusConnection}>
        {realtimeStatusCopy[realtimeStatus]}
      </Text>
    </View>
  );
}
```

Import presentation mappings from `../checkout-presentation` and shared styles
from `@/theme/styles`.

- [ ] **Step 6: Reduce the checkout screen to composition**

Remove the extracted component implementations and their now-unused imports
from `checkout-screen.tsx`. Add:

```ts
import { ScreenShell } from "@/components/screen-shell";
import { styles } from "@/theme/styles";
import { CheckoutAction } from "./components/checkout-action";
import { CheckoutStatusPanel } from "./components/checkout-status-panel";
import { HoldCountdown } from "./components/hold-countdown";
import { OfferAcceptance } from "./components/offer-acceptance";
```

Keep `CheckoutScreenClient`, `CheckoutPurchaseProgress`, `CheckoutContent`,
`CheckoutScreenProps`, and `CheckoutScreen` in the screen module. Preserve
state selection, realtime subscription, leave handling, derived action state,
layout, and copy unchanged.

- [ ] **Step 7: Make the Expo route consume the feature**

Replace the old checkout imports in `app/checkout/[sessionId].tsx` with:

```ts
import {
  parseCheckoutDeepLink,
  type CheckoutRouteContext,
} from "@/features/checkout/parse-checkout-deep-link";
import { CheckoutScreen } from "@/features/checkout/checkout-screen";
```

Keep `CheckoutBootstrap`, API client construction, failure mapping, retry, and
invalid-link rendering unchanged.

- [ ] **Step 8: Verify checkout behavior and the final tree**

Run:

```sh
bun test apps/mobile/src/features/checkout apps/mobile/src/lib
bun run --cwd apps/mobile typecheck
bun x oxfmt apps/mobile/app apps/mobile/src apps/mobile/tsconfig.json
bun run fmt:check
bun run lint
(cd apps/mobile && bun x expo export --platform ios)
```

Expected: every command passes and the iOS export completes. Inspect:

```sh
find apps/mobile/src -type f | sort
```

Expected: only `components/`, `features/`, `lib/`, and `theme/` appear directly
under `src`, matching the target file map.

- [ ] **Step 9: Commit Task 2**

```sh
git add 'apps/mobile/app/checkout/[sessionId].tsx' \
  apps/mobile/src/features apps/mobile/src/checkout-presentation.ts \
  apps/mobile/src/checkout-route.ts apps/mobile/src/checkout-route.test.ts \
  apps/mobile/src/checkout-screen.tsx apps/mobile/src/checkout-screen.test.ts \
  apps/mobile/src/hold-countdown.tsx
git commit -m "refactor: organize mobile checkout feature"
```

### Task 3: Run repository-level regression verification

**Files:**

- No source changes expected.

**Interfaces:**

- Verifies: mobile organization remains compatible with every repository
  workspace and integration test.

- [ ] **Step 1: Confirm only the user's unrelated change remains**

Run:

```sh
git status --short
```

Expected: the only remaining change is the pre-existing modification to
`apps/api/src/services/checkout/checkout.projection.ts`.

- [ ] **Step 2: Run the complete repository checks**

Run:

```sh
bun run fmt:check
bun run lint
bun run typecheck
bun test
```

Expected: every command exits successfully.

- [ ] **Step 3: Inspect the implementation commits**

Run:

```sh
git log -3 --oneline
git diff HEAD~2..HEAD --stat
```

Expected: the two implementation commits contain only mobile source
organization changes; the separately committed design and plan remain intact.
