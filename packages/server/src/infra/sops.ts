import { execFile } from "child_process";
import { readdir, stat, unlink, readFile, writeFile } from "fs/promises";
import path from "path";
import os from "os";
import { parse as parseYaml } from "yaml";
import type { SecretsPort } from "../core/ports.js";
import type { SecretInfo, DecryptedSecret } from "../core/types.js";

const SOPS_TIMEOUT_MS = 30_000;

export function extractAgePublicKey(sopsConfig: string): string {
  const match = sopsConfig.match(/^\s*(?:-\s*)?age:\s*(?:>[-|]?\s*)?(age1\S+)/m);
  if (!match) throw new Error("Could not find age public key in .sops.yaml");
  return match[1];
}

export function parseSecretYaml(content: string): Map<string, string> {
  let doc: unknown;
  try {
    doc = parseYaml(content);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`SOPS decrypted invalid YAML: ${message}`);
  }
  if (doc === null || doc === undefined) return new Map();
  if (typeof doc !== "object" || Array.isArray(doc)) {
    throw new Error("SOPS decrypted content is not a YAML mapping");
  }

  const envMap = new Map<string, string>();
  for (const [key, value] of Object.entries(doc as Record<string, unknown>)) {
    if (value === null || value === undefined) {
      throw new Error(`SOPS decrypted key "${key}" has no value`);
    }
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      throw new Error(`SOPS decrypted key "${key}" is not a scalar value`);
    }
    envMap.set(key, String(value));
  }
  return envMap;
}

export class SopsService implements SecretsPort {
  constructor(
    private secretsDir: string,
    private ageKeyFile: string
  ) {}

  private resolvePath(filename: string): string {
    if (path.isAbsolute(filename) || filename.split(path.sep).includes("..")) {
      throw new Error(`Invalid secret filename: ${filename}`);
    }
    const resolved = path.resolve(this.secretsDir, filename);
    if (path.dirname(resolved) !== path.resolve(this.secretsDir)) {
      throw new Error(`Invalid secret filename: ${filename}`);
    }
    return resolved;
  }

  async listSecrets(): Promise<SecretInfo[]> {
    const files = await readdir(this.secretsDir).catch(() => [] as string[]);
    const secrets: SecretInfo[] = [];

    for (const file of files) {
      if (!file.endsWith(".yaml") && !file.endsWith(".yml")) continue;
      if (file.startsWith(".")) continue;
      const filePath = path.join(this.secretsDir, file);
      try {
        const stats = await stat(filePath);
        secrets.push({
          name: file.replace(/\.(ya?ml)$/, ""),
          filename: file,
          size: stats.size,
          modifiedAt: stats.mtime.toISOString(),
        });
      } catch {
        continue;
      }
    }

    return secrets.sort((a, b) => a.name.localeCompare(b.name));
  }

  async encrypt(name: string, plaintext: string): Promise<string> {
    const sopsYamlPath = path.join(this.secretsDir, ".sops.yaml");
    const sopsConfig = await readFile(sopsYamlPath, "utf-8");
    const agePublicKey = extractAgePublicKey(sopsConfig);

    const tmpPath = path.join(os.tmpdir(), `sops-${name}-${Date.now()}.yaml`);
    await writeFile(tmpPath, plaintext, { mode: 0o600 });

    try {
      return await new Promise((resolve, reject) => {
        const child = execFile(
          "sops",
          [
            "--encrypt",
            "--age", agePublicKey,
            "--input-type", "yaml",
            "--output-type", "yaml",
            tmpPath,
          ],
          { env: { ...process.env, SOPS_AGE_KEY_FILE: this.ageKeyFile }, timeout: SOPS_TIMEOUT_MS },
          (err, stdout) => {
            if (err) return reject(new Error(`SOPS encrypt failed: ${err.message}`));
            resolve(stdout);
          }
        );

        child.on("error", () => {
          reject(new Error("SOPS encrypt process failed to start"));
        });
      });
    } finally {
      await unlink(tmpPath).catch(() => {});
    }
  }

  async saveEncrypted(name: string, plaintext: string): Promise<void> {
    const encrypted = await this.encrypt(name, plaintext);
    const filePath = path.join(this.secretsDir, `${name}.yaml`);
    await writeFile(filePath, encrypted);
  }

  async decrypt(filename: string): Promise<DecryptedSecret> {
    const filePath = this.resolvePath(filename);

    return new Promise((resolve, reject) => {
      execFile(
        "sops",
        ["--decrypt", "--input-type", "yaml", "--output-type", "yaml", filePath],
        { env: { ...process.env, SOPS_AGE_KEY_FILE: this.ageKeyFile }, timeout: SOPS_TIMEOUT_MS },
        (err, stdout) => {
          if (err) return reject(new Error(`SOPS decrypt failed: ${err.message}`));
          resolve({
            name: filename.replace(/\.(ya?ml)$/, ""),
            content: stdout,
          });
        }
      );
    });
  }

  async decryptMultiple(filenames: string[]): Promise<Map<string, string>> {
    const envMap = new Map<string, string>();
    for (const filename of filenames) {
      const { content } = await this.decrypt(filename);
      for (const [key, value] of parseSecretYaml(content)) {
        envMap.set(key, value);
      }
    }
    return envMap;
  }

  async deleteSecret(name: string): Promise<void> {
    const filePath = this.resolvePath(`${name}.yaml`);
    await unlink(filePath);
  }

  async secretExists(name: string): Promise<boolean> {
    const filePath = this.resolvePath(`${name}.yaml`);
    try {
      await stat(filePath);
      return true;
    } catch {
      return false;
    }
  }
}
