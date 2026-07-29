import { expect, test } from "bun:test";
import { checkoutCopy } from "@checkout/sdk";

test.each([
  ["ready", "Your seat is held"],
  ["offer_review_required", "The price changed"],
  ["purchase_pending", "Completing your purchase"],
  ["purchase_failed", "Payment was not completed"],
  ["expired", "This hold expired"],
  ["abandoned", "This checkout was released"],
  ["completed", "You’re going"],
] as const)("maps %s to stable customer copy", (status, heading) => {
  expect(checkoutCopy[status].heading).toBe(heading);
});
