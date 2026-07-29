import { expect, test } from "bun:test";
import { InMemoryKeyedLock } from "../src/providers/keyed-lock";
import { CheckoutMemoryRepository } from "../src/providers/memory-checkout-repository";
import { DelayedPaymentSimulator } from "../src/providers/payment-simulator";
import { RealtimeHub } from "../src/providers/realtime-hub";
import {
  CheckoutSessionExpired,
  InvalidResumeToken,
  ListingUnavailable,
  OfferVersionMismatch,
} from "../src/services/checkout/checkout.errors";
import { CheckoutService } from "../src/services/checkout/checkout.service";
import { SEEDED_LISTINGS } from "../src/fixtures";

function setup() {
  let now = new Date("2026-07-29T17:00:00.000Z");
  const repository = new CheckoutMemoryRepository(SEEDED_LISTINGS);
  const locks = new InMemoryKeyedLock();
  const payment = new DelayedPaymentSimulator({ delayMs: 0 });
  const realtime = new RealtimeHub();
  const service = new CheckoutService(
    repository,
    locks,
    payment,
    realtime,
    () => new Date(now),
  );

  return {
    payment,
    realtime,
    repository,
    service,
    setNow: (value: string) => {
      now = new Date(value);
    },
  };
}

async function createCheckout(service: CheckoutService) {
  return service.createSession({
    listingId: "lst_101_a_1",
    surface: "web",
    deviceId: "web_1",
  });
}

function createSocket() {
  return {
    send(): void {},
  };
}

test("web leave keeps checkout active while mobile realtime is connected", async () => {
  const { realtime, repository, service } = setup();
  const created = await createCheckout(service);
  const sessionId = created.snapshot.session.id;
  const webContext = {
    sessionId,
    resumeToken: created.resumeToken,
    surface: "web" as const,
    deviceId: "web_1",
  };
  realtime.register(sessionId, createSocket());
  realtime.register(sessionId, createSocket());

  const left = await service.leave(webContext);

  expect(left.status).toBe("ready");
  expect(repository.getListing("lst_101_a_1")?.status).toBe("held");
});

test("last realtime client leave abandons checkout", async () => {
  const { realtime, repository, service } = setup();
  const created = await createCheckout(service);
  const sessionId = created.snapshot.session.id;
  const webContext = {
    sessionId,
    resumeToken: created.resumeToken,
    surface: "web" as const,
    deviceId: "web_1",
  };
  realtime.register(sessionId, createSocket());

  const left = await service.leave(webContext);

  expect(left.status).toBe("abandoned");
  expect(repository.getListing("lst_101_a_1")?.status).toBe("available");
});

test("resume records a new surface and device only once", async () => {
  const { repository, service } = setup();
  const created = await createCheckout(service);
  const sessionId = created.snapshot.session.id;

  const mobileContext = {
    sessionId,
    resumeToken: created.resumeToken,
    surface: "mobile" as const,
    deviceId: "mobile_1",
  };
  const mobile = await service.resume(mobileContext);
  const duplicate = await service.resume(mobileContext);

  expect(mobile.session.id).toBe(sessionId);
  expect(duplicate.session.revision).toBe(mobile.session.revision);
  expect(repository.getSession(sessionId)?.observedClients).toEqual([
    { surface: "web", deviceId: "web_1" },
    { surface: "mobile", deviceId: "mobile_1" },
  ]);
  expect(
    repository
      .listActivity(sessionId)
      .filter((entry) => entry.type === "checkout_session_resumed"),
  ).toEqual([
    expect.objectContaining({
      sessionId,
      surface: "mobile",
      deviceId: "mobile_1",
    }),
  ]);
});

test("reprices and accepts the current offer", async () => {
  const { service } = setup();
  const created = await createCheckout(service);
  const sessionId = created.snapshot.session.id;

  const repriced = await service.reprice({
    sessionId,
    resumeToken: created.resumeToken,
    increaseCents: 2_000,
  });
  expect(
    service.acceptOffer({
      sessionId,
      resumeToken: created.resumeToken,
      surface: "mobile",
      deviceId: "mobile_1",
      offerVersion: 1,
    }),
  ).rejects.toBeInstanceOf(OfferVersionMismatch);
  const accepted = await service.acceptOffer({
    sessionId,
    resumeToken: created.resumeToken,
    surface: "mobile",
    deviceId: "mobile_1",
    offerVersion: 2,
  });

  expect(repriced.status).toBe("offer_review_required");
  expect(repriced.session.offer).toEqual({
    currency: "USD",
    currentVersion: 2,
    currentTotalCents: 14_500,
    acceptedVersion: 1,
    acceptedTotalCents: 12_500,
  });
  expect(accepted.status).toBe("ready");
  expect(accepted.session.offer.acceptedVersion).toBe(2);
  expect(accepted.session.offer.acceptedTotalCents).toBe(14_500);
});

