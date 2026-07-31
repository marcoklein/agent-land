import Docker from "dockerode";
import { PassThrough, Transform } from "stream";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

interface RunAgentOptions {
  task: string;
  envVars: Record<string, string>;
  image: string;
  sessionVolume: string;
  agentRunId: string;
  model: string;
}

function demuxStream(): Transform {
  let buffer = Buffer.alloc(0);
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 8) {
        const streamType = buffer.readUInt8(0);
        const frameSize = buffer.readUInt32BE(4);
        if (buffer.length < 8 + frameSize) break;
        const payload = buffer.subarray(8, 8 + frameSize);
        buffer = buffer.subarray(8 + frameSize);
        if (streamType === 1 || streamType === 2) {
          this.push(payload);
        }
      }
      callback();
    },
  });
}

export class DockerService {
  private docker: Docker;

  constructor(socketPath?: string) {
    this.docker = new Docker({
      socketPath: socketPath || process.env.DOCKER_SOCKET || "/var/run/docker.sock",
    });
  }

  async createAndStartContainer(options: RunAgentOptions): Promise<Docker.Container> {
    const env = Object.entries(options.envVars).map(
      ([k, v]) => `${k}=${v}`
    );

    const container = await this.docker.createContainer({
      name: `agent-land-${options.agentRunId}`,
      Image: options.image,
      Labels: {
        "app": "agent-land",
        "agent-land/run-id": options.agentRunId,
      },
      Cmd: [
        "--mode", "json",
        "--print",
        "--provider", "opencode-go",
        "--model", options.model,
        "--session-dir", "/sessions",
        "--approve",
        options.task,
      ],
      Env: [
        ...env,
        `PI_OFFLINE=1`,
        `PI_SKIP_VERSION_CHECK=1`,
        `PI_CODING_AGENT_SESSION_DIR=/sessions`,
        `PI_CODING_AGENT_DIR=/tmp/pi-config`,
      ],
      HostConfig: {
        AutoRemove: false,
        Binds: [
          `${options.sessionVolume}:/sessions`,
        ],
        NetworkMode: "bridge",
      },
      WorkingDir: "/workspace",
    });

    await container.start();
    return container;
  }

  async streamLogs(containerId: string): Promise<NodeJS.ReadableStream> {
    const container = this.docker.getContainer(containerId);
    const rawStream = await container.logs({
      follow: true,
      stdout: true,
      stderr: true,
      timestamps: false,
    }) as NodeJS.ReadableStream;

    return rawStream.pipe(demuxStream());
  }

  async waitForExit(containerId: string): Promise<number> {
    const container = this.docker.getContainer(containerId);
    const result = await container.wait();
    return result.StatusCode;
  }

  async stopContainer(id: string): Promise<void> {
    const container = this.docker.getContainer(id);
    await container.stop().catch(() => {});
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
}
