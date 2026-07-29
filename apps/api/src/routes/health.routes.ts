import { Hono } from "hono";
import type { AppEnv } from "../app";

export function createHealthRoutes() {
  return new Hono<AppEnv>().get("/health", (context) =>
    context.json({ status: "ok" as const }, 200),
  );
}
