import { z } from "zod";
import { sessionStatusSchema } from "./session.js";

export const messageBlockSchema = z
  .object({
    type: z.string().describe("Block type, e.g. 'text'."),
    text: z.string().optional(),
  })
  .describe("A single content block within an assistant message.");
export type MessageBlock = z.infer<typeof messageBlockSchema>;

export const messageSchema = z
  .object({
    role: z.string().optional(),
    content: z.union([z.array(messageBlockSchema), z.string()]).optional().describe("Block array (from pi) or a plain string fallback."),
    stopReason: z.string().optional(),
    errorMessage: z.string().optional(),
  })
  .describe("An assistant message as carried on message_end / turn_end events.");
export type Message = z.infer<typeof messageSchema>;

export const sessionEventSchema = z
  .discriminatedUnion("type", [
    z.object({ type: z.literal("status"), status: sessionStatusSchema }).describe("Session state change."),
    z.object({ type: z.literal("turn_start") }).describe("A new turn began."),
    z.object({
      type: z.literal("turn_end"),
      message: messageSchema.optional(),
      toolResults: z.array(z.unknown()).optional(),
    }).describe("A turn finished."),
    z.object({ type: z.literal("message_delta"), text: z.string() }).describe("Streamed text chunk."),
    z.object({ type: z.literal("message_end"), message: messageSchema }).describe("A message completed."),
    z.object({
      type: z.literal("tool_start"),
      toolCallId: z.string(),
      toolName: z.string(),
      args: z.unknown().optional(),
    }).describe("A tool invocation began."),
    z.object({
      type: z.literal("tool_update"),
      toolCallId: z.string(),
      toolName: z.string(),
      partial: z.unknown().optional(),
    }).describe("A tool invocation produced an intermediate update."),
    z.object({
      type: z.literal("tool_end"),
      toolCallId: z.string(),
      toolName: z.string(),
      result: z.unknown().optional(),
      isError: z.boolean(),
    }).describe("A tool invocation finished."),
    z.object({ type: z.literal("agent_settled") }).describe("The agent finished and is idle."),
    z.object({
      type: z.literal("waiting_for_input"),
      requestId: z.string(),
      method: z.string(),
      prompt: z.string().optional(),
      options: z.array(z.string()).optional(),
    }).describe("The agent requested input (permission dialog)."),
    z.object({ type: z.literal("input_received"), requestId: z.string() }).describe("A dialog was answered."),
  ])
  .describe("Canonical session event emitted on the SSE stream.");
export type SessionEvent = z.infer<typeof sessionEventSchema>;

export type SsePayload = SessionEvent & { seq?: number };
