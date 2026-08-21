import type Docker from "dockerode";
import type { AgentSession, Connector, DecryptedSecret, ProviderConfig, SecretInfo } from "./types.js";
import type { SessionEvent } from "./events.js";

export interface InteractiveExec {
  stream: NodeJS.ReadWriteStream;
  resize(h: number, w: number): Promise<void>;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface DockerPort {
  createInteractiveContainer(opts: {
    id: string;
    envVars: Record<string, string>;
    image: string;
    sessionVolume: string;
    workspaceVolume: string;
  }): Promise<Docker.Container>;
  execInteractive(containerId: string, args: string[], tty: boolean): Promise<InteractiveExec>;
  execCommand(containerId: string, args: string[]): Promise<ExecResult>;
  removeContainer(id: string): Promise<void>;
  removeVolume(name: string): Promise<void>;
  ensureAgentImage(image: string): Promise<void>;
  containerExists(id: string): Promise<boolean>;
  writeFile(containerId: string, destPath: string, content: string, mode?: number): Promise<void>;
}

export interface SecretsPort {
  decrypt(filename: string): Promise<DecryptedSecret>;
  decryptMultiple(filenames: string[]): Promise<Map<string, string>>;
  encrypt(name: string, plaintext: string): Promise<string>;
  saveEncrypted(name: string, plaintext: string): Promise<void>;
  listSecrets(): Promise<SecretInfo[]>;
  deleteSecret(name: string): Promise<void>;
  secretExists(name: string): Promise<boolean>;
}

export interface SessionRepository {
  save(s: AgentSession): Promise<void>;
  get(id: string): Promise<AgentSession | null>;
  list(): Promise<AgentSession[]>;
  delete(id: string): Promise<void>;
}

export interface SessionEventLog {
  append(id: string, event: SessionEvent, cap: number): Promise<void>;
  read(id: string): Promise<SessionEvent[]>;
  delete(id: string): Promise<void>;
}

export interface ConnectorRepository {
  list(): Promise<Connector[]>;
  save(list: Connector[]): Promise<void>;
}

export interface ProviderRepository {
  list(): Promise<ProviderConfig[]>;
  get(id: string): Promise<ProviderConfig | null>;
  save(list: ProviderConfig[]): Promise<void>;
}
