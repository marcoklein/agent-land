import { z } from "zod";

export const connectorTypeSchema = z
  .enum(["jira", "github", "gmail", "custom"])
  .describe("Connector kind; anything outside the built-ins is treated as custom.");
export type ConnectorType = z.infer<typeof connectorTypeSchema>;

export const connectorSchema = z
  .object({
    name: z.string().describe("Display name; also the slug source for the secret file."),
    type: connectorTypeSchema,
    url: z.string().describe("Base URL of the external system."),
    secretFile: z.string().describe("SOPS/Age-encrypted secret file backing this connector."),
    createdAt: z.string().describe("ISO timestamp of creation."),
    updatedAt: z.string().describe("ISO timestamp of the last update."),
  })
  .describe("A connector: metadata + pointer to an encrypted credential, decrypted only at launch.");
export type Connector = z.infer<typeof connectorSchema>;

export const connectorFieldDefSchema = z
  .object({
    envVar: z.string().describe("Environment variable the secret is exposed as."),
    label: z.string().describe("Human-readable field label."),
    placeholder: z.string().describe("Placeholder hint for the secret value."),
  })
  .describe("Schema of one credential field for a built-in connector type.");
export type ConnectorFieldDef = z.infer<typeof connectorFieldDefSchema>;

export const createConnectorInputSchema = z
  .object({
    name: z.string().min(1, "name is required"),
    type: z.string().min(1, "type is required"),
    url: z.string().min(1, "url is required"),
    content: z.string().optional().describe("Raw YAML secret for custom connectors."),
    fields: z.record(z.string(), z.string()).optional().describe("Credential fields for built-in connectors."),
  })
  .describe("Request body for POST /api/connectors.");
export type CreateConnectorInput = z.infer<typeof createConnectorInputSchema>;

export const connectorEnvelopeSchema = z.object({ connector: connectorSchema }).describe("Single-connector response envelope.");
export type ConnectorEnvelope = z.infer<typeof connectorEnvelopeSchema>;

export const connectorListEnvelopeSchema = z
  .object({ connectors: z.array(connectorSchema) })
  .describe("Connector-list response envelope.");
export type ConnectorListEnvelope = z.infer<typeof connectorListEnvelopeSchema>;

export const connectorFieldsEnvelopeSchema = z
  .object({
    type: z.string().describe("Resolved connector type, or 'custom' for unknown types."),
    fields: z.array(connectorFieldDefSchema).nullable().describe("Credential fields, or null for custom types."),
  })
  .describe("Response envelope for GET /api/connectors/fields.");
export type ConnectorFieldsEnvelope = z.infer<typeof connectorFieldsEnvelopeSchema>;
