import { timingSafeEqual } from "crypto";
import type { NextFunction, Request, Response } from "express";
import type { Config } from "../../config.js";
import type { SessionService } from "../../core/session-service.js";
import { PLATFORM_SESSION_PREFIX } from "../../core/types.js";

/** Constant-time string comparison; falls back to length-checked compare for unequal lengths. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

interface BasicCredentials {
  user: string;
  password: string;
}

/** Parses an HTTP Basic `Authorization` header value into its user/password parts. */
export function parseAuthorizationHeader(header: string | undefined): BasicCredentials | undefined {
  if (!header || !header.startsWith("Basic ")) return undefined;
  const decoded = Buffer.from(header.slice("Basic ".length), "base64").toString("utf-8");
  const idx = decoded.indexOf(":");
  if (idx <= 0) return undefined;
  return { user: decoded.slice(0, idx), password: decoded.slice(idx + 1) };
}

/**
 * Minimal server-side auth for the JSON/SSE API.
 *
 * Accepts two identities:
 *  - the operator basic-auth credential (when configured on the server), and
 *  - a per-session platform credential of the form `session-<id>:<token>`.
 *
 * When no operator credential is configured, the deployment is trusted-network
 * or reverse-proxy-fronted (ADR 009): nginx terminates basic auth and forwards
 * the Authorization header, so every request passes through — header present or
 * not. Session credentials are validated whenever they are presented, so the
 * Platform Connector loopback works in both modes.
 */
export function createApiAuthMiddleware(sessionService: SessionService, config: Config) {
  return async function apiAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
    const creds = parseAuthorizationHeader(req.headers.authorization);

    if (!config.operatorBasicAuth) return next();

    if (!creds) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    const operator = config.operatorBasicAuth;
    if (safeEqual(creds.user, operator.user) && safeEqual(creds.password, operator.password)) {
      return next();
    }

    if (creds.user.startsWith(PLATFORM_SESSION_PREFIX)) {
      const id = creds.user.slice(PLATFORM_SESSION_PREFIX.length);
      const session = await sessionService.getSession(id);
      if (session?.platformToken && safeEqual(creds.password, session.platformToken)) {
        return next();
      }
    }

    res.status(401).json({ error: "unauthorized" });
  };
}
