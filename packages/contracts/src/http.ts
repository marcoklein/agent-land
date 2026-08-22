import { z } from "zod";
import { providerSchema } from "./provider.js";

export const acceptedEnvelopeSchema = z
  .object({ accepted: z.literal(true) })
  .describe("Acknowledged operation response.");
export type AcceptedEnvelope = z.infer<typeof acceptedEnvelopeSchema>;

export const deletedEnvelopeSchema = z
  .object({ deleted: z.literal(true) })
  .describe("Successful deletion response.");
export type DeletedEnvelope = z.infer<typeof deletedEnvelopeSchema>;

export const errorEnvelopeSchema = z
  .object({ error: z.string() })
  .describe("Error response body.");
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

export const modelsEnvelopeSchema = z
  .object({ models: z.array(z.string()) })
  .describe("Discovered model-name list.");
export type ModelsEnvelope = z.infer<typeof modelsEnvelopeSchema>;

export const copilotStartEnvelopeSchema = z
  .object({
    deviceCode: z.string().describe("Device code to poll."),
    userCode: z.string().describe("Code the user enters on GitHub."),
    verificationUri: z.string().describe("URL to enter the user code."),
    interval: z.number().describe("Poll interval in seconds."),
    expiresIn: z.number().describe("Lifetime of the flow in seconds."),
  })
  .describe("Response of POST /api/providers/copilot/start.");
export type CopilotStartEnvelope = z.infer<typeof copilotStartEnvelopeSchema>;

export const copilotPollInputSchema = z
  .object({
    deviceCode: z.string().min(1, "deviceCode is required"),
  })
  .describe("Request body for POST /api/providers/copilot/poll.");
export type CopilotPollInput = z.infer<typeof copilotPollInputSchema>;

export const copilotPollEnvelopeSchema = z
  .object({
    status: z.string().describe("Device-flow status: pending, slow_down, authorized, expired, denied, or failed."),
    provider: providerSchema.optional().describe("Created provider on authorization."),
    message: z.string().optional(),
  })
  .describe("Response of POST /api/providers/copilot/poll.");
export type CopilotPollEnvelope = z.infer<typeof copilotPollEnvelopeSchema>;
