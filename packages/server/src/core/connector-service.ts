import type { Connector } from "./types.js";
import type { SecretsPort, ConnectorRepository } from "./ports.js";

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export class DuplicateConnectorError extends Error {
  constructor(name: string) {
    super(`Connector "${name}" already exists.`);
    this.name = "DuplicateConnectorError";
  }
}

export interface CreateConnectorInput {
  name: string;
  url?: string;
  content?: string;
  env?: Record<string, string>;
}

export class ConnectorService {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private repository: ConnectorRepository,
    private secrets: SecretsPort
  ) {}

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  async list(): Promise<Connector[]> {
    return this.repository.list();
  }

  create(input: CreateConnectorInput): Promise<Connector> {
    return this.enqueue(() => this.doCreate(input));
  }

  delete(name: string): Promise<void> {
    return this.enqueue(() => this.doDelete(name));
  }

  private async doCreate(input: CreateConnectorInput): Promise<Connector> {
    const { name, url } = input;

    if (!name) {
      throw new Error("Name is required.");
    }

    const slug = slugify(name);
    if (!slug) {
      throw new Error("Connector name must contain at least one letter or number.");
    }

    const env = input.env ?? {};
    const content = input.content;

    if (!content && Object.keys(env).length === 0) {
      throw new Error("Credentials are required (env or content).");
    }

    const connectors = await this.repository.list();
    if (connectors.some((c) => c.name === name || slugify(c.name) === slug)) {
      throw new DuplicateConnectorError(name);
    }

    const yamlContent = content ?? buildYamlFromEnv(env);

    const secretFile = `${slug}.yaml`;
    await this.secrets.saveEncrypted(secretFile.replace(/\.(ya?ml)$/, ""), yamlContent);

    const now = new Date().toISOString();
    const connector: Connector = {
      name,
      url,
      env,
      secretFile,
      createdAt: now,
      updatedAt: now,
    };
    connectors.push(connector);
    await this.repository.save(connectors);

    return connector;
  }

  private async doDelete(name: string): Promise<void> {
    const connectors = await this.repository.list();
    const connector = connectors.find((c) => c.name === name);
    const filtered = connectors.filter((c) => c.name !== name);
    await this.repository.save(filtered);

    if (connector) {
      await this.secrets.deleteSecret(connector.secretFile.replace(/\.(ya?ml)$/, "")).catch(() => {});
    }
  }
}

function buildYamlFromEnv(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join("\n") + (Object.keys(env).length > 0 ? "\n" : "");
}