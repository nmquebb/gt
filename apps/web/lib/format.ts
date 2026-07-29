export { formatUsd } from "@checkout/sdk";

export function formatAbsoluteExpiration(expiresAt: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Chicago",
  }).format(new Date(expiresAt));
}
