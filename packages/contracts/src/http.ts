import { z } from "zod";

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