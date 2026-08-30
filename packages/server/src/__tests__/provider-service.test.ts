import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ProviderService, DuplicateProviderError } from "../core/provider-service.js";
import { JsonProviderRepository } from "../infra/repositories.js";
import { SopsService } from "../infra/sops.js";
import { setupDataDir, cleanupDataDir, getDataDir } from "./helpers/setup.js";
import { getConfig } from "../config.js";
import { writeFile } from "fs/promises";
import path from "path";

const config = getConfig();

describe("ProviderService", () => {
  beforeAll(async () => {
    await setupDataDir();
  });

  afterAll(async () => {
    await cleanupDataDir();
  });

  async function makeService() {
    const repo = new JsonProviderRepository(getDataDir());
    const sops = new SopsService(config.secretsDir, config.ageKeyFile);
    await writeFile(path.join(getDataDir(), "providers.json"), "[]");
    return { repo, sops, service: new ProviderService(repo, sops) };
  }

  it("creates a provider with a secret", async () => {
    const { service } = await makeService();
    const provider = await service.create({
      id: "mistral",
      secretFields: { MISTRAL_API_KEY: "sk-test" },
    });

    expect(provider.id).toBe("mistral");
    expect(provider.secretFile).toBe("provider-mistral.yaml");
    expect(provider.enabled).toBe(true);
  });

  it("rejects a duplicate provider id", async () => {
    const { service } = await makeService();
    await service.create({ id: "mistral", secretFields: { MISTRAL_API_KEY: "sk" } });
    await expect(
      service.create({ id: "mistral", secretFields: { MISTRAL_API_KEY: "sk" } })
    ).rejects.toBeInstanceOf(DuplicateProviderError);
  });

  it("creates a provider with models and baseUrl", async () => {
    const { service } = await makeService();
    const provider = await service.create({
      id: "qwencloud",
      baseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/apps/anthropic",
      api: "anthropic-messages",
      models: ["qwen3.8-max"],
      secretFields: { QWENCLOUD_API_KEY: "sk" },
    });
    expect(provider.api).toBe("anthropic-messages");
    expect(provider.models).toEqual(["qwen3.8-max"]);
    expect(provider.secretFile).toBe("provider-qwencloud.yaml");
  });

  it("creates a provider without a secret", async () => {
    const { service } = await makeService();
    const provider = await service.create({
      id: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      api: "openai-completions",
    });
    expect(provider.id).toBe("openrouter");
    expect(provider.secretFile).toBeUndefined();
  });

  it("toggles enabled and filters listEnabled", async () => {
    const { service } = await makeService();
    await service.create({ id: "mistral", secretFields: { MISTRAL_API_KEY: "sk" } });
    await service.create({ id: "deepseek", secretFields: { DEEPSEEK_API_KEY: "sk" } });

    await service.setEnabled("mistral", false);

    const enabled = await service.listEnabled();
    expect(enabled.map((p) => p.id)).toEqual(["deepseek"]);
  });

  it("deletes a provider and its secret", async () => {
    const { service, sops } = await makeService();
    await service.create({ id: "mistral", secretFields: { MISTRAL_API_KEY: "sk" } });

    const deleted = await service.delete("mistral");
    expect(deleted).toBe(true);

    expect(await service.get("mistral")).toBeNull();
    await expect(sops.secretExists("provider-mistral")).resolves.toBe(false);
  });

  it("returns false when deleting a provider that does not exist", async () => {
    const { service } = await makeService();
    await expect(service.delete("nope")).resolves.toBe(false);
  });
});