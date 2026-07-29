import { Result } from "better-result";
import type { PaymentOutcome } from "@checkout/sdk/contracts";
import type { IosSimulatorLauncher } from "../src/providers/ios-simulator-launcher";
import { InMemoryKeyedLock } from "../src/providers/keyed-lock";
import { CheckoutMemoryRepository } from "../src/providers/memory-checkout-repository";
import {
  DelayedPaymentSimulator,
  type PaymentAuthorization,
  type PaymentInput,
} from "../src/providers/payment-simulator";
import { RealtimeHub } from "../src/providers/realtime-hub";
import { CheckoutService } from "../src/services/checkout/checkout.service";
import type { AppDependencies } from "../src/app";
import { SEEDED_LISTINGS } from "../src/fixtures";

class TestClock {
  private current = new Date("2026-07-27T17:00:00.000Z");

  now(): Date {
    return new Date(this.current);
  }

  advance(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }
}

class TrackingPaymentSimulator extends DelayedPaymentSimulator {
  constructor(
    private readonly outcomesSeen: Array<{
      sessionId: string;
      outcome: PaymentOutcome;
    }>,
  ) {
    super({ delayMs: 0 });
  }

  override setNextOutcome(sessionId: string, outcome: PaymentOutcome): void {
    this.outcomesSeen.push({ sessionId, outcome });
    super.setNextOutcome(sessionId, outcome);
  }
}

class ControlledPaymentSimulator extends TrackingPaymentSimulator {
  private authorizationStarted = Promise.withResolvers<void>();
  private authorization = Promise.withResolvers<PaymentOutcome>();

  override async authorize(
    _input: PaymentInput,
  ): Promise<PaymentAuthorization> {
    this.authorizationStarted.resolve();
    const outcome = await this.authorization.promise;
    this.authorizationStarted = Promise.withResolvers<void>();
    this.authorization = Promise.withResolvers<PaymentOutcome>();

    return outcome === "success"
      ? Result.ok(undefined)
      : Result.err("failure" as const);
  }

  waitUntilAuthorizationStarts(): Promise<void> {
    return this.authorizationStarted.promise;
  }

  resolveSuccess(): void {
    this.authorization.resolve("success");
  }
}

interface CreateApiTestHarnessOptions {
  controlledPayment?: boolean;
}

export function createApiTestHarness({
  controlledPayment = false,
}: CreateApiTestHarnessOptions = {}) {
  const repository = new CheckoutMemoryRepository(SEEDED_LISTINGS);
  const locks = new InMemoryKeyedLock();
  const clock = new TestClock();
  const nextPaymentOutcomes: Array<{
    sessionId: string;
    outcome: PaymentOutcome;
  }> = [];
  const payment = controlledPayment
    ? new ControlledPaymentSimulator(nextPaymentOutcomes)
    : new TrackingPaymentSimulator(nextPaymentOutcomes);
  const realtimeHub = new RealtimeHub();
  const checkout = new CheckoutService(
    repository,
    locks,
    payment,
    realtimeHub,
    () => clock.now(),
  );
  const openedDeepLinks: string[] = [];
  const iosSimulatorLauncher: IosSimulatorLauncher = {
    open(deepLink) {
      openedDeepLinks.push(deepLink);

      return Promise.resolve(Result.ok(undefined));
    },
  };
  const activity = {
    list(sessionId: string) {
      return repository.listActivity(sessionId);
    },
  };

  async function createCheckout() {
    const result = await checkout.createSession({
      listingId: "lst_101_a_1",
      surface: "web",
      deviceId: "web_1",
    });
    if (Result.isError(result)) {
      throw new Error("test fixture could not create checkout");
    }

    return result.value;
  }

  const appDependencies: AppDependencies = {
    checkoutService: checkout,
    realtimeHub,
    paymentScenarios: payment,
    iosSimulatorLauncher,
  };

  return {
    repository,
    checkout,
    locks,
    clock,
    activity,
    payment:
      payment instanceof ControlledPaymentSimulator ? payment : undefined,
    paymentScenarios: payment,
    createCheckout,
    appDependencies,
    nextPaymentOutcomes,
    openedDeepLinks,
  };
}
