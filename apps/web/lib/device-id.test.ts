import { afterEach, expect, test } from "bun:test";
import { getWebDeviceId } from "./device-id";

const originalLocalStorage = Object.getOwnPropertyDescriptor(
  globalThis,
  "localStorage",
);
const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, "crypto");

function installBrowser({
  getItem,
  setItem,
}: {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}) {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem, setItem },
  });
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: { randomUUID: () => "22222222-2222-4222-8222-222222222222" },
  });
}

function restoreGlobal(
  name: "localStorage" | "crypto",
  descriptor: PropertyDescriptor | undefined,
) {
  if (descriptor === undefined) {
    Reflect.deleteProperty(globalThis, name);
  } else {
    Object.defineProperty(globalThis, name, descriptor);
  }
}

afterEach(() => {
  restoreGlobal("localStorage", originalLocalStorage);
  restoreGlobal("crypto", originalCrypto);
});

test("reuses the stored web device ID", () => {
  const writes: Array<[string, string]> = [];
  installBrowser({
    getItem: (key) => (key === "checkout-device-id" ? "web_stored" : null),
    setItem: (key, value) => writes.push([key, value]),
  });

  expect(getWebDeviceId()).toBe("web_stored");
  expect(writes).toEqual([]);
});

test("returns an ephemeral web device ID when storage fails", () => {
  installBrowser({
    getItem: () => null,
    setItem: () => {
      throw new Error("storage disabled");
    },
  });

  expect(getWebDeviceId()).toBe("web_22222222-2222-4222-8222-222222222222");
});

test("returns an ephemeral web device ID when storage reads fail", () => {
  installBrowser({
    getItem: () => {
      throw new Error("storage disabled");
    },
    setItem: () => {
      throw new Error("storage disabled");
    },
  });

  expect(getWebDeviceId()).toBe("web_22222222-2222-4222-8222-222222222222");
});
