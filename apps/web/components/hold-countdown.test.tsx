import { afterEach, expect, test } from "bun:test";
import {
  createCheckoutClient,
  type CheckoutSnapshot,
  type ClockAnchor,
} from "@checkout/sdk";
import {
  CheckoutScreenProvider,
  type CheckoutScreenRuntime,
} from "@/lib/checkout-screen-context";
import { act } from "react-test-renderer";
import { HoldCountdown } from "./hold-countdown";
import {
  createReactTestHarness,
  textContent,
} from "@checkout/sdk/test-utils/react-test-renderer";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalPerformanceNow = Object.getOwnPropertyDescriptor(
  globalThis.performance,
  "now",
);

const snapshot: CheckoutSnapshot = {
  serverNow: "2026-07-29T17:00:00.000Z",
  session: {
    id: "chk_1",
    revision: 1,
    createdAt: "2026-07-29T16:59:00.000Z",
    updatedAt: "2026-07-29T17:00:00.000Z",
    event: {
      name: "Chicago Bears vs. Green Bay Packers",
      venue: "Soldier Field",
      timeLabel: "Sunday at 12:00 PM",
      isDemo: true,
    },
    listing: { id: "lst_1", section: "101", row: "A", seat: "1" },
    inventoryHold: { expiresAt: "2026-07-29T17:01:30.000Z" },
    offer: {
      currency: "USD",
      currentVersion: 1,
      currentTotalCents: 12_500,
      acceptedVersion: 1,
      acceptedTotalCents: 12_500,
    },
    phase: "active",
    payment: { status: "idle" },
  },
  allowedActions: ["purchase"],
  status: "ready",
};

class TimerWindow {
  private nextId = 1;
  readonly intervals = new Map<number, () => void>();

  setInterval(callback: TimerHandler) {
    if (typeof callback !== "function") {
      throw new TypeError("Timer callback must be a function");
    }
    const id = this.nextId++;
    this.intervals.set(id, callback as () => void);

    return id;
  }

  clearInterval(id: number) {
    this.intervals.delete(id);
  }

  tick() {
    for (const callback of this.intervals.values()) {
      callback();
    }
  }
}

function installClock(now: { value: number }) {
  const timerWindow = new TimerWindow();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: timerWindow,
  });
  Object.defineProperty(globalThis.performance, "now", {
    configurable: true,
    value: () => now.value,
  });

  return timerWindow;
}

function restoreWindow(descriptor: PropertyDescriptor | undefined) {
  if (descriptor === undefined) {
    Reflect.deleteProperty(globalThis, "window");
  } else {
    Object.defineProperty(globalThis, "window", descriptor);
  }
}

function restorePerformanceNow() {
  if (originalPerformanceNow === undefined) {
    Reflect.deleteProperty(globalThis.performance, "now");
  } else {
    Object.defineProperty(
      globalThis.performance,
      "now",
      originalPerformanceNow,
    );
  }
}

function anchorWithRemaining(remainingMs: number): ClockAnchor {
  return {
    serverEpochAtAnchorMs: 10_000,
    monotonicAtAnchorMs: 1_000,
    requestStartedAtMonotonicMs: 900,
    expiresAtEpochMs: 10_000 + remainingMs,
  };
}

const { render } = createReactTestHarness();

function holdCountdownElement(clockAnchor: ClockAnchor) {
  const runtime = {
    checkout: { snapshot, clockAnchor },
    client: createCheckoutClient({
      baseUrl: "https://checkout.test",
      fetch: globalThis.fetch,
      monotonicNow: () => 1_000,
    }),
    context: {
      deviceId: "web_1",
      resumeToken: "secret",
      sessionId: snapshot.session.id,
      surface: "web",
    },
    isInteractive: true,
    realtimeStatus: "connected",
  } satisfies CheckoutScreenRuntime;

  return (
    <CheckoutScreenProvider value={runtime}>
      <HoldCountdown />
    </CheckoutScreenProvider>
  );
}

afterEach(() => {
  restoreWindow(originalWindow);
  restorePerformanceNow();
});

test("counts down from the hydrated monotonic clock anchor", async () => {
  const now = { value: 1_000 };
  const timerWindow = installClock(now);
  const renderer = await render(
    holdCountdownElement(anchorWithRemaining(65_000)),
  );

  expect(textContent(renderer.root.findByType("p"))).toContain(
    "Hold expires in 1:05",
  );

  now.value = 2_500;
  await act(async () => timerWindow.tick());

  expect(textContent(renderer.root.findByType("p"))).toContain(
    "Hold expires in 1:04",
  );

  await act(async () => renderer.unmount());
  expect(timerWindow.intervals.size).toBe(0);
});

test("renders zero without attempting hold recovery", async () => {
  const now = { value: 2_000 };
  installClock(now);
  const renderer = await render(holdCountdownElement(anchorWithRemaining(500)));

  expect(textContent(renderer.root.findByType("p"))).toContain(
    "Hold expires now",
  );
});
