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
import { createRealtimeRoutes } from "./routes/realtime.routes";
import type { IosSimulatorLauncher } from "./providers/ios-simulator-launcher";
import type { RealtimeHub } from "./providers/realtime-hub";
import type { CheckoutService } from "./services/checkout/checkout.service";

export interface AppDependencies {
  checkoutService: CheckoutService;
  realtimeHub: RealtimeHub;
  iosSimulatorLauncher: IosSimulatorLauncher;
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
  return new Hono()
    .use("*", cors())
    .get("/v1/health", (context) => context.json({ status: "ok" }))
    .get("/v1/listings", async (context) =>
      context.json(await dependencies.checkoutService.listListings()),
    )
    .route("/v1", createCheckoutRoutes(dependencies))
    .route("/v1", createDevRoutes(dependencies))
    .notFound((context) => respondWithError(context, restResourceNotFound()))
    .onError((error, context) => respondWithError(context, appError(error)));
}

export function createApp(dependencies: AppDependencies) {
  return new Hono()
    .route("/v1", createRealtimeRoutes(dependencies))
    .route("/", createRestApp(dependencies))
    .notFound((context) => respondWithError(context, restResourceNotFound()))
    .onError((error, context) => respondWithError(context, appError(error)));
}
