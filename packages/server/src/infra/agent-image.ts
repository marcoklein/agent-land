import { createHash } from "crypto";
import { readdir, readFile } from "fs/promises";
import path from "path";

/**
 * Derives a deterministic image tag from the contents of the agent-image
 * directory, so a change to the runner (or any other baked-in file) yields a
 * new tag that `ensureAgentImage` will build instead of reusing a stale one.
 */
export async function computeAgentImageTag(
  imageDir: string,
  base = "agent-land-pi"
): Promise<string> {
  const files: string[] = [];

  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        files.push(full);
      }
    }
  };
  await walk(imageDir);

  const hash = createHash("sha256");
  for (const file of files.sort()) {
    const rel = path.relative(imageDir, file);
    hash.update(rel);
    hash.update("\0");
    hash.update(await readFile(file));
    hash.update("\0");
  }

  return `${base}:${hash.digest("hex").slice(0, 12)}`;
}
