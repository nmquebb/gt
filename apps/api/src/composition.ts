import type { AppDependencies } from "./app";
import { SEEDED_LISTINGS } from "./fixtures";
import { BunIosSimulatorLauncher } from "./providers/ios-simulator-launcher";
import { InMemoryKeyedLock } from "./providers/keyed-lock";
import { CheckoutMemoryRepository } from "./providers/memory-checkout-repository";
import { DelayedPaymentSimulator } from "./providers/payment-simulator";
import { RealtimeHub } from "./providers/realtime-hub";
import { CheckoutService } from "./services/checkout/checkout.service";

export function createAppDependencies(): AppDependencies {
  const repository = new CheckoutMemoryRepository(SEEDED_LISTINGS);
  const locks = new InMemoryKeyedLock();
  const payment = new DelayedPaymentSimulator();
  const realtimeHub = new RealtimeHub();
  const checkoutService = new CheckoutService(
    repository,
    locks,
    payment,
    realtimeHub,
  );

  return {
    checkoutService,
    realtimeHub,
    paymentScenarios: payment,
    iosSimulatorLauncher: new BunIosSimulatorLauncher(),
  };
}
