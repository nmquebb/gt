import { Result } from "better-result";
import { z } from "zod";

const ConfigSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  WEB_BASE_URL: z.string().url().default("http://127.0.0.1:8000"),
});

export type ApiConfig = z.infer<typeof ConfigSchema>;

export class InvalidConfiguration extends Error {}

export function parseConfig(environment: Record<string, string | undefined>) {
  const parsed = ConfigSchema.safeParse(environment);

  return parsed.success
    ? Result.ok(parsed.data)
    : Result.err(new InvalidConfiguration());
}
