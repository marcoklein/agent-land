import type { DockerPort, WorkspaceProvisioner } from "../core/ports.js";
import type { AgentSession } from "../core/types.js";

export interface GitCloneProvisionerOptions {
  gitUserName?: string;
  gitUserEmail?: string;
}

export class GitCloneProvisioner implements WorkspaceProvisioner {
  constructor(
    private docker: DockerPort,
    private opts: GitCloneProvisionerOptions = {}
  ) {}

  async provision(
    session: AgentSession,
    containerId: string,
    env: Record<string, string>
  ): Promise<void> {
    const workspace = session.workspace;
    if (!workspace) return;

    if (this.opts.gitUserName) {
      await this.run(containerId, ["git", "config", "--global", "user.name", this.opts.gitUserName]);
    }
    if (this.opts.gitUserEmail) {
      await this.run(containerId, ["git", "config", "--global", "user.email", this.opts.gitUserEmail]);
    }
    if (env.GITHUB_TOKEN) {
      await this.run(containerId, ["gh", "auth", "setup-git"]);
    }
    await this.run(containerId, ["git", "clone", "--", workspace.repoUrl, "/workspace"]);
    if (workspace.ref) {
      await this.run(containerId, ["git", "-C", "/workspace", "checkout", "--", workspace.ref]);
    }
  }

  private async run(containerId: string, args: string[]): Promise<void> {
    const result = await this.docker.execCommand(containerId, args);
    if (result.exitCode !== 0) {
      const detail = scrubCredentials(result.stderr || result.stdout).trim();
      throw new Error(
        `Provisioning failed: \`${args.join(" ")}\` exited with ${result.exitCode}${
          detail ? `: ${detail}` : ""
        }`
      );
    }
  }
}

function scrubCredentials(output: string): string {
  return output.replace(/(https?:\/\/)[^/@\s]+@/gi, "$1***@");
}
