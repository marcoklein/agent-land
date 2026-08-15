import { defineConfig } from "vitest/config";
import path from "path";

const fixturesDir = path.resolve("./src/__tests__/fixtures");

export default defineConfig({
  test: {
    globals: true,
    exclude: ["**/node_modules/**", "**/.git/**", "**/dist/**"],
    env: {
      SECRETS_DIR: path.join(fixturesDir, "secrets"),
      AGE_KEY_FILE: path.join(fixturesDir, ".age-key"),
      DATA_DIR: path.resolve("./src/__tests__/tmp-test-data"),
      SESSION_SECRET: "test-secret",
      OPENCODE_API_KEY: "test-key",
    },
  },
});
