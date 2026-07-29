import { z } from "zod";
import {
  ActivityEntrySchema,
  ApiErrorSchema,
  CheckoutSnapshotResponseSchema,
  CreatedCheckoutResponseSchema,
  ListingsResponseSchema,
  PurchaseResponseSchema,
  type CheckoutSnapshot,
  type CreateCheckoutSessionRequest,
  type PaymentOutcome,
  type Surface,
} from "../contracts";
import { createClockAnchor } from "./clock-anchor";
import { CheckoutClientError } from "./client.errors";

export interface CheckoutClientContext {
  readonly sessionId: string;
  readonly resumeToken: string;
  readonly surface: Surface;
  readonly deviceId: string;
}

export type CreateCheckoutInput = CreateCheckoutSessionRequest;

export interface RealtimeSocketEvent {
  data?: unknown;
}

export interface RealtimeSocket {
  addEventListener(
    type: "open" | "message" | "close" | "error",
    listener: (event: RealtimeSocketEvent) => void,
  ): void;
  close(): void;
}

export interface CheckoutClientOptions {
  baseUrl: string;
  fetch: FetchLike;
  monotonicNow: () => number;
  webSocket?: (url: string) => RealtimeSocket;
}

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

interface RequestTiming {
  requestStartedAtMs: number;
  responseReceivedAtMs?: number;
}

function authHeaders(context: CheckoutClientContext): Record<string, string> {
  return {
    authorization: `Bearer ${context.resumeToken}`,
  };
}

