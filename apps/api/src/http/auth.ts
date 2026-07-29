export function bearerToken(header: string | undefined): string | undefined {
  return /^Bearer ([^\s]+)$/.exec(header ?? "")?.[1];
}
