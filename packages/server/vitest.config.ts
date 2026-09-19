import { defineConfig } from "vitest/config";
import path from "path";
import { fileURLToPath } from "url";

const configDir = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(configDir, "src/__tests__/fixtures");

export default defineConfig({
  test: {
    globals: true,
    exclude: ["**/node_modules/**", "**/.git/**", "**/dist/**"],
    // Test files share DATA_DIR and the SOPS fixtures, so they must not run in parallel.
    fileParallelism: false,
    env: {
      SECRETS_DIR: path.join(fixturesDir, "secrets"),
      AGE_KEY_FILE: path.join(fixturesDir, ".age-key"),
      DATA_DIR: path.join(configDir, "src/__tests__/tmp-test-data"),
      OPENCODE_API_KEY: "test-key",
      SSE_HEARTBEAT_MS: "50",
    },
  },
});
