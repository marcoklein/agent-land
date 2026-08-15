import Docker from "dockerode";
import { execFile } from "child_process";
import { promisify } from "util";
import type { DockerPort, InteractiveExec } from "../core/ports.js";

const execFileAsync = promisify(execFile);

export const SESSION_VOLUME_NAME = "agent-land-sessions";

export interface InteractiveContainerOptions {
  id: string;
  envVars: Record<string, string>;
  image: string;
  sessionVolume: string;
}

export class DockerService implements DockerPort {
  private docker: Docker;

  constructor(socketPath?: string) {
    this.docker = new Docker({
      socketPath: socketPath || process.env.DOCKER_SOCKET || "/var/run/docker.sock",
    });
  }

  async ensureAgentImage(image: string): Promise<void> {
    try {
      await this.docker.getImage(image).inspect();
    } catch {
      await execFileAsync("docker", ["build", "/agent-image", "-t", image], {
        timeout: 300_000,
      });
    }
  }

  async removeContainer(id: string): Promise<void> {
    const container = this.docker.getContainer(id);
    await container.remove({ force: true }).catch(() => {});
  }

  async createInteractiveContainer(options: InteractiveContainerOptions): Promise<Docker.Container> {
    const env = Object.entries(options.envVars).map(([k, v]) => `${k}=${v}`);

    const container = await this.docker.createContainer({
      name: `agent-land-pi-${options.id}`,
      Image: options.image,
      Entrypoint: ["/bin/sleep"],
      Cmd: ["infinity"],
      Labels: {
        app: "agent-land",
        "agent-land/interactive": "true",
        "agent-land/session-id": options.id,
      },
      Env: [
        ...env,
        `PI_OFFLINE=1`,
        `PI_SKIP_VERSION_CHECK=1`,
        `PI_CODING_AGENT_SESSION_DIR=/sessions`,
        `PI_CODING_AGENT_DIR=/tmp/pi-config`,
      ],
      HostConfig: {
        AutoRemove: false,
        Binds: [`${options.sessionVolume}:/sessions`],
        NetworkMode: "bridge",
      },
      WorkingDir: "/workspace",
    });

    await container.start();
    return container;
  }

  async execInteractive(containerId: string, args: string[], tty: boolean): Promise<InteractiveExec> {
    const container = this.docker.getContainer(containerId);
    const exec = await container.exec({
      Cmd: args,
      Tty: tty,
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
    });

    const stream = await new Promise<NodeJS.ReadWriteStream>((resolve, reject) => {
      exec.start({ hijack: true, stdin: true, Tty: tty }, (err, s) => {
        if (err) reject(err);
        else resolve(s as NodeJS.ReadWriteStream);
      });
    });

    return {
      stream,
      resize: async (h: number, w: number) => {
        await exec.resize({ h, w }).catch(() => {});
      },
    };
  }
}
