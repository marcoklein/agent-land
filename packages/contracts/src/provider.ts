import { z } from "zod";

export const providerKindSchema = z
  .enum(["builtin", "custom", "oauth"])
  .describe("Provider kind: catalog built-in, user-defined custom, or OAuth (Copilot).");
export type ProviderKind = z.infer<typeof providerKindSchema>;

export const providerApiTypeSchema = z
  .enum(["openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai"])
  .describe("Wire API dialect the provider speaks.");
export type ProviderApiType = z.infer<typeof providerApiTypeSchema>;

export const providerSchema = z
  .object({
    id: z.string().describe("Slugified provider id."),
    kind: providerKindSchema,
    piProvider: z.string().describe("Identifier passed to pi for this provider."),
    label: z.string().optional().describe("Human-readable label."),
    baseUrl: z.string().optional().describe("API base URL for custom providers."),
    api: providerApiTypeSchema.optional(),
    models: z.array(z.string()).optional().describe("Statically configured model list, when discovery is unavailable."),
    defaultModel: z.string().optional(),
    secretFile: z.string().optional().describe("Encrypted credential backing this provider."),
    enabled: z.boolean().describe("Whether the provider is active for new sessions."),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
  })
  .describe("An LLM provider configuration.");
export type Provider = z.infer<typeof providerSchema>;

export const providerCatalogItemSchema = z
  .object({
    id: z.string().describe("Built-in provider id."),
    kind: z.enum(["builtin", "oauth"]),
    label: z.string().optional(),
    authEnvVars: z.array(z.string()).nullable().optional().describe("Env vars the provider requires for auth."),
    defaultModel: z.string().nullable().optional(),
  })
  .describe("A built-in provider entry as advertised by GET /api/providers/catalog.");
export type ProviderCatalogItem = z.infer<typeof providerCatalogItemSchema>;

export const createProviderInputSchema = z
  .object({
    id: z.string().min(1, "id is required"),
    kind: providerKindSchema,
    baseUrl: z.string().optional(),
    api: providerApiTypeSchema.optional(),
    models: z.array(z.string()).optional(),
    defaultModel: z.string().optional(),
    label: z.string().optional(),
    enabled: z.boolean().optional(),
    secretFields: z.record(z.string(), z.string()).optional().describe("Credential fields as env-var/value pairs."),
    fields: z.record(z.string(), z.string()).optional().describe("Alias of secretFields."),
    secretContent: z.string().optional().describe("Raw secret content for OAuth providers."),
  })
  .superRefine((v, ctx) => {
    if (v.kind === "custom") {
      if (!v.baseUrl?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "baseUrl is required for custom providers",
          path: ["baseUrl"],
        });
      }
      if (!v.api) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "api is required for custom providers",
          path: ["api"],
        });
      }
    }
  })
  .describe("Request body for POST /api/providers.");
export type CreateProviderInput = z.infer<typeof createProviderInputSchema>;

export const providerEnvelopeSchema = z.object({ provider: providerSchema }).describe("Single-provider response envelope.");
export type ProviderEnvelope = z.infer<typeof providerEnvelopeSchema>;

export const providerListEnvelopeSchema = z
  .object({ providers: z.array(providerSchema) })
  .describe("Provider-list response envelope.");
export type ProviderListEnvelope = z.infer<typeof providerListEnvelopeSchema>;

export const providerCatalogEnvelopeSchema = z
  .object({ catalog: z.array(providerCatalogItemSchema) })
  .describe("Provider-catalog response envelope.");
export type ProviderCatalogEnvelope = z.infer<typeof providerCatalogEnvelopeSchema>;
