import { zValidator } from "@hono/zod-validator";
import { Hono, type Context } from "hono";
import { z } from "zod";
import type { AppDependencies } from "../app";
import {
  AcceptOfferRequestSchema,
  CreateCheckoutSessionRequestSchema,
  IdempotencyKeySchema,
  LeaveCheckoutRequestSchema,
  PurchaseRequestSchema,
  ResumeCheckoutRequestSchema,
} from "@checkout/sdk/contracts";
import { bearerToken } from "../http/auth";
import {
  invalidIdempotencyKey,
  invalidRequest,
  respondWithError,
  serviceResponse,
  unauthorizedSession,
} from "../http/error-response";
import { createCheckoutLinks } from "../http/links";

const SessionParamsSchema = z.object({ sessionId: z.string().min(1) });
const ClientParamsSchema = SessionParamsSchema.extend({
  deviceId: z.string().min(1).max(128),
});

function invalid(result: { success: boolean }, context: Context) {
  return result.success
    ? undefined
    : respondWithError(context, invalidRequest());
}

function token(context: Context): string | undefined {
  return bearerToken(context.req.header("authorization"));
}

export function createCheckoutRoutes(dependencies: AppDependencies) {
  return new Hono()
    .post(
      "/checkout-sessions",
      zValidator("json", CreateCheckoutSessionRequestSchema, invalid),
      async (context) => {
        const result = await dependencies.checkoutService.createSession(
          context.req.valid("json"),
        );

        return serviceResponse(context, result, 201, (created) => ({
          snapshot: created.snapshot,
          resumeToken: created.resumeToken,
          links: createCheckoutLinks(
            created.snapshot.session.id,
            created.resumeToken,
          ),
        }));
      },
    )
    .get(
      "/checkout-sessions/:sessionId",
      zValidator("param", SessionParamsSchema, invalid),
      async (context) => {
        const resumeToken = token(context);
        if (resumeToken === undefined) {
          return respondWithError(context, unauthorizedSession());
        }
        const result = await dependencies.checkoutService.getSession({
          sessionId: context.req.valid("param").sessionId,
          resumeToken,
        });

        return serviceResponse(context, result, 200, (snapshot) => ({
          snapshot,
        }));
      },
    )
    .delete(
      "/checkout-sessions/:sessionId",
      zValidator("param", SessionParamsSchema, invalid),
      zValidator("json", LeaveCheckoutRequestSchema, invalid),
      async (context) => {
        const resumeToken = token(context);
        if (resumeToken === undefined) {
          return respondWithError(context, unauthorizedSession());
        }
        const params = context.req.valid("param");
        const body = context.req.valid("json");
        const result = await dependencies.checkoutService.leave({
          sessionId: params.sessionId,
          resumeToken,
          surface: body.surface,
          deviceId: body.deviceId,
        });

        return serviceResponse(context, result, 200, (snapshot) => ({
          snapshot,
        }));
      },
    )
    .put(
      "/checkout-sessions/:sessionId/clients/:deviceId",
      zValidator("param", ClientParamsSchema, invalid),
      zValidator("json", ResumeCheckoutRequestSchema, invalid),
      async (context) => {
        const resumeToken = token(context);
        if (resumeToken === undefined) {
          return respondWithError(context, unauthorizedSession());
        }
        const params = context.req.valid("param");
        const body = context.req.valid("json");
        const result = await dependencies.checkoutService.resume({
          sessionId: params.sessionId,
          deviceId: params.deviceId,
          surface: body.surface,
          resumeToken,
        });

        return serviceResponse(context, result, 200, (snapshot) => ({
          snapshot,
        }));
      },
    )
    .put(
      "/checkout-sessions/:sessionId/offer-acceptance",
      zValidator("param", SessionParamsSchema, invalid),
      zValidator("json", AcceptOfferRequestSchema, invalid),
      async (context) => {
        const resumeToken = token(context);
        if (resumeToken === undefined) {
          return respondWithError(context, unauthorizedSession());
        }
        const params = context.req.valid("param");
        const body = context.req.valid("json");
        const result = await dependencies.checkoutService.acceptOffer({
          sessionId: params.sessionId,
          offerVersion: body.offerVersion,
          surface: body.surface,
          deviceId: body.deviceId,
          resumeToken,
        });

        return serviceResponse(context, result, 200, (snapshot) => ({
          snapshot,
        }));
      },
    )
    .post(
      "/checkout-sessions/:sessionId/purchase",
      zValidator("param", SessionParamsSchema, invalid),
      zValidator("json", PurchaseRequestSchema, invalid),
      async (context) => {
        const resumeToken = token(context);
        if (resumeToken === undefined) {
          return respondWithError(context, unauthorizedSession());
        }
        const idempotencyKey = IdempotencyKeySchema.safeParse(
          context.req.header("idempotency-key"),
        );
        if (!idempotencyKey.success) {
          return respondWithError(context, invalidIdempotencyKey());
        }
        const params = context.req.valid("param");
        const body = context.req.valid("json");
        const result = await dependencies.checkoutService.purchase({
          sessionId: params.sessionId,
          surface: body.surface,
          deviceId: body.deviceId,
          resumeToken,
          idempotencyKey: idempotencyKey.data,
        });

        return serviceResponse(context, result, (purchase) =>
          purchase.disposition === "pending" ? 202 : 200,
        );
      },
    );
}
