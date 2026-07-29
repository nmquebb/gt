import { websocket } from "hono/bun";
import { createApp } from "./app";
import { createAppDependencies } from "./composition";

const app = createApp(createAppDependencies());

Bun.serve({
  fetch: app.fetch,
  websocket,
  port: 3000,
});
