import type { ApiError } from "@checkout/sdk/contracts";
import type { Context } from "hono";
import {
  CheckoutSessionExpired,
  CheckoutSessionNotFound,
  InvalidPriceAdjustment,
  InvalidResumeToken,
  ListingUnavailable,
  OfferVersionMismatch,
  PurchaseNotAllowed,
} from "../services/checkout/checkout.errors";

export interface HttpError extends ApiError {
  status: 400 | 401 | 404 | 409 | 410 | 500;
}

export function invalidRequest(): HttpError {
  return {
    status: 400,
    code: "INVALID_REQUEST",
    message: "The request is invalid.",
  };
}

export function invalidIdempotencyKey(): HttpError {
  return {
    status: 400,
    code: "INVALID_IDEMPOTENCY_KEY",
    message: "The idempotency key is required.",
  };
}

export function unauthorizedSession(): HttpError {
  return {
    status: 401,
    code: "UNAUTHORIZED_SESSION",
    message: "The checkout session credential is invalid.",
  };
}

export function toHttpError(error: unknown): HttpError {
  if (error instanceof InvalidResumeToken) {
    return unauthorizedSession();
  }
  if (error instanceof InvalidPriceAdjustment) {
    return {
      status: 400,
      code: "INVALID_PRICE_ADJUSTMENT",
      message: "The price change is invalid.",
    };
  }
  if (error instanceof CheckoutSessionNotFound) {
    return {
      status: 404,
      code: "CHECKOUT_SESSION_NOT_FOUND",
      message: "The checkout session was not found.",
    };
  }
  if (error instanceof ListingUnavailable) {
    return {
      status: 409,
      code: "LISTING_UNAVAILABLE",
      message: "The listing is no longer available.",
    };
  }
  if (error instanceof CheckoutSessionExpired) {
    return {
      status: 410,
      code: "CHECKOUT_SESSION_EXPIRED",
      message: "The inventory hold has expired.",
      snapshot: error.snapshot,
    };
  }
  if (error instanceof OfferVersionMismatch) {
    return {
      status: 409,
      code: "OFFER_VERSION_MISMATCH",
      message: "The offer has changed.",
      snapshot: error.snapshot,
    };
  }
  if (error instanceof PurchaseNotAllowed) {
    return {
      status: 409,
      code: "PURCHASE_NOT_ALLOWED",
      message: "The checkout cannot be purchased in its current state.",
      snapshot: error.snapshot,
    };
  }

  return {
    status: 500,
    code: "INTERNAL_SERVER_ERROR",
    message: "The server could not complete the request.",
  };
}

export function respondWithError(context: Context, response: HttpError) {
  const { status, ...body } = response;

  return context.json(body, status);
}
