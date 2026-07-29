import { beforeEach, expect, mock, test } from "bun:test";

type SecureStoreControl = {
  getItemAsync: (key: string) => Promise<string | null>;
  setItemAsync: (key: string, value: string) => Promise<void>;
};

const defaultSecureStore: SecureStoreControl = {
  getItemAsync: async () => null,
  setItemAsync: async () => undefined,
};

void mock.module("expo-crypto", () => ({
  randomUUID: () =>
    (
      globalThis as {
        __mobileCheckoutUuid?: string;
      }
    ).__mobileCheckoutUuid ?? "11111111-1111-4111-8111-111111111111",
}));

void mock.module("expo-secure-store", () => ({
  getItemAsync: (key: string) =>
    (
      globalThis as {
        __mobileSecureStore?: SecureStoreControl;
      }
    ).__mobileSecureStore?.getItemAsync(key) ??
    defaultSecureStore.getItemAsync(key),
  setItemAsync: (key: string, value: string) =>
    (
      globalThis as {
        __mobileSecureStore?: SecureStoreControl;
      }
    ).__mobileSecureStore?.setItemAsync(key, value) ??
    defaultSecureStore.setItemAsync(key, value),
}));

const { getMobileDeviceId } = await import("./device-id");

beforeEach(() => {
  Reflect.deleteProperty(globalThis, "__mobileCheckoutUuid");
  Reflect.deleteProperty(globalThis, "__mobileSecureStore");
});

test("reuses a securely stored mobile device ID", async () => {
  const requestedKeys: string[] = [];
  (
    globalThis as {
      __mobileSecureStore?: SecureStoreControl;
    }
  ).__mobileSecureStore = {
    getItemAsync: async (key) => {
      requestedKeys.push(key);

      return "mobile_existing";
    },
    setItemAsync: async () => {
      throw new Error("stored IDs must not be replaced");
    },
  };

  expect(await getMobileDeviceId()).toBe("mobile_existing");
  expect(requestedKeys).toEqual(["checkout-device-id"]);
});

test("creates and securely stores a UUID-backed mobile device ID", async () => {
  const writes: Array<{ key: string; value: string }> = [];
  (
    globalThis as {
      __mobileCheckoutUuid?: string;
      __mobileSecureStore?: SecureStoreControl;
    }
  ).__mobileCheckoutUuid = "22222222-2222-4222-8222-222222222222";
  (
    globalThis as {
      __mobileSecureStore?: SecureStoreControl;
    }
  ).__mobileSecureStore = {
    getItemAsync: async () => null,
    setItemAsync: async (key, value) => {
      writes.push({ key, value });
    },
  };

  expect(await getMobileDeviceId()).toBe(
    "mobile_22222222-2222-4222-8222-222222222222",
  );
  expect(writes).toEqual([
    {
      key: "checkout-device-id",
      value: "mobile_22222222-2222-4222-8222-222222222222",
    },
  ]);
});

test("falls back to an ephemeral UUID when secure storage fails", async () => {
  (
    globalThis as {
      __mobileCheckoutUuid?: string;
      __mobileSecureStore?: SecureStoreControl;
    }
  ).__mobileCheckoutUuid = "33333333-3333-4333-8333-333333333333";
  (
    globalThis as {
      __mobileSecureStore?: SecureStoreControl;
    }
  ).__mobileSecureStore = {
    getItemAsync: async () => {
      throw new Error("storage unavailable");
    },
    setItemAsync: async () => {
      throw new Error("storage unavailable");
    },
  };

  expect(await getMobileDeviceId()).toBe(
    "mobile_33333333-3333-4333-8333-333333333333",
  );
});
