import { describe, expect, test } from "bun:test";
import {
  CheckoutSessionUpdatedEventSchema,
  CheckoutSnapshotResponseSchema,
  ListingsResponseSchema,
} from "@checkout/sdk/contracts";
import { createApp } from "../src/app";
import { DEMO_EVENT, SEEDED_LISTINGS } from "../src/fixtures";
import { RealtimeHub } from "../src/providers/realtime-hub";
import { projectCheckout } from "../src/services/checkout/checkout.projection";
import { createApiTestHarness } from "./fixtures";

describe("public contracts", () => {
  test("the fixture is made of distinct single-seat listings", () => {
    const parsed = ListingsResponseSchema.parse({
      event: DEMO_EVENT,
      listings: SEEDED_LISTINGS,
    });

    expect(parsed.event.isDemo).toBe(true);
    expect(parsed.listings.length).toBeGreaterThanOrEqual(5);
    expect(new Set(parsed.listings.map((listing) => listing.id)).size).toBe(
      parsed.listings.length,
    );
    expect(
      parsed.listings.every(
        (listing) =>
          !("quantity" in listing) &&
          !("eventId" in listing) &&
          listing.seat.length > 0,
      ),
    ).toBe(true);
  });

  test("production REST and realtime serialization exclude internal session data", async () => {
    const harness = createApiTestHarness();
    const created = await harness.createCheckout();
    const stored = harness.repository.getSession(created.snapshot.session.id);
    if (!stored) {
      throw new Error("expected the created session to be persisted");
    }

    const secrets = {
      resumeToken: "secret-resume-token-sentinel",
      attemptId: "secret-payment-attempt-sentinel",
      observedClientDevice: "secret-observed-client-device-sentinel",
    } as const;
    const seeded = {
      ...stored,
      resumeToken: secrets.resumeToken,
      payment: {
        status: "pending" as const,
        attemptId: secrets.attemptId,
      },
      observedClients: [
        { surface: "mobile" as const, deviceId: secrets.observedClientDevice },
      ],
    };
    harness.repository.saveSession(seeded);

    const response = await createApp(harness.appDependencies).request(
      `/v1/checkout-sessions/${seeded.id}`,
      { headers: { authorization: `Bearer ${secrets.resumeToken}` } },
    );
    const restBytes = await response.text();

    const realtimeBytes: string[] = [];
    const hub = new RealtimeHub();
    hub.register(seeded.id, {
      send(data) {
        realtimeBytes.push(data);
      },
    });
    hub.publish({
      type: "checkout_session_updated",
      cause: "purchase_started",
      snapshot: projectCheckout(seeded, harness.clock.now()),
    });

    expect(response.status).toBe(200);
    expect(realtimeBytes).toHaveLength(1);
    for (const forbidden of [
      ...Object.values(secrets),
      "resumeToken",
      "attemptId",
      "observedClients",
    ]) {
      expect(restBytes).not.toContain(forbidden);
      expect(realtimeBytes[0]).not.toContain(forbidden);
    }

    CheckoutSnapshotResponseSchema.parse(JSON.parse(restBytes));
    CheckoutSessionUpdatedEventSchema.parse(JSON.parse(realtimeBytes[0] ?? ""));
  });
});
