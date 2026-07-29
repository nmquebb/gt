import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./apps/web/e2e",
  webServer: [
    {
      command: "bun run dev:api",
      url: "http://127.0.0.1:3000/v1/health",
      reuseExistingServer: false,
    },
    {
      command:
        "API_INTERNAL_URL=http://127.0.0.1:3000 NEXT_PUBLIC_API_URL=http://127.0.0.1:3000 bun run dev:web",
      url: "http://127.0.0.1:8000",
      reuseExistingServer: false,
    },
  ],
  use: {
    baseURL: "http://127.0.0.1:8000",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
