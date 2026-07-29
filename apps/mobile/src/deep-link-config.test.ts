import { expect, test } from "bun:test";
import appConfig from "../app.json";
import { createCheckoutLinks } from "../../api/src/http/links";

test("the mobile app registers the scheme emitted by checkout links", () => {
  const deepLink = createCheckoutLinks("chk_1", "secret").deepLink;
  const emittedScheme = new URL(deepLink).protocol.replace(/:$/, "");
  const configuredScheme = (
    appConfig.expo as typeof appConfig.expo & {
      scheme?: string | string[];
    }
  ).scheme;
  const registeredSchemes = Array.isArray(configuredScheme)
    ? configuredScheme
    : configuredScheme === undefined
      ? []
      : [configuredScheme];

  expect(registeredSchemes).toContain(emittedScheme);
});
