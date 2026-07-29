import { expect, test } from "bun:test";
import { DelayedPaymentSimulator } from "../src/providers/payment-simulator";

const payment = {
  sessionId: "chk_1",
  attemptId: "pay_1",
  amountCents: 12_500,
  currency: "USD" as const,
};

test("a scenario changed during authorization applies to the next attempt", async () => {
  const simulator = new DelayedPaymentSimulator({ delayMs: 0 });
  simulator.setNextOutcome(payment.sessionId, "success");

  const firstAuthorization = simulator.authorize(payment);
  simulator.setNextOutcome(payment.sessionId, "failure");

  expect(await firstAuthorization).toBe("success");
  expect(await simulator.authorize(payment)).toBe("failure");
});
