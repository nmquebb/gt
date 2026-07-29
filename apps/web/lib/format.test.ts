import { expect, test } from "bun:test";
import { formatUsd } from "./format";

test("formats integer cents without floating-point business logic", () => {
  expect(formatUsd(14500)).toBe("$145.00");
});
