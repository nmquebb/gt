import { Result } from "better-result";
import { websocket } from "hono/bun";
import { createApp } from "./app";
import { createAppDependencies } from "./composition";
import { parseConfig } from "./config";

const config = parseConfig(process.env);

if (Result.isError(config)) {
  console.error("API configuration is invalid.");
  process.exitCode = 1;
} else {
  const app = createApp(createAppDependencies(config.value));
  Bun.serve({
    fetch: app.fetch,
    websocket,
    port: config.value.PORT,
  });
}
