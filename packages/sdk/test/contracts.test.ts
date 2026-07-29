import { expect, test } from "bun:test";
import {
  CheckoutSnapshotSchema,
  PurchaseResponseSchema,
} from "../src/contracts/checkout.contract";
import { CheckoutSessionUpdatedEventSchema } from "../src/contracts/realtime.contract";
import { checkoutSnapshotFixture } from "./fixtures";

test("the SDK owns and parses the public checkout contract", () => {
  const snapshot = checkoutSnapshotFixture();

  expect(CheckoutSnapshotSchema.parse(snapshot)).toEqual(snapshot);
  expect(
    PurchaseResponseSchema.parse({
      disposition: "completed",
      duplicatePrevented: false,
      snapshot,
    }),
  ).toEqual({
    disposition: "completed",
    duplicatePrevented: false,
    snapshot,
  });
  expect(
    CheckoutSessionUpdatedEventSchema.parse({
      type: "checkout_session_updated",
      cause: "completed",
      snapshot,
    }).snapshot,
  ).toEqual(snapshot);
});
