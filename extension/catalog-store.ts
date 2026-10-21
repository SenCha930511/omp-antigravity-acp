import fs from "node:fs";
import { writeJsonAtomic } from "./fs-atomic.ts";
import { resolveContextOptions, type ContextOptions, type ContextSettings } from "./context-settings.ts";
import { EFFORTS, projectCatalog, readModels, type AdvertisedModel, type PublicCatalogModel } from "./model-catalog.ts";
import { officialApiCost } from "./pricing.ts";
import { advertisedRecord, choices, selector } from "./selectors.ts";
import { TierConnection } from "./tier-connection.ts";
import type { SessionCleanup } from "./session-cleanup.ts";

export interface ConfiguredCatalogModel extends PublicCatalogModel {
  ompContextPolicy: ReturnType<typeof resolveContextOptions>;
}

export class CatalogStore {
  readonly upstreamModels = new Map<string, ConfiguredCatalogModel>();
  currentModels: ConfiguredCatalogModel[] = [];

  constructor(
    private readonly cachePath: string,
    private readonly cleanup: SessionCleanup,
    private readonly prepareRuntime: () => Promise<void>,
    private readonly fallbackModels: () => PublicCatalogModel[],
  ) {}

  projectWithSettings(models: PublicCatalogModel[], settings: ContextSettings): ConfiguredCatalogModel[] {
    return models.map(source => {
      const limits = resolveContextOptions(source, settings);
      const model: ConfiguredCatalogModel = {
        ...source,
        contextWindow: limits.contextWindow,
        maxTokens: limits.maxTokens,
        ompContextPolicy: limits,
        cost: officialApiCost(source.id) ?? source.cost,
      };
      const efforts = EFFORTS.filter(effort => model.thinkingLevelMap?.[effort]);
      if (efforts.length && !model.thinking) {
        model.thinking = { mode: "effort", efforts, defaultLevel: efforts.includes("high") ? "high" : efforts[0]! };
      }
      this.upstreamModels.set(model.id, model);
      return model;
    });
  }

  readCachedCatalog(): AdvertisedModel[] {
    try {
      const cache = JSON.parse(fs.readFileSync(this.cachePath, "utf8")) as { schemaVersion?: unknown; models?: unknown };
      if (cache.schemaVersion !== 1 && cache.schemaVersion !== 2) return [];
      return readModels(cache.models);
    } catch { return []; }
  }

  loadInitialOrCached(settings: ContextSettings): ConfiguredCatalogModel[] {
    const cached = this.readCachedCatalog();
    const base = cached.length ? projectCatalog(cached) : this.fallbackModels();
    this.currentModels = this.projectWithSettings(base, settings);
    return this.currentModels;
  }

  reconfigure(settings: ContextSettings): ConfiguredCatalogModel[] {
    this.currentModels = this.projectWithSettings(this.currentModels, settings);
    return this.currentModels;
  }

  async discoverModels(): Promise<AdvertisedModel[]> {
    await this.prepareRuntime();
    const connection = new TierConnection({ cwd: process.cwd(), ompCleanup: this.cleanup });
    let discoveredSession: string | undefined;
    try {
      await connection.initialize();
      const session = await connection.newSession(process.cwd());
      discoveredSession = session.sessionId;
      const modern = choices(selector(session, "model"));
      if (modern.length) {
        const models: AdvertisedModel[] = [];
        for (const option of modern) {
          // Model changes can alter reasoning choices; inspect each model's
          // confirmed configuration rather than sharing one global tier list.
          await connection.setModel(session.sessionId, option.value);
          models.push(advertisedRecord(connection.getSessionState(session.sessionId), option.value, option.name));
        }
        return models;
      }
      const models = readModels(session.models?.availableModels);
      if (!models.length) throw new Error("Antigravity did not advertise any models");
      return models;
    } finally {
      if (discoveredSession) connection.discardSession(discoveredSession);
      await connection.close();
    }
  }

  async refresh(settings: ContextSettings): Promise<ConfiguredCatalogModel[]> {
    const models = await this.discoverModels();
    this.upstreamModels.clear();
    const registered = this.projectWithSettings(projectCatalog(models), settings);
    this.currentModels = registered;
    writeJsonAtomic(this.cachePath, {
      schemaVersion: 2,
      discoveredAt: new Date().toISOString(),
      models,
    });
    return registered;
  }
}
