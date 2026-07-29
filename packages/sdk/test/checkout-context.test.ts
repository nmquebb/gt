import { expect, test } from "bun:test";
import type { CheckoutClientContext } from "../src/clients/checkout.client";
import { copyCheckoutClientContext } from "../src/react/checkout-context";

test("copies every checkout client context field", () => {
  const context: CheckoutClientContext = {
    deviceId: "mobile_1",
    resumeToken: "resume-token",
    sessionId: "chk_1",
    surface: "mobile",
  };

  expect(copyCheckoutClientContext(context)).toEqual(context);
});
