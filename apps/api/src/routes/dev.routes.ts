import { zValidator } from "@hono/zod-validator";
import { Hono, type Context } from "hono";
import { z } from "zod";
import type { AppDependencies, AppEnv } from "../app";
import { PaymentOutcomeSchema } from "@checkout/sdk/contracts";
import { bearerToken } from "../http/auth";
import {
  invalidRequest,
  respondWithError,
  serviceResponse,
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
    : respondWithError(context, toHttpError(new InvalidPriceAdjustment({})));
}

async function authenticate(
  context: Context,
  dependencies: AppDependencies,
  sessionId: string,
) {
  const resumeToken = bearerToken(context.req.header("authorization"));
  if (resumeToken === undefined) {
    return respondWithError(context, unauthorizedSession());
  }
  const session = await dependencies.checkoutService.getSession({
    sessionId,
    resumeToken,
  });
  if (session.isErr()) {
    return respondWithError(context, toHttpError(session.error));
  }

  return { sessionId, resumeToken, snapshot: session.value };
}

export function createDevRoutes(dependencies: AppDependencies) {
  const sessionParams = zValidator("param", SessionParamsSchema, invalid);

  return new Hono<AppEnv>()
    .get(
      "/dev/checkout-sessions/:sessionId/activity",
      sessionParams,
      async (context) => {
        const authenticated = await authenticate(
          context,
          dependencies,
          context.req.valid("param").sessionId,
        );
        if (authenticated instanceof Response) {
          return authenticated;
        }
        const result = await dependencies.checkoutService.listActivity({
          sessionId: authenticated.sessionId,
          resumeToken: authenticated.resumeToken,
        });

        return serviceResponse(context, result);
      },
    )
    .post(
      "/dev/checkout-sessions/:sessionId/reprice",
      sessionParams,
      zValidator("json", RepriceRequestSchema, invalidReprice),
      async (context) => {
        const authenticated = await authenticate(
          context,
          dependencies,
          context.req.valid("param").sessionId,
        );
        if (authenticated instanceof Response) {
          return authenticated;
        }
        const result = await dependencies.checkoutService.reprice({
          sessionId: authenticated.sessionId,
          increaseCents: context.req.valid("json").increaseCents,
        });

        return serviceResponse(context, result, 200, (snapshot) => ({
          snapshot,
        }));
      },
    )
    .post(
      "/dev/checkout-sessions/:sessionId/expire",
      sessionParams,
      async (context) => {
        const authenticated = await authenticate(
          context,
          dependencies,
          context.req.valid("param").sessionId,
        );
        if (authenticated instanceof Response) {
          return authenticated;
        }
        const result = await dependencies.checkoutService.forceExpire({
          sessionId: authenticated.sessionId,
          resumeToken: authenticated.resumeToken,
        });

        return serviceResponse(context, result, 200, (snapshot) => ({
          snapshot,
        }));
      },
    )
    .put(
      "/dev/checkout-sessions/:sessionId/next-payment-outcome",
      sessionParams,
      zValidator("json", PaymentOutcomeRequestSchema, invalid),
      async (context) => {
        const authenticated = await authenticate(
          context,
          dependencies,
          context.req.valid("param").sessionId,
        );
        if (authenticated instanceof Response) {
          return authenticated;
        }
        dependencies.paymentScenarios.setNextOutcome(
          authenticated.sessionId,
          context.req.valid("json").outcome,
        );

        return context.json(null, 200);
      },
    )
    .post(
      "/dev/checkout-sessions/:sessionId/open-ios-simulator",
      sessionParams,
      async (context) => {
        const authenticated = await authenticate(
          context,
          dependencies,
          context.req.valid("param").sessionId,
        );
        if (authenticated instanceof Response) {
          return authenticated;
        }
        const deepLink = createCheckoutLinks(
          authenticated.snapshot.session.id,
          authenticated.resumeToken,
        ).deepLink;
        const launched = await dependencies.iosSimulatorLauncher.open(deepLink);
        if (launched.isErr()) {
          return respondWithError(context, toHttpError(launched.error));
        }
        const recorded = await dependencies.checkoutService.recordAppHandoff({
          sessionId: authenticated.sessionId,
          resumeToken: authenticated.resumeToken,
        });

        return recorded.isErr()
          ? respondWithError(context, toHttpError(recorded.error))
          : context.json(null, 200);
      },
    );
}
