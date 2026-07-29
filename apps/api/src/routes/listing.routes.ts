import { Hono } from "hono";
import type { AppDependencies, AppEnv } from "../app";
import { serviceResponse } from "../http/error-response";

export function createListingRoutes(dependencies: AppDependencies) {
  return new Hono<AppEnv>().get("/listings", async (context) => {
    const result = await dependencies.checkoutService.listListings();

    return serviceResponse(context, result);
  });
}
