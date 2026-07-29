export function getWebDeviceId(): string {
  try {
    const existing = localStorage.getItem("checkout-device-id");
    if (existing) {
      return existing;
    }
  } catch {
    // An ephemeral ID is sufficient for this prototype.
  }

  const created = `web_${crypto.randomUUID()}`;
  try {
    localStorage.setItem("checkout-device-id", created);
  } catch {
    // An ephemeral ID is sufficient for this prototype.
  }

  return created;
}
