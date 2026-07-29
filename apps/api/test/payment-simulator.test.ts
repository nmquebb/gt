import { expect, test } from "bun:test";
import { Result } from "better-result";
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

  expect(Result.isOk(await firstAuthorization)).toBe(true);
  expect(Result.isError(await simulator.authorize(payment))).toBe(true);
});
