import { zValidator } from "@hono/zod-validator";
import { Hono, type Context } from "hono";
import { upgradeWebSocket } from "hono/bun";
import { z } from "zod";
import type { AppDependencies } from "../app";
import { invalidRequest, respondWithError } from "../http/error-response";

const SessionParamsSchema = z.object({ sessionId: z.string().min(1) });
const EventsQuerySchema = z.object({ token: z.string().min(1) });

function invalid(result: { success: boolean }, context: Context) {
  return result.success
    ? undefined
    : respondWithError(context, invalidRequest());
}

export function createRealtimeRoutes(dependencies: AppDependencies) {
  return new Hono().get(
    "/checkout-sessions/:sessionId/events",
    zValidator("param", SessionParamsSchema, invalid),
    zValidator("query", EventsQuerySchema, invalid),
    async (context) => {
      const params = context.req.valid("param");
      const query = context.req.valid("query");
      await dependencies.checkoutService.getSession({
        sessionId: params.sessionId,
        resumeToken: query.token,
      });

      let removeRegistration: (() => void) | undefined;
      let cleanedUp = false;

      function cleanup(): void {
        if (cleanedUp) {
          return;
        }
        cleanedUp = true;
        removeRegistration?.();
        removeRegistration = undefined;
      }

      return upgradeWebSocket(context, {
        onOpen(_event, socket) {
          removeRegistration = dependencies.realtimeHub.register(
            params.sessionId,
            socket,
          );
          void (async () => {
            const fresh = await dependencies.checkoutService.getSession({
              sessionId: params.sessionId,
              resumeToken: query.token,
            });
            if (cleanedUp) {
              return;
            }
            const sent = dependencies.realtimeHub.send(socket, {
              type: "checkout_session_updated",
              cause: "initial_sync",
              snapshot: fresh,
            });
            if (!sent) {
              cleanup();
              socket.close();
            }
          })().catch(() => {
            if (!cleanedUp) {
              cleanup();
              socket.close();
            }
          });
        },
        onClose() {
          cleanup();
        },
        onError() {
          cleanup();
        },
      });
    },
  );
}
