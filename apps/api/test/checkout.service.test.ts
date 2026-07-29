import { expect, test } from "bun:test";
import { Result, type Result as ResultType } from "better-result";
import { InMemoryKeyedLock } from "../src/providers/keyed-lock";
import { CheckoutMemoryRepository } from "../src/providers/memory-checkout-repository";
import { DelayedPaymentSimulator } from "../src/providers/payment-simulator";
import { RealtimeHub } from "../src/providers/realtime-hub";
import { CheckoutService } from "../src/services/checkout/checkout.service";
import { SEEDED_LISTINGS } from "../src/fixtures";

function unwrap<T>(result: ResultType<T, unknown>): T {
  if (Result.isError(result)) {
    throw new Error("expected success");
  }

  return result.value;
}

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
  return unwrap(
    await service.createSession({
      listingId: "lst_101_a_1",
      surface: "web",
      deviceId: "web_1",
    }),
  );
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

  expect(Result.isOk(left) && left.value.status).toBe("ready");
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

  expect(Result.isOk(left) && left.value.status).toBe("abandoned");
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
  const mobile = unwrap(await service.resume(mobileContext));
  const duplicate = unwrap(await service.resume(mobileContext));

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

  const repriced = unwrap(
    await service.reprice({ sessionId, increaseCents: 2_000 }),
  );
  const accepted = unwrap(
    await service.acceptOffer({
      sessionId,
      resumeToken: created.resumeToken,
      surface: "mobile",
      deviceId: "mobile_1",
      offerVersion: 2,
    }),
  );

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

test("expires from authoritative server time", async () => {
  const { repository, service, setNow } = setup();
  const created = await createCheckout(service);
  const sessionId = created.snapshot.session.id;
  setNow("2026-07-29T17:01:30.001Z");

  const expired = await service.getSession({
    sessionId,
    resumeToken: created.resumeToken,
  });

  expect(Result.isOk(expired) && expired.value.status).toBe("expired");
  expect(repository.getSession(sessionId)?.phase).toBe("expired");
  expect(repository.getListing("lst_101_a_1")?.status).toBe("available");
});

test("fails then retries a payment", async () => {
  const { payment, repository, service } = setup();
  const created = await createCheckout(service);
  const sessionId = created.snapshot.session.id;
  payment.setNextOutcome(sessionId, "failure");

  const failed = unwrap(
    await service.purchase({
      sessionId,
      resumeToken: created.resumeToken,
      idempotencyKey: "web-click",
      surface: "web",
      deviceId: "web_1",
    }),
  );
  const completed = unwrap(
    await service.purchase({
      sessionId,
      resumeToken: created.resumeToken,
      idempotencyKey: "mobile-click",
      surface: "mobile",
      deviceId: "mobile_1",
    }),
  );

  expect(failed.disposition).toBe("failed");
  expect(failed.snapshot.status).toBe("purchase_failed");
  expect(completed.disposition).toBe("completed");
  expect(completed.snapshot.status).toBe("completed");
  expect(repository.listAttempts(sessionId)).toHaveLength(2);
  expect(repository.listOrders(sessionId)).toHaveLength(1);
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

  expect(Result.isOk(web)).toBe(true);
  expect(Result.isOk(mobile)).toBe(true);
  expect(repository.listAttempts(sessionId)).toHaveLength(1);
  expect(repository.listOrders(sessionId)).toHaveLength(1);
});
