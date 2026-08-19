import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { AgentsApi } from "./helpers/agents-api.js";
import { setupDataDir, cleanupDataDir } from "./helpers/setup.js";
import { GitCloneProvisioner } from "../infra/git-clone-provisioner.js";
import { MockDockerPort } from "./helpers/setup.js";
import type { AgentSession } from "../core/types.js";

describe("Workspace provisioning", () => {
  const api = new AgentsApi();

  beforeEach(async () => {
    await setupDataDir();
    api.reset();
  });

  afterAll(async () => {
    await cleanupDataDir();
  });

  const repoUrl = "https://github.com/marcoklein/agent-land";
  const ref = "main";

  describe("POST /api/sessions with workspace", () => {
    it("binds a per-session workspace volume and provisions before starting the agent", async () => {
      const res = await api.agent.post("/api/sessions").send({
        workspace: { repoUrl, ref },
      });

      expect(res.status).toBe(201);
      const id = res.body.session.id;

      expect(api.mockDocker.created.length).toBe(1);
      expect(api.mockDocker.created[0].workspaceVolume).toBe(`agent-land-ws-${id}`);

      const commands = api.mockDocker.execs.map((e) => e.args);
      expect(commands).toEqual([
        ["git", "config", "--global", "user.name", "Test Bot"],
        ["git", "config", "--global", "user.email", "bot@test.local"],
        ["git", "clone", "--", repoUrl, "/workspace"],
        ["git", "-C", "/workspace", "checkout", "--", ref],
      ]);
      expect(commands.some((c) => c[0] === "gh")).toBe(false);

      expect(api.fakeHarness.handles.length).toBe(1);
    });

    it("persists the workspace on the session record", async () => {
      const res = await api.agent.post("/api/sessions").send({
        workspace: { repoUrl },
      });
      const id = res.body.session.id;

      const getRes = await api.agent.get(`/api/sessions/${id}`);
      expect(getRes.body.session.workspace).toEqual({ repoUrl });
    });

    it("skips checkout when no ref is given", async () => {
      const res = await api.agent.post("/api/sessions").send({
        workspace: { repoUrl },
      });
      expect(res.status).toBe(201);

      const commands = api.mockDocker.execs.map((e) => e.args);
      expect(commands.some((c) => c[0] === "git" && c[1] === "-C")).toBe(false);
    });

    it("cleans up container, volume, and session when provisioning fails", async () => {
      api.mockDocker.execCommandImpl = async (args) =>
        args[0] === "git" && args[1] === "clone"
          ? { exitCode: 128, stdout: "", stderr: "fatal: could not read from remote repository" }
          : { exitCode: 0, stdout: "", stderr: "" };

      const res = await api.agent.post("/api/sessions").send({
        workspace: { repoUrl },
      });

      expect(res.status).toBe(500);
      expect(res.body.error).toContain("Provisioning failed");

      const created = api.mockDocker.created[0];
      expect(api.mockDocker.removed).toContain(`mock-${created.id}`);
      expect(api.mockDocker.removedVolumes).toContain(`agent-land-ws-${created.id}`);
      expect(api.fakeHarness.handles.length).toBe(0);

      const listRes = await api.agent.get("/api/sessions");
      const ids = listRes.body.sessions.map((s: { id: string }) => s.id);
      expect(ids).not.toContain(created.id);
    });

    it("rejects malformed workspace with 400", async () => {
      const res = await api.agent.post("/api/sessions").send({ workspace: { ref: "main" } });
      expect(res.status).toBe(400);
      expect(api.mockDocker.created.length).toBe(0);
    });
  });

  describe("POST /agents/run with workspace fields", () => {
    it("passes repoUrl and ref from the launch form into the session", async () => {
      const res = await api.launch({ task: "work", repoUrl, ref });

      expect(res.status).toBe(302);
      const id = api.getSessionIdFromRedirect(res);

      const getRes = await api.agent.get(`/api/sessions/${id}`);
      expect(getRes.body.session.workspace).toEqual({ repoUrl, ref });
    });
  });

  describe("GET /agents/new", () => {
    it("renders workspace fields", async () => {
      const res = await api.openNew();
      expect(res.status).toBe(200);
      expect(res.text).toContain('id="repoUrl"');
      expect(res.text).toContain('id="ref"');
    });
  });

  describe("GitCloneProvisioner — gh wiring", () => {
    function sessionWithWorkspace(): AgentSession {
      return {
        id: "test1",
        status: "idle",
        permissionPolicy: "auto",
        sessionDir: "/sessions/test1",
        connectors: [],
        model: "test-model",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        workspace: { repoUrl },
      };
    }

    it("runs gh auth setup-git between git config and clone when GITHUB_TOKEN is present", async () => {
      const mock = new MockDockerPort();
      const provisioner = new GitCloneProvisioner(mock, {
        gitUserName: "Test Bot",
        gitUserEmail: "bot@test.local",
      });

      await provisioner.provision(sessionWithWorkspace(), "container-1", {
        GITHUB_TOKEN: "ghp_test",
      });

      const commands = mock.execs.map((e) => e.args);
      const ghIndex = commands.findIndex((c) => c[0] === "gh");
      expect(ghIndex).toBeGreaterThan(-1);
      expect(commands[ghIndex]).toEqual(["gh", "auth", "setup-git"]);
      expect(ghIndex).toBeGreaterThan(
        commands.findIndex((c) => c[0] === "git" && c[1] === "config")
      );
      expect(ghIndex).toBeLessThan(
        commands.findIndex((c) => c[0] === "git" && c[1] === "clone")
      );
    });

    it("does not touch gh when no GITHUB_TOKEN is present", async () => {
      const mock = new MockDockerPort();
      const provisioner = new GitCloneProvisioner(mock, {
        gitUserName: "Test Bot",
        gitUserEmail: "bot@test.local",
      });

      await provisioner.provision(sessionWithWorkspace(), "container-1", {});

      expect(mock.execs.some((e) => e.args[0] === "gh")).toBe(false);
    });
  });
});
