import { z } from "zod";
import { mountBindSchema } from "./mount.js";

export const permissionPolicySchema = z
  .enum(["auto", "manual"])
  .describe("How permission dialogs are handled: auto-answered or routed to the client.");
export type PermissionPolicy = z.infer<typeof permissionPolicySchema>;

export const sessionStatusSchema = z
  .enum(["running", "waiting_for_input", "idle", "stopped"])
  .describe("Lifecycle state of an agent session.");
export type SessionStatus = z.infer<typeof sessionStatusSchema>;

export const sessionSchema = z
  .object({
    id: z.string().describe("Unique session id."),
    status: sessionStatusSchema,
    permissionPolicy: permissionPolicySchema,
    sessionDir: z.string().describe("On-disk directory holding the pi transcript for this session."),
    connectors: z.array(z.string()).describe("Connector names whose secrets are injected into the session."),
    mounts: z.array(mountBindSchema).optional().describe("Mounts bound to the session at creation."),
    model: z.string().describe("LLM model the session runs on."),
    provider: z.string().optional().describe("Provider id; omitted means the default provider."),
    createdAt: z.string().describe("ISO timestamp of creation."),
    updatedAt: z.string().describe("ISO timestamp of the last state change."),
    containerId: z.string().optional().describe("Docker container id while the agent is alive."),
    waitingFor: z
      .object({
        requestId: z.string(),
        method: z.enum(["confirm", "input", "select", "editor"]),
        prompt: z.string().optional(),
      })
      .optional()
      .describe("Pending permission dialog, when the session is waiting for input."),
    platform: z
      .boolean()
      .optional()
      .describe("True when the session was launched with platform loopback credentials injected."),
    parentSessionId: z
      .string()
      .optional()
      .describe("Id of the session that spawned this one, for lineage (absent for top-level sessions)."),
  })
  .describe("An agent session (the single entity of the platform).");

export type Session = z.infer<typeof sessionSchema>;

export const createSessionInputSchema = z
  .object({
    connectors: z.array(z.string()).optional(),
    mounts: z.array(mountBindSchema).optional(),
    permissionPolicy: z.string().optional(),
    model: z.string().optional(),
    provider: z.string().optional(),
    platform: z
      .boolean()
      .optional()
      .describe("Inject AGENT_LAND_URL and a scoped loopback credential (default false)."),
    parentSessionId: z
      .string()
      .optional()
      .describe("Id of the parent session, when this session is spawned by another session."),
  })
  .describe("Request body for POST /api/sessions.");
export type CreateSessionInput = z.infer<typeof createSessionInputSchema>;

export const promptBehaviorSchema = z
  .enum(["steer", "followUp"])
  .describe("Whether a prompt steers the current turn or queues a follow-up turn.");
export type PromptBehavior = z.infer<typeof promptBehaviorSchema>;

export const promptInputSchema = z
  .object({
    message: z.string().min(1, "message is required"),
    behavior: promptBehaviorSchema.optional(),
  })
  .describe("Request body for POST /api/sessions/:id/prompt.");
export type PromptInput = z.infer<typeof promptInputSchema>;

export const respondInputSchema = z
  .object({
    requestId: z.string().min(1, "requestId is required"),
    value: z.string().optional(),
    confirmed: z.boolean().optional(),
    cancelled: z.boolean().optional(),
  })
  .refine(
    (v) =>
      [v.value !== undefined, v.confirmed !== undefined, v.cancelled !== undefined].filter(
        Boolean
      ).length === 1,
    { message: "Provide exactly one of value, confirmed, or cancelled" }
  )
  .describe("Request body for POST /api/sessions/:id/respond; exactly one answer field.");
export type RespondInput = z.infer<typeof respondInputSchema>;

export const sessionEnvelopeSchema = z.object({ session: sessionSchema }).describe("Single-session response envelope.");
export type SessionEnvelope = z.infer<typeof sessionEnvelopeSchema>;

export const sessionListEnvelopeSchema = z
  .object({ sessions: z.array(sessionSchema) })
  .describe("Session-list response envelope.");
export type SessionListEnvelope = z.infer<typeof sessionListEnvelopeSchema>;
