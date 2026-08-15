import type { Connector } from "./types.js";
import type { SecretsPort, ConnectorRepository } from "./ports.js";

export interface FieldDef {
  envVar: string;
  label: string;
  placeholder: string;
}

export const CONNECTOR_FIELDS: Record<string, FieldDef[]> = {
  github: [{ envVar: "GITHUB_TOKEN", label: "Personal Access Token", placeholder: "ghp_..." }],
  jira: [
    { envVar: "JIRA_EMAIL", label: "Email", placeholder: "you@example.com" },
    { envVar: "JIRA_API_TOKEN", label: "API Token", placeholder: "..." },
  ],
  gmail: [
    { envVar: "GMAIL_CLIENT_ID", label: "Client ID", placeholder: "..." },
    { envVar: "GMAIL_CLIENT_SECRET", label: "Client Secret", placeholder: "..." },
    { envVar: "GMAIL_REFRESH_TOKEN", label: "Refresh Token", placeholder: "..." },
  ],
};

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export interface CreateConnectorInput {
  name: string;
  type: string;
  url: string;
  content?: string;
  fields?: Record<string, string>;
}

export class ConnectorService {
  constructor(
    private repository: ConnectorRepository,
    private secrets: SecretsPort
  ) {}

  async list(): Promise<Connector[]> {
    return this.repository.list();
  }

  async create(input: CreateConnectorInput): Promise<Connector> {
    const { name, type, url } = input;

    if (!name || !type || !url) {
      throw new Error("Name, type, and URL are required.");
    }

    const fields = CONNECTOR_FIELDS[type];
    const isCustom = !fields;

    if (isCustom && !input.content) {
      throw new Error("Credentials are required.");
    }

    if (!isCustom) {
      for (const f of fields) {
        if (!input.fields?.[f.envVar]) {
          throw new Error(`${f.label} is required.`);
        }
      }
    }

    const connectors = await this.repository.list();
    if (connectors.some((c) => c.name === name)) {
      throw new Error(`Connector "${name}" already exists.`);
    }

    const yamlContent = buildYamlFromFields(type, input);

    const secretFile = `${slugify(name)}.yaml`;
    await this.secrets.saveEncrypted(secretFile.replace(/\.(ya?ml)$/, ""), yamlContent);

    const now = new Date().toISOString();
    const connector: Connector = {
      name,
      type: type as Connector["type"],
      url,
      secretFile,
      createdAt: now,
      updatedAt: now,
    };
    connectors.push(connector);
    await this.repository.save(connectors);

    return connector;
  }

  async delete(name: string): Promise<void> {
    const connectors = await this.repository.list();
    const connector = connectors.find((c) => c.name === name);
    const filtered = connectors.filter((c) => c.name !== name);
    await this.repository.save(filtered);

    if (connector) {
      await this.secrets.deleteSecret(connector.secretFile.replace(/\.(ya?ml)$/, "")).catch(() => {});
    }
  }
}

function buildYamlFromFields(type: string, input: CreateConnectorInput): string {
  const fields = CONNECTOR_FIELDS[type];
  if (!fields) return input.content || "";
  return fields.map((f) => `${f.envVar}: ${input.fields?.[f.envVar] || ""}`).join("\n");
}
