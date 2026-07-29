import { expect, test } from "bun:test";
import { parseCheckoutDeepLink } from "./checkout-route";

test("parses one valid gametime checkout link", () => {
  expect(
    parseCheckoutDeepLink("gametime://checkout/chk_1?token=secret"),
  ).toEqual({ sessionId: "chk_1", token: "secret" });
});

test("rejects duplicate tokens and unrelated schemes", () => {
  expect(
    parseCheckoutDeepLink("gametime://checkout/chk_1?token=a&token=b"),
  ).toBeUndefined();
  expect(
    parseCheckoutDeepLink("https://example.com/checkout/chk_1?token=a"),
  ).toBeUndefined();
});

test("rejects empty and malformed checkout values", () => {
  expect(
    parseCheckoutDeepLink("gametime://checkout/?token=secret"),
  ).toBeUndefined();
  expect(
    parseCheckoutDeepLink("gametime://checkout/chk_1?token="),
  ).toBeUndefined();
  expect(parseCheckoutDeepLink("not a URL")).toBeUndefined();
  expect(parseCheckoutDeepLink(null)).toBeUndefined();
});
