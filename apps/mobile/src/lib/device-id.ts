import { randomUUID } from "expo-crypto";
import * as SecureStore from "expo-secure-store";

const MOBILE_DEVICE_ID_KEY = "checkout-device-id";

export async function getMobileDeviceId(): Promise<string> {
  try {
    const existing = await SecureStore.getItemAsync(MOBILE_DEVICE_ID_KEY);
    if (existing) {
      return existing;
    }

    const created = `mobile_${randomUUID()}`;
    await SecureStore.setItemAsync(MOBILE_DEVICE_ID_KEY, created);

    return created;
  } catch {
    return `mobile_${randomUUID()}`;
  }
}
