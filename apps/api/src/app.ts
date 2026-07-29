import { cors } from "hono/cors";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  invalidRequest,
  respondWithError,
  toHttpError,
} from "./http/error-response";
import { createCheckoutRoutes } from "./routes/checkout.routes";
import { createDevRoutes } from "./routes/dev.routes";
import { createHealthRoutes } from "./routes/health.routes";
import { createListingRoutes } from "./routes/listing.routes";
import { createRealtimeRoutes } from "./routes/realtime.routes";
import type { IosSimulatorLauncher } from "./providers/ios-simulator-launcher";
import type { DelayedPaymentSimulator } from "./providers/payment-simulator";
import type { RealtimeHub } from "./providers/realtime-hub";
import type { CheckoutService } from "./services/checkout/checkout.service";

export interface AppDependencies {
  checkoutService: CheckoutService;
  webBaseUrl: string;
  realtimeHub: RealtimeHub;
  paymentScenarios: DelayedPaymentSimulator;
  iosSimulatorLauncher: IosSimulatorLauncher;
}

export type AppEnv = {};

const REST_RESOURCE_PATHS = [
  "/v1/health",
  "/v1/listings",
  "/v1/checkout-sessions",
  "/v1/checkout-sessions/:sessionId",
  "/v1/checkout-sessions/:sessionId/clients/:deviceId",
  "/v1/checkout-sessions/:sessionId/offer-acceptance",
  "/v1/checkout-sessions/:sessionId/purchase",
  "/v1/dev/*",
] as const;

function localWebOrigins(configuredOrigin: string) {
  const url = new URL(configuredOrigin);
  const origins = new Set([configuredOrigin]);

  if (url.hostname === "127.0.0.1") {
    origins.add(configuredOrigin.replace("127.0.0.1", "localhost"));
  }
  if (url.hostname === "localhost") {
    origins.add(configuredOrigin.replace("localhost", "127.0.0.1"));
  }

  return (origin: string) => (origins.has(origin) ? origin : undefined);
}

function restResourceNotFound() {
  return {
    status: 404 as const,
    code: "REST_RESOURCE_NOT_FOUND",
    message: "The REST resource was not found.",
  };
}

function appError(error: Error) {
  return error instanceof HTTPException && error.status === 400
    ? invalidRequest()
    : toHttpError(error);
}

export function createRestApp(dependencies: AppDependencies) {
  const app = new Hono<AppEnv>();
  const restCors = cors({
    origin: localWebOrigins(dependencies.webBaseUrl),
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "Idempotency-Key"],
    credentials: false,
  });

  for (const path of REST_RESOURCE_PATHS) {
    app.use(path, restCors);
  }

  return app
    .route("/v1", createHealthRoutes())
    .route("/v1", createListingRoutes(dependencies))
    .route("/v1", createCheckoutRoutes(dependencies))
    .route("/v1", createDevRoutes(dependencies))
    .notFound((context) => respondWithError(context, restResourceNotFound()))
    .onError((error, context) => respondWithError(context, appError(error)));
}

export function createApp(dependencies: AppDependencies) {
  return new Hono<AppEnv>()
    .route("/", createRestApp(dependencies))
    .route("/v1", createRealtimeRoutes(dependencies))
    .notFound((context) => respondWithError(context, restResourceNotFound()))
    .onError((error, context) => respondWithError(context, appError(error)));
}

export type AppType = ReturnType<typeof createApp>;
