import { describe, it, expect, vi } from "vitest";
import { ModelCatalog } from "../infra/model-catalog.js";
import type { ProviderService } from "../core/provider-service.js";
import type { SecretsPort } from "../core/ports.js";
import type { ProviderConfig } from "../core/types.js";

function catalogWith(get: (id: string) => Promise<ProviderConfig | null>) {
  const providers = { get } as unknown as ProviderService;
  const secrets = {} as unknown as SecretsPort;
  return new ModelCatalog(providers, secrets);
}

function customProvider(models?: string[]): ProviderConfig {
  return { id: "p", enabled: true, models };
}

describe("ModelCatalog caching", () => {
  it("does not cache an empty discovery result", async () => {
    const provider = customProvider(undefined);
    const get = vi.fn(async () => provider);
    const catalog = catalogWith(get);

    await expect(catalog.getModels("p")).resolves.toEqual([]);
    expect(get).toHaveBeenCalledTimes(1);

    provider.models = ["m1"];
    await expect(catalog.getModels("p")).resolves.toEqual(["m1"]);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("caches a non-empty discovery result", async () => {
    const provider = customProvider(["m1", "m2"]);
    const get = vi.fn(async () => provider);
    const catalog = catalogWith(get);

    await expect(catalog.getModels("p")).resolves.toEqual(["m1", "m2"]);
    await expect(catalog.getModels("p")).resolves.toEqual(["m1", "m2"]);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("does not overwrite a cached non-empty result with an empty one", async () => {
    const provider = customProvider(["m1"]);
    const get = vi.fn(async () => provider);
    const catalog = catalogWith(get);

    await expect(catalog.getModels("p")).resolves.toEqual(["m1"]);

    provider.models = undefined;
    await expect(catalog.getModels("p")).resolves.toEqual(["m1"]);
    expect(get).toHaveBeenCalledTimes(1);
  });
});