import type Docker from "dockerode";
import type { AgentSession, Connector, DecryptedSecret, SecretInfo } from "./types.js";

export interface InteractiveExec {
  stream: NodeJS.ReadWriteStream;
  resize(h: number, w: number): Promise<void>;
}

export interface DockerPort {
  createInteractiveContainer(opts: {
    id: string;
    envVars: Record<string, string>;
    image: string;
    sessionVolume: string;
  }): Promise<Docker.Container>;
  execInteractive(containerId: string, args: string[], tty: boolean): Promise<InteractiveExec>;
  removeContainer(id: string): Promise<void>;
  ensureAgentImage(image: string): Promise<void>;
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

export interface ConnectorRepository {
  list(): Promise<Connector[]>;
  save(list: Connector[]): Promise<void>;
}