test("expires from authoritative server time when rejecting a command", async () => {
  const { realtime, repository, service, setNow } = setup();
  const created = await createCheckout(service);
  const sessionId = created.snapshot.session.id;
  const messages: string[] = [];
  realtime.register(sessionId, {
    send(message): void {
      messages.push(String(message));
    },
  });
  setNow("2026-07-29T17:01:30.001Z");

  const rejected = service.acceptOffer({
    sessionId,
    resumeToken: created.resumeToken,
    surface: "web",
    deviceId: "web_1",
    offerVersion: 1,
  });

  expect(rejected).rejects.toBeInstanceOf(CheckoutSessionExpired);
  expect(repository.getSession(sessionId)?.phase).toBe("expired");
  expect(repository.getListing("lst_101_a_1")?.status).toBe("available");
  expect(messages).toHaveLength(1);
  expect(JSON.parse(messages[0] ?? "{}")).toMatchObject({
    cause: "expired",
    snapshot: { status: "expired" },
  });
});

test("publishes persisted updates through listing-unavailable errors", async () => {
  const { realtime, repository, service, setNow } = setup();
  const created = await createCheckout(service);
  const sessionId = created.snapshot.session.id;
  const messages: string[] = [];
  realtime.register(sessionId, {
    send(message): void {
      messages.push(String(message));
    },
  });
  setNow("2026-07-29T17:01:30.001Z");

  const failure: unknown = await service
    .createSession({
      listingId: "lst_missing",
      surface: "web",
      deviceId: "web_1",
    })
    .catch((error: unknown) => error);

  expect(failure).toBeInstanceOf(ListingUnavailable);
  if (!(failure instanceof ListingUnavailable)) {
    throw failure;
  }
  expect(failure.updates).toEqual([
    {
      cause: "expired",
      snapshot: expect.objectContaining({ status: "expired" }),
    },
  ]);
  expect(repository.getSession(sessionId)?.phase).toBe("expired");
  expect(messages).toHaveLength(1);
  expect(JSON.parse(messages[0] ?? "{}")).toMatchObject({
    cause: "expired",
    snapshot: { status: "expired" },
  });
});

test("fails then retries a payment", async () => {
  const { payment, repository, service } = setup();
  const created = await createCheckout(service);
  const sessionId = created.snapshot.session.id;
  payment.setNextOutcome(sessionId, "failure");

  const failed = await service.purchase({
    sessionId,
    resumeToken: created.resumeToken,
    idempotencyKey: "web-click",
    surface: "web",
    deviceId: "web_1",
  });
  const completed = await service.purchase({
    sessionId,
    resumeToken: created.resumeToken,
    idempotencyKey: "mobile-click",
    surface: "mobile",
    deviceId: "mobile_1",
  });

  expect(failed.disposition).toBe("failed");
  expect(failed.snapshot.status).toBe("purchase_failed");
  expect(completed.disposition).toBe("completed");
  expect(completed.snapshot.status).toBe("completed");
  expect(repository.listAttempts(sessionId)).toHaveLength(2);
  expect(repository.listOrders(sessionId)).toHaveLength(1);
});

test("invalid developer credentials cannot configure a payment outcome", async () => {
  const { payment, service } = setup();
  const created = await createCheckout(service);
  const sessionId = created.snapshot.session.id;

  // oxlint-disable-next-line typescript/await-thenable -- Bun requires awaiting async matchers despite their non-thenable type.
  await expect(
    service.setNextPaymentOutcome({
      sessionId,
      resumeToken: "wrong-token",
      outcome: "failure",
    }),
  ).rejects.toBeInstanceOf(InvalidResumeToken);
  expect(
    await payment.authorize({
      sessionId,
      attemptId: "attempt_after_rejection",
      amountCents: 12_500,
      currency: "USD",
    }),
  ).toBe("success");
});

test("concurrent purchases create one attempt and one order", async () => {
  const { repository, service } = setup();
  const created = await createCheckout(service);
  const sessionId = created.snapshot.session.id;

  const [web, mobile] = await Promise.all([
    service.purchase({
      sessionId,
      resumeToken: created.resumeToken,
      idempotencyKey: "web-click",
      surface: "web",
      deviceId: "web_1",
    }),
    service.purchase({
      sessionId,
      resumeToken: created.resumeToken,
      idempotencyKey: "mobile-click",
      surface: "mobile",
      deviceId: "mobile_1",
    }),
  ]);

  expect(web.disposition).toBe("completed");
  expect(mobile.disposition).toBeOneOf(["pending", "completed"]);
  expect(repository.listAttempts(sessionId)).toHaveLength(1);
  expect(repository.listOrders(sessionId)).toHaveLength(1);
});
