import { zValidator } from "@hono/zod-validator";
import { Hono, type Context } from "hono";
import { z } from "zod";
import type { AppDependencies } from "../app";
import { PaymentOutcomeSchema } from "@checkout/sdk/contracts";
import { bearerToken } from "../http/auth";
import {
  invalidRequest,
  respondWithError,
  toHttpError,
  unauthorizedSession,
} from "../http/error-response";
import { createCheckoutLinks } from "../http/links";
import { InvalidPriceAdjustment } from "../services/checkout/checkout.errors";

const SessionParamsSchema = z.object({ sessionId: z.string().min(1) });
const RepriceRequestSchema = z.object({
  increaseCents: z
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER)
    .default(2_000),
});
const PaymentOutcomeRequestSchema = z.object({
  outcome: PaymentOutcomeSchema,
});

function invalid(result: { success: boolean }, context: Context) {
  return result.success
    ? undefined
    : respondWithError(context, invalidRequest());
}

function invalidReprice(result: { success: boolean }, context: Context) {
  return result.success
    ? undefined
    : respondWithError(context, toHttpError(new InvalidPriceAdjustment()));
}

function requireToken(context: Context): string | Response {
  const resumeToken = bearerToken(context.req.header("authorization"));
  if (resumeToken === undefined) {
    return respondWithError(context, unauthorizedSession());
  }
  return resumeToken;
}

export function createDevRoutes(dependencies: AppDependencies) {
  const sessionParams = zValidator("param", SessionParamsSchema, invalid);

  return new Hono()
    .get(
      "/dev/checkout-sessions/:sessionId/activity",
      sessionParams,
      async (context) => {
        const resumeToken = requireToken(context);
        if (resumeToken instanceof Response) {
          return resumeToken;
        }
        const activity = await dependencies.checkoutService.listActivity({
          sessionId: context.req.valid("param").sessionId,
          resumeToken,
        });

        return context.json(activity);
      },
    )
    .post(
      "/dev/checkout-sessions/:sessionId/reprice",
      sessionParams,
      zValidator("json", RepriceRequestSchema, invalidReprice),
      async (context) => {
        const resumeToken = requireToken(context);
        if (resumeToken instanceof Response) {
          return resumeToken;
        }
        const snapshot = await dependencies.checkoutService.reprice({
          sessionId: context.req.valid("param").sessionId,
          resumeToken,
          increaseCents: context.req.valid("json").increaseCents,
        });

        return context.json(snapshot);
      },
    )
    .post(
      "/dev/checkout-sessions/:sessionId/expire",
      sessionParams,
      async (context) => {
        const resumeToken = requireToken(context);
        if (resumeToken instanceof Response) {
          return resumeToken;
        }
        const snapshot = await dependencies.checkoutService.forceExpire({
          sessionId: context.req.valid("param").sessionId,
          resumeToken,
        });

        return context.json(snapshot);
      },
    )
    .put(
      "/dev/checkout-sessions/:sessionId/next-payment-outcome",
      sessionParams,
      zValidator("json", PaymentOutcomeRequestSchema, invalid),
      async (context) => {
        const resumeToken = requireToken(context);
        if (resumeToken instanceof Response) {
          return resumeToken;
        }
        const sessionId = context.req.valid("param").sessionId;
        await dependencies.checkoutService.setNextPaymentOutcome({
          sessionId,
          resumeToken,
          outcome: context.req.valid("json").outcome,
        });

        return context.json(null, 200);
      },
    )
    .post(
      "/dev/checkout-sessions/:sessionId/open-ios-simulator",
      sessionParams,
      async (context) => {
        const resumeToken = requireToken(context);
        if (resumeToken instanceof Response) {
          return resumeToken;
        }
        const sessionId = context.req.valid("param").sessionId;
        const deepLink = createCheckoutLinks(sessionId, resumeToken).deepLink;
        await dependencies.checkoutService.recordAppHandoff(
          { sessionId, resumeToken },
          () => dependencies.iosSimulatorLauncher.open(deepLink),
        );

        return context.json(null, 200);
      },
    );
}
