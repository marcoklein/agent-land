import { z } from "zod";

export const providerSchema = z
  .object({
    id: z.string().describe("Slugified provider id."),
    label: z.string().optional().describe("Human-readable label."),
    baseUrl: z.string().optional().describe("API base URL."),
    api: z.string().optional().describe("API dialect (e.g. openai-completions, anthropic-messages)."),
    models: z.array(z.string()).optional().describe("Statically configured model list."),
    defaultModel: z.string().optional(),
    secretFile: z.string().optional().describe("Encrypted credential backing this provider."),
    enabled: z.boolean().describe("Whether the provider is active for new sessions."),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
  })
  .describe("A generic LLM provider configuration.");
export type Provider = z.infer<typeof providerSchema>;

export const createProviderInputSchema = z
  .object({
    id: z.string().min(1, "id is required"),
    label: z.string().optional(),
    baseUrl: z.string().optional(),
    api: z.string().optional(),
    models: z.array(z.string()).optional(),
    defaultModel: z.string().optional(),
    enabled: z.boolean().optional(),
    secretFields: z.record(z.string(), z.string()).optional().describe("Credential fields as env-var/value pairs."),
    fields: z.record(z.string(), z.string()).optional().describe("Alias of secretFields."),
    secretContent: z.string().optional().describe("Raw secret content."),
    apiKey: z.string().optional().describe("Single API key (persisted as an env var)."),
  })
  .describe("Request body for POST /api/providers.");
export type CreateProviderInput = z.infer<typeof createProviderInputSchema>;

export const providerEnvelopeSchema = z.object({ provider: providerSchema }).describe("Single-provider response envelope.");
export type ProviderEnvelope = z.infer<typeof providerEnvelopeSchema>;

export const providerListEnvelopeSchema = z
  .object({ providers: z.array(providerSchema) })
  .describe("Provider-list response envelope.");
export type ProviderListEnvelope = z.infer<typeof providerListEnvelopeSchema>;