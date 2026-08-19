import type { ProviderService } from "../core/provider-service.js";
import type { ProviderConfig } from "../core/types.js";
import { exchangeCopilotToken, buildCopilotSecretYaml } from "./copilot-auth.js";

export async function createCopilotProvider(
  providerService: ProviderService,
  githubToken: string
): Promise<ProviderConfig> {
  const copilot = await exchangeCopilotToken(githubToken);
  const yaml = buildCopilotSecretYaml(copilot, githubToken);

  const existing = await providerService.get("github-copilot");
  if (existing) {
    await providerService.delete("github-copilot");
  }
  return providerService.create({
    id: "github-copilot",
    kind: "oauth",
    defaultModel: "claude-haiku-4.5",
    secretContent: yaml,
  });
}
