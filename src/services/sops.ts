import { execFile } from "child_process";
import { readdir, stat, unlink, readFile, writeFile } from "fs/promises";
import path from "path";
import os from "os";
import { SecretInfo, DecryptedSecret } from "../types.js";

export class SopsService {
  constructor(
    private secretsDir: string,
    private ageKeyFile: string
  ) {}

  async listSecrets(): Promise<SecretInfo[]> {
    const files = await readdir(this.secretsDir).catch(() => [] as string[]);
    const secrets: SecretInfo[] = [];

    for (const file of files) {
      if (!file.endsWith(".yaml") && !file.endsWith(".yml")) continue;
      if (file.startsWith(".")) continue;
      const filePath = path.join(this.secretsDir, file);
      const stats = await stat(filePath);
      secrets.push({
        name: file.replace(/\.(ya?ml)$/, ""),
        filename: file,
        size: stats.size,
        modifiedAt: stats.mtime.toISOString(),
      });
    }

    return secrets;
  }

  async encrypt(name: string, plaintext: string): Promise<string> {
    const sopsYamlPath = path.join(this.secretsDir, ".sops.yaml");
    const sopsConfig = await readFile(sopsYamlPath, "utf-8");
    const match = sopsConfig.match(/age:\s*(?:>[-|]?\s*)?(age1\S+)/m);
    if (!match) throw new Error("Could not find age public key in .sops.yaml");

    const agePublicKey = match[1];
    const tmpPath = path.join(os.tmpdir(), `sops-${name}-${Date.now()}.yaml`);
    await writeFile(tmpPath, plaintext);

    return new Promise((resolve, reject) => {
      const child = execFile(
        "sops",
        [
          "--encrypt",
          "--age", agePublicKey,
          "--input-type", "yaml",
          "--output-type", "yaml",
          tmpPath,
        ],
        { env: { ...process.env, SOPS_AGE_KEY_FILE: this.ageKeyFile } },
        async (err, stdout) => {
          await unlink(tmpPath).catch(() => {});
          if (err) return reject(new Error(`SOPS encrypt failed: ${err.message}`));
          resolve(stdout);
        }
      );

      child.on("error", async () => {
        await unlink(tmpPath).catch(() => {});
        reject(new Error("SOPS encrypt process failed to start"));
      });
    });
  }

  async saveEncrypted(name: string, plaintext: string): Promise<void> {
    const encrypted = await this.encrypt(name, plaintext);
    const filePath = path.join(this.secretsDir, `${name}.yaml`);
    const { writeFile } = await import("fs/promises");
    await writeFile(filePath, encrypted);
  }

  async decrypt(filename: string): Promise<DecryptedSecret> {
    const filePath = path.join(this.secretsDir, filename);

    return new Promise((resolve, reject) => {
      execFile(
        "sops",
        ["--decrypt", "--input-type", "yaml", "--output-type", "yaml", filePath],
        { env: { ...process.env, SOPS_AGE_KEY_FILE: this.ageKeyFile } },
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
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const colonIdx = trimmed.indexOf(":");
        if (colonIdx === -1) continue;
        const key = trimmed.substring(0, colonIdx).trim();
        const value = trimmed.substring(colonIdx + 1).trim();
        if (key && value) envMap.set(key, value);
      }
    }
    return envMap;
  }

  async deleteSecret(name: string): Promise<void> {
    const filePath = path.join(this.secretsDir, `${name}.yaml`);
    await unlink(filePath);
  }

  async secretExists(name: string): Promise<boolean> {
    const filePath = path.join(this.secretsDir, `${name}.yaml`);
    try {
      await stat(filePath);
      return true;
    } catch {
      return false;
    }
  }
}
