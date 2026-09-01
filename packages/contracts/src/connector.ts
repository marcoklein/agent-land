import { z } from "zod";

export const connectorSchema = z
  .object({
    name: z.string().describe("Display name; also the slug source for the secret file."),
    url: z.string().optional().describe("Base URL of the external system."),
    envKeys: z.array(z.string()).describe("Names of the env vars provided; values never leave the server."),
    secretFile: z.string().describe("SOPS/Age-encrypted secret file backing this connector."),
    createdAt: z.string().describe("ISO timestamp of creation."),
    updatedAt: z.string().describe("ISO timestamp of the last update."),
  })
  .describe("A connector: name + sealed env bag. Values encrypted at rest and never exposed over the API.");
export type Connector = z.infer<typeof connectorSchema>;

export const createConnectorInputSchema = z
  .object({
    name: z.string().min(1, "name is required"),
    url: z.string().optional(),
    env: z.record(z.string(), z.string()).optional().describe("Env vars to encrypt as the connector secret."),
    content: z.string().optional().describe("Raw YAML content (alternative to env for custom connectors)."),
  })
  .describe("Request body for POST /api/connectors.");
export type CreateConnectorInput = z.infer<typeof createConnectorInputSchema>;

export const connectorEnvelopeSchema = z.object({ connector: connectorSchema }).describe("Single-connector response envelope.");
export type ConnectorEnvelope = z.infer<typeof connectorEnvelopeSchema>;

export const connectorListEnvelopeSchema = z
  .object({ connectors: z.array(connectorSchema) })
  .describe("Connector-list response envelope.");
export type ConnectorListEnvelope = z.infer<typeof connectorListEnvelopeSchema>;