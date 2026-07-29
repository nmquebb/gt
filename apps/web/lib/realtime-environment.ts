import type { RealtimeEnvironment } from "@checkout/sdk";

export function createBrowserRealtimeEnvironment(): RealtimeEnvironment {
  return {
    setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
    clearTimeout: (handle) => window.clearTimeout(handle as number),
  };
}
