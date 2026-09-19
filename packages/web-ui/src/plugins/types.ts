import type { Router, Response } from "express";
import type { EngineApi } from "../engine-api.js";
import type { Config } from "../config.js";

export type RenderView = (
  res: Response,
  view: string,
  data: Record<string, unknown>
) => Promise<void>;

export interface WebUiPluginDeps {
  engine: EngineApi;
  config: Config;
  renderView: RenderView;
}

export interface WebUiPlugin {
  path: string;
  navLabel?: string;
  createRouter: (deps: WebUiPluginDeps) => Router;
}
