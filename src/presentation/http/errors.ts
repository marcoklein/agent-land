import { SessionStoppedError, SessionNotFoundError } from "../../core/session-service.js";

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function sessionErrorResponse(err: unknown): { status: number; error: string } {
  if (err instanceof SessionStoppedError) return { status: 409, error: err.message };
  if (err instanceof SessionNotFoundError) return { status: 404, error: err.message };
  return { status: 500, error: errorMessage(err) };
}
