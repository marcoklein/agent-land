import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ConnectorService } from "../core/connector-service.js";
import { JsonConnectorRepository } from "../infra/repositories.js";
import { SopsService } from "../infra/sops.js";
import { setupDataDir, cleanupDataDir, getDataDir } from "./helpers/setup.js";
import { getConfig } from "../config.js";

const config = getConfig();

describe("ConnectorService", () => {
  beforeAll(async () => {
    await setupDataDir();
  });

  afterAll(async () => {
    await cleanupDataDir();
  });

  it("persists every connector when creates race", async () => {
    const repo = new JsonConnectorRepository(getDataDir());
    const sops = new SopsService(config.secretsDir, config.ageKeyFile);
    const service = new ConnectorService(repo, sops);

    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        service.create({
          name: `Connector ${i}`,
          url: "https://example.com",
          content: "KEY: value",
        })
      )
    );

    const list = await service.list();
    expect(list).toHaveLength(10);
  });
});