function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, "")}/v1${path}`;
}

function jsonInit(
  method: "POST" | "PUT" | "DELETE",
  body: unknown,
  headers: Record<string, string> = {},
): RequestInit {
  return {
    method,
    headers: {
      ...headers,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  };
}

export function createCheckoutClient({
  baseUrl,
  fetch,
  monotonicNow,
  webSocket,
}: CheckoutClientOptions) {
  function clockAnchor(
    snapshot: CheckoutSnapshot,
    timing: Required<RequestTiming>,
  ) {
    return createClockAnchor({
      serverNow: snapshot.serverNow,
      expiresAt: snapshot.session.inventoryHold.expiresAt,
      requestStartedAtMs: timing.requestStartedAtMs,
      responseReceivedAtMs: timing.responseReceivedAtMs,
    });
  }

  function parseApiError(
    body: unknown,
    operation: string,
    timing: Required<RequestTiming>,
  ): CheckoutClientError {
    const parsed = ApiErrorSchema.safeParse(body);
    if (!parsed.success) {
      return new CheckoutClientError(
        "INVALID_SERVER_RESPONSE",
        `${operation} returned an invalid error response.`,
      );
    }

    return new CheckoutClientError(
      parsed.data.code,
      parsed.data.message,
      parsed.data.snapshot,
      parsed.data.snapshot === undefined
        ? undefined
        : clockAnchor(parsed.data.snapshot, timing),
    );
  }

  async function request<T>(
    schema: z.ZodType<T>,
    operation: string,
    send: () => Promise<Response>,
    timing: RequestTiming = { requestStartedAtMs: monotonicNow() },
  ): Promise<T> {
    let response: Response;
    try {
      response = await send();
    } catch {
      throw new CheckoutClientError(
        "NETWORK_UNAVAILABLE",
        `${operation} could not reach the API.`,
      );
    }
    timing.responseReceivedAtMs = monotonicNow();

    const body = await response.json().catch(() => {
      throw new CheckoutClientError(
        "INVALID_SERVER_RESPONSE",
        `${operation} returned invalid JSON.`,
      );
    });

    if (!response.ok) {
      throw parseApiError(body, operation, timing as Required<RequestTiming>);
    }

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new CheckoutClientError(
        "INVALID_SERVER_RESPONSE",
        `${operation} returned an invalid response.`,
      );
    }

    return parsed.data;
  }

  async function checkoutCommand<T extends { snapshot: CheckoutSnapshot }>(
    schema: z.ZodType<T>,
    operation: string,
    send: () => Promise<Response>,
  ) {
    const timing: RequestTiming = {
      requestStartedAtMs: monotonicNow(),
    };
    const data = await request(schema, operation, send, timing);

    return {
      ...data,
      snapshot: data.snapshot,
      clockAnchor: clockAnchor(
        data.snapshot,
        timing as Required<RequestTiming>,
      ),
    };
  }

  return {
    listListings: () =>
      request(ListingsResponseSchema, "list_listings", () =>
        fetch(endpoint(baseUrl, "/listings")),
      ),
    createCheckout: (input: CreateCheckoutInput) =>
      checkoutCommand(CreatedCheckoutResponseSchema, "create_checkout", () =>
        fetch(endpoint(baseUrl, "/checkout-sessions"), jsonInit("POST", input)),
      ),
    getCheckout: (context: CheckoutClientContext) =>
      checkoutCommand(CheckoutSnapshotResponseSchema, "get_checkout", () =>
        fetch(endpoint(baseUrl, `/checkout-sessions/${context.sessionId}`), {
          headers: authHeaders(context),
        }),
      ),
    leave: (context: CheckoutClientContext) =>
      checkoutCommand(CheckoutSnapshotResponseSchema, "leave_checkout", () =>
        fetch(
          endpoint(baseUrl, `/checkout-sessions/${context.sessionId}`),
          jsonInit(
            "DELETE",
            {
              surface: context.surface,
              deviceId: context.deviceId,
            },
            authHeaders(context),
          ),
        ),
      ),
    resume: (context: CheckoutClientContext) =>
      checkoutCommand(CheckoutSnapshotResponseSchema, "resume_checkout", () =>
        fetch(
          endpoint(
            baseUrl,
            `/checkout-sessions/${context.sessionId}/clients/${context.deviceId}`,
          ),
          jsonInit("PUT", { surface: context.surface }, authHeaders(context)),
        ),
      ),
    acceptOffer: (context: CheckoutClientContext, offerVersion: number) =>
      checkoutCommand(CheckoutSnapshotResponseSchema, "accept_offer", () =>
        fetch(
          endpoint(
            baseUrl,
            `/checkout-sessions/${context.sessionId}/offer-acceptance`,
          ),
          jsonInit(
            "PUT",
            {
              offerVersion,
              surface: context.surface,
              deviceId: context.deviceId,
            },
            authHeaders(context),
          ),
        ),
      ),
    purchase: (context: CheckoutClientContext, idempotencyKey: string) =>
      checkoutCommand(PurchaseResponseSchema, "purchase", () =>
        fetch(
          endpoint(baseUrl, `/checkout-sessions/${context.sessionId}/purchase`),
          jsonInit(
            "POST",
            { surface: context.surface, deviceId: context.deviceId },
            { ...authHeaders(context), "idempotency-key": idempotencyKey },
          ),
        ),
      ),
    activity: (context: CheckoutClientContext) =>
      request(z.array(ActivityEntrySchema), "checkout_activity", () =>
        fetch(
          endpoint(
            baseUrl,
            `/dev/checkout-sessions/${context.sessionId}/activity`,
          ),
          { headers: authHeaders(context) },
        ),
      ),
    reprice: (context: CheckoutClientContext, increaseCents?: number) =>
      checkoutCommand(CheckoutSnapshotResponseSchema, "reprice_checkout", () =>
        fetch(
          endpoint(
            baseUrl,
            `/dev/checkout-sessions/${context.sessionId}/reprice`,
          ),
          jsonInit(
            "POST",
            increaseCents === undefined ? {} : { increaseCents },
            authHeaders(context),
          ),
        ),
      ),
    expire: (context: CheckoutClientContext) =>
      checkoutCommand(CheckoutSnapshotResponseSchema, "expire_checkout", () =>
        fetch(
          endpoint(
            baseUrl,
            `/dev/checkout-sessions/${context.sessionId}/expire`,
          ),
          { method: "POST", headers: authHeaders(context) },
        ),
      ),
    setNextPaymentOutcome: (
      context: CheckoutClientContext,
      outcome: PaymentOutcome,
    ) =>
      request(z.null(), "set_next_payment_outcome", () =>
        fetch(
          endpoint(
            baseUrl,
            `/dev/checkout-sessions/${context.sessionId}/next-payment-outcome`,
          ),
          jsonInit("PUT", { outcome }, authHeaders(context)),
        ),
      ).then(() => undefined),
    openIosSimulator: (context: CheckoutClientContext) =>
      request(z.null(), "open_ios_simulator", () =>
        fetch(
          endpoint(
            baseUrl,
            `/dev/checkout-sessions/${context.sessionId}/open-ios-simulator`,
          ),
          { method: "POST", headers: authHeaders(context) },
        ),
      ).then(() => undefined),
    openEvents: (context: CheckoutClientContext): RealtimeSocket => {
      try {
        const url = new URL(
          endpoint(
            baseUrl,
            `/checkout-sessions/${encodeURIComponent(context.sessionId)}/events`,
          ),
        );
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
        url.searchParams.set("token", context.resumeToken);

        const serializedUrl = url.toString();

        return webSocket
          ? webSocket(serializedUrl)
          : new WebSocket(serializedUrl);
      } catch {
        throw new CheckoutClientError(
          "NETWORK_UNAVAILABLE",
          "checkout_events could not reach the API.",
        );
      }
    },
  };
}

export type CheckoutClient = ReturnType<typeof createCheckoutClient>;
export type CheckoutCommandResult = Awaited<
  ReturnType<CheckoutClient["getCheckout"]>
>;
export type CreatedCheckoutClientResult = Awaited<
  ReturnType<CheckoutClient["createCheckout"]>
>;
export type PurchaseClientResult = Awaited<
  ReturnType<CheckoutClient["purchase"]>
>;
