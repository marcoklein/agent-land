import Docker from "dockerode";
import { execFile } from "child_process";
import { promisify } from "util";
import { PassThrough } from "stream";
import tar from "tar-stream";
import type { DockerPort, ExecResult, InteractiveExec } from "../core/ports.js";
import { agentContainerId } from "../core/harness.js";

const execFileAsync = promisify(execFile);

export const SESSION_VOLUME_NAME = "agent-land-sessions";

export const AGENT_CONTAINER_LIMITS = {
  memoryBytes: 4 * 1024 ** 3,
  nanoCpus: 2_000_000_000,
  pidsLimit: 512,
} as const;

const EXEC_COMMAND_TIMEOUT_MS = 120_000;

export interface InteractiveContainerOptions {
  id: string;
  envVars: Record<string, string>;
  image: string;
  sessionVolume: string;
  workspaceVolume: string;
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
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode !== 404) throw err;
      try {
        await execFileAsync("docker", ["build", "/agent-image", "-t", image], {
          timeout: 300_000,
        });
      } catch (buildErr) {
        const message = buildErr instanceof Error ? buildErr.message : String(buildErr);
        throw new Error(`Agent image build failed: ${message}`);
      }
    }
  }

  async removeContainer(id: string): Promise<void> {
    const container = this.docker.getContainer(id);
    await container.remove({ force: true }).catch(() => {});
  }

  async containerExists(id: string): Promise<boolean> {
    try {
      await this.docker.getContainer(id).inspect();
      return true;
    } catch {
      return false;
    }
  }

  async writeFile(containerId: string, destPath: string, content: string, mode = 0o644): Promise<void> {
    const sep = destPath.lastIndexOf("/");
    if (sep <= 0) {
      throw new Error(`Invalid destination path: ${destPath}`);
    }
    const dir = destPath.slice(0, sep);
    const name = destPath.slice(sep + 1);
    if (name.length === 0 || name.includes("/")) {
      throw new Error(`Invalid destination path: ${destPath}`);
    }

    const container = this.docker.getContainer(containerId);
    const pack = tar.pack();
    await new Promise<void>((resolve, reject) => {
      pack.entry({ name, mode, mtime: new Date(0) }, content, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
    pack.finalize();

    await container.putArchive(pack, { path: dir });
  }

  async removeVolume(name: string): Promise<void> {
    const volume = this.docker.getVolume(name);
    await volume.remove().catch(() => {});
  }

  async execCommand(containerId: string, args: string[]): Promise<ExecResult> {
    const container = this.docker.getContainer(containerId);
    const exec = await container.exec({
      Cmd: args,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
    });

    const { stream, stdoutStream, stderrStream } = await new Promise<{
      stream: NodeJS.ReadWriteStream;
      stdoutStream: PassThrough;
      stderrStream: PassThrough;
    }>((resolve, reject) => {
      exec.start({ hijack: true, stdin: false }, (err, s) => {
        if (err) return reject(err);
        const stdoutStream = new PassThrough();
        const stderrStream = new PassThrough();
        container.modem.demuxStream(s, stdoutStream, stderrStream);
        resolve({ stream: s as NodeJS.ReadWriteStream, stdoutStream, stderrStream });
      });
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    stdoutStream.on("data", (c: Buffer) => stdoutChunks.push(c));
    stderrStream.on("data", (c: Buffer) => stderrChunks.push(c));

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`exec timed out after ${EXEC_COMMAND_TIMEOUT_MS}ms: docker exec ${args[0]}`)),
        EXEC_COMMAND_TIMEOUT_MS
      );
      const onEnd = () => {
        clearTimeout(timer);
        stream.off("error", onError);
        resolve();
      };
      const onError = (err: Error) => {
        clearTimeout(timer);
        stream.off("end", onEnd);
        reject(new Error(`docker exec stream error: ${err.message}`));
      };
      stream.on("end", onEnd);
      stream.on("error", onError);
    });

    const info = await exec.inspect();
    return {
      exitCode: typeof info.ExitCode === "number" ? info.ExitCode : -1,
      stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
      stderr: Buffer.concat(stderrChunks).toString("utf-8"),
    };
  }

  async createInteractiveContainer(options: InteractiveContainerOptions): Promise<Docker.Container> {
    const env = Object.entries(options.envVars).map(([k, v]) => `${k}=${v}`);

    const container = await this.docker.createContainer({
      name: agentContainerId(options.id),
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
        Binds: [
          `${options.sessionVolume}:/sessions`,
          `${options.workspaceVolume}:/workspace`,
        ],
        NetworkMode: "bridge",
        Memory: AGENT_CONTAINER_LIMITS.memoryBytes,
        MemorySwap: AGENT_CONTAINER_LIMITS.memoryBytes,
        NanoCpus: AGENT_CONTAINER_LIMITS.nanoCpus,
        PidsLimit: AGENT_CONTAINER_LIMITS.pidsLimit,
        CapDrop: ["ALL"],
        SecurityOpt: ["no-new-privileges"],
      },
      WorkingDir: "/workspace",
    });

    try {
      await container.start();
    } catch (err) {
      await container.remove({ force: true }).catch(() => {});
      await this.docker.getVolume(options.workspaceVolume).remove().catch(() => {});
      throw err;
    }
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
