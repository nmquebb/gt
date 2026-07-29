import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type Page,
} from "@playwright/test";
import {
  ActivityEntrySchema,
  CheckoutSessionUpdatedEventSchema,
  CheckoutSnapshotSchema,
  ListingsResponseSchema,
  PurchaseResponseSchema,
} from "@checkout/sdk/contracts";
import type { z } from "zod";

const apiUrl = "http://127.0.0.1:3000";

async function decode<T>(
  response: APIResponse,
  schema: z.ZodType<T>,
): Promise<T> {
  expect(response.ok(), `${response.url()} returned ${response.status()}`).toBe(
    true,
  );
  const parsed = schema.safeParse(await response.json());
  expect(parsed.success, `${response.url()} did not match its contract`).toBe(
    true,
  );

  return parsed.success ? parsed.data : (undefined as T);
}

async function firstAvailableListing(request: APIRequestContext) {
  const response = await request.get(`${apiUrl}/v1/listings`);
  const listings = await decode(response, ListingsResponseSchema);
  const listing = listings.listings.find(
    (candidate) => candidate.status === "available",
  );
  expect(listing).toBeDefined();

  return listing!;
}

async function buyListing(
  page: Page,
  listing: { section: string; row: string; seat: string },
) {
  const label = `Section ${listing.section} · Row ${listing.row} · Seat ${listing.seat}`;
  const listingCard = page.getByText(label, { exact: true }).locator("../..");
  await listingCard.getByRole("button", { name: "Buy now" }).click();
  await expect(page).toHaveURL(/\/checkout\/chk_/);
}

async function openMobileSocket(sessionId: string, token: string) {
  const socket = new WebSocket(
    `${apiUrl.replace(/^http/, "ws")}/v1/checkout-sessions/${sessionId}/events?token=${encodeURIComponent(token)}`,
  );

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Mobile realtime connection timed out")),
      5_000,
    );
    socket.addEventListener(
      "message",
      (event) => {
        const parsed = CheckoutSessionUpdatedEventSchema.safeParse(
          JSON.parse(String(event.data)) as unknown,
        );
        if (parsed.success && parsed.data.cause === "initial_sync") {
          clearTimeout(timer);
          resolve();
        }
      },
      { once: true },
    );
    socket.addEventListener(
      "error",
      () => {
        clearTimeout(timer);
        reject(new Error("Mobile realtime connection failed"));
      },
      { once: true },
    );
  });

  return socket;
}

test("continues one checkout across the prototype workflows", async ({
  page,
  request,
}) => {
  const listing = await firstAvailableListing(request);
  await page.goto("/");
  await buyListing(page, listing);

  const checkoutUrl = new URL(page.url());
  const sessionId = checkoutUrl.pathname.split("/").at(-1);
  const token = checkoutUrl.searchParams.get("token");
  expect(sessionId).toBeDefined();
  expect(token).toBeTruthy();
  if (sessionId === undefined || token === null) {
    return;
  }

  const auth = { authorization: `Bearer ${token}` };
  const mobileSocket = await openMobileSocket(sessionId, token);

  try {
    const resumed = await request.put(
      `${apiUrl}/v1/checkout-sessions/${sessionId}/clients/mobile_e2e`,
      {
        headers: auth,
        data: { surface: "mobile" },
      },
    );
    await decode(resumed, CheckoutSnapshotSchema);

    await page.getByRole("button", { name: "Back to listings" }).click();
    await expect(page).toHaveURL("/");

    const afterWebLeave = await request.get(
      `${apiUrl}/v1/checkout-sessions/${sessionId}`,
      { headers: auth },
    );
    const readySnapshot = await decode(
      afterWebLeave,
      CheckoutSnapshotSchema,
    );
    expect(readySnapshot.status).toBe("ready");

    await page.goto(checkoutUrl.toString());
    await expect(page.getByText("Live updates connected")).toBeVisible();
    await page.locator("summary").filter({ hasText: "Dev" }).click();
    await page.getByRole("button", { name: "Change price" }).click();
    await expect(
      page.getByRole("button", { name: "Accept new price" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Accept new price" }).click();
    await expect(
      page.getByRole("button", { name: "Accept new price" }),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Purchase" })).toBeVisible();

    const failureScenario = page.getByRole("button", {
      name: "Next payment fails",
    });
    await failureScenario.click();
    await expect(failureScenario).toHaveAttribute("aria-pressed", "true");
    const failedPurchase = await request.post(
      `${apiUrl}/v1/checkout-sessions/${sessionId}/purchase`,
      {
        headers: {
          ...auth,
          "idempotency-key": "mobile purchase click",
        },
        data: { surface: "mobile", deviceId: "mobile_e2e" },
      },
    );
    const failed = await decode(failedPurchase, PurchaseResponseSchema);
    expect(failed.disposition).toBe("failed");
    await expect(page.getByText("Payment was not completed")).toBeVisible();

    const successScenario = page.getByRole("button", {
      name: "Next payment succeeds",
    });
    await successScenario.click();
    await expect(successScenario).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Retry purchase" }).click();
    await expect(page.getByText("You’re going")).toBeVisible();
    await expect(page.getByText("Your order is confirmed.")).toBeVisible();

    const completedResponse = await request.get(
      `${apiUrl}/v1/checkout-sessions/${sessionId}`,
      { headers: auth },
    );
    const completed = await decode(
      completedResponse,
      CheckoutSnapshotSchema,
    );
    expect(completed.session.order?.id).toMatch(/^ord_/);

    const activityResponse = await request.get(
      `${apiUrl}/v1/dev/checkout-sessions/${sessionId}/activity`,
      { headers: auth },
    );
    const activity = await decode(
      activityResponse,
      ActivityEntrySchema.array(),
    );
    const activityTypes = activity.map((entry) => entry.type);
    expect(activityTypes).toEqual(
      expect.arrayContaining([
        "checkout_session_resumed",
        "price_changed",
        "price_change_accepted",
        "purchase_failed",
        "order_completed",
      ]),
    );
  } finally {
    mobileSocket.close();
  }
});
