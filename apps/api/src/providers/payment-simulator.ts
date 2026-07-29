import type { PaymentOutcome } from "@checkout/sdk/contracts";

export interface PaymentInput {
  sessionId: string;
  attemptId: string;
  amountCents: number;
  currency: "USD";
}

export interface DelayedPaymentSimulatorOptions {
  delayMs?: number;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

export class DelayedPaymentSimulator {
  private readonly outcomes = new Map<string, PaymentOutcome>();
  private readonly delayMs: number;

  constructor({ delayMs = 1_500 }: DelayedPaymentSimulatorOptions = {}) {
    this.delayMs = delayMs;
  }

  setNextOutcome(sessionId: string, outcome: PaymentOutcome): void {
    this.outcomes.set(sessionId, outcome);
  }

  async authorize(input: PaymentInput): Promise<PaymentOutcome> {
    const outcome = this.outcomes.get(input.sessionId) ?? "success";
    this.outcomes.delete(input.sessionId);
    await wait(this.delayMs);
    return outcome;
  }
}
