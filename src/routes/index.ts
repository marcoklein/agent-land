import { Router } from "express";
import { getConfig } from "../config.js";

const config = getConfig();

export function indexRouter() {
  const router = Router();

  router.get("/", async (req, res) => {
    const connectorCount = await getConnectorCount();
    const runs = await getRecentRuns();
    res.render("layout", {
      view: "home",
      currentPage: "home",
      runCount: runs.length,
      runningCount: runs.filter((r: any) => r.status === "running").length,
      connectorCount,
      recentRuns: runs.slice(0, 5),
    });
  });

  return router;
}

async function getConnectorCount(): Promise<number> {
  try {
    const { readFile } = await import("fs/promises");
    const content = await readFile(`${config.dataDir}/connectors.json`, "utf-8");
    return JSON.parse(content).length;
  } catch {
    return 0;
  }
}

async function getRecentRuns(): Promise<any[]> {
  try {
    const { readdir, readFile } = await import("fs/promises");
    const path = await import("path");
    const runsDir = path.join(config.dataDir, "runs");
    const files = await readdir(runsDir);
    const runs: any[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const content = await readFile(path.join(runsDir, file), "utf-8");
      runs.push(JSON.parse(content));
    }
    return runs.sort(
      (a: any, b: any) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    );
  } catch {
    return [];
  }
}
