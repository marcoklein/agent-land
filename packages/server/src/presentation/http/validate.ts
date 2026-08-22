import type { ZodType } from "zod";

export type ParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export function parseInput<T>(schema: ZodType<T>, body: unknown): ParseResult<T> {
  const result = schema.safeParse(body);
  if (result.success) return { ok: true, data: result.data };
  return {
    ok: false,
    error: result.error.issues.map((i) => i.message).join("; "),
  };
}
