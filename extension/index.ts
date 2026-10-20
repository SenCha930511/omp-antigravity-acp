// OMP 18.x adapter for pi-antigravity-acp-provider 0.1.15 (Pi 1.1 API).
// Keep upstream code intact; translate only the provider registration contract.
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { officialApiCost, applyApiCostEstimate } from "./pricing.ts";
import { SessionRuntimePool } from "./runtime-pool.ts";
import { stableTools } from "./tool-order.ts";
import { EFFORTS, projectCatalog, readModels, selectRuntimeModel } from "./model-catalog.ts";
import { advertisedRecord, choices, selector } from "./selectors.ts";
import { TOOL_ROUTING, parseNativeToolMode } from "./tool-routing.ts";
import { loadNativeToolMode, loadToolPolicy, saveNativeToolMode, saveDebugToolUpdates } from "./tool-policy.ts";
import { Type, createAntigravityProvider, AntigravityRuntime, PERMISSION_TOOL_NAME, PERMISSION_RESULT_KIND, loadConfig, savePermissionMode, inspectAntigravityAuth, hasAntigravityAuth, AcpSessionStore, ensureAntigravityAcpReady, TierConnection, planToolProjection, PiEventWriter } from "./runtime.mjs";

const MARKER = "pi-antigravity-acp:managed-by-antigravity";

function authReady() {
  if (hasAntigravityAuth()) return true;
  if (process.platform !== "darwin") return false;
  try {
    // Check existence only. Never retrieve credentials from the keychain.
    execFileSync("/usr/bin/security", ["find-generic-password", "-s", "gemini", "-a", "antigravity-acp"], { stdio: "ignore", timeout: 3000 });
    return true;
  } catch { return false; }
}

export default async function (pi: any) {
  return registerOmpAdapter(pi, path.join(os.homedir(), ".omp/agent/antigravity-acp-provider"));
}

// Explicit state injection keeps command integration tests away from user data.
export async function registerOmpAdapter(pi: any, stateDir: string) {
  const configPath = path.join(stateDir, "config.json");
  const cachePath = path.join(stateDir, "models-cache.json");
  const toolPolicyPath = path.join(stateDir, "omp-tools.json");
  // Loading this global extension must not start ACP or query Google.
  let readiness: Promise<void> | undefined;
  function prepareRuntime() {
    readiness ??= ensureAntigravityAcpReady().catch((error: unknown) => {
      readiness = undefined;
      throw error;
    });
    return readiness;
  }
  const connections = new Set<any>();
  const idleTimeoutMs = Number(process.env.OMP_ACP_IDLE_TIMEOUT_MS ?? 300_000);
  if (!Number.isSafeInteger(idleTimeoutMs) || idleTimeoutMs < 0 || (idleTimeoutMs > 0 && idleTimeoutMs < 1000)) {
    throw new Error("OMP_ACP_IDLE_TIMEOUT_MS must be 0 (disabled) or an integer of at least 1000");
  }
  let lastToolAudit: { offered: string[]; available: string[]; omitted: any[] } | undefined;
  const runtimes = new SessionRuntimePool(() => {
    const ownedConnections = new Set<any>();
    const runtime = new AntigravityRuntime((options: any) => {
      const policy = loadToolPolicy(toolPolicyPath);
      const connection = new TierConnection({ ...options, ompNativeTools: policy.nativeTools, ompDebugToolUpdates: policy.debugToolUpdates });
      connections.add(connection);
      ownedConnections.add(connection);
      void connection.process.exited.finally(() => connections.delete(connection));
      void connection.process.exited.finally(() => ownedConnections.delete(connection));
      return connection;
    }, loadConfig(configPath).permissions, new AcpSessionStore(path.join(stateDir, "sessions.json")));
    return { runtime, provider: createAntigravityProvider(runtime).provider,
      isBusy: () => [...ownedConnections].some(connection => connection.activePrompts > 0) };
  }, bundle => bundle.runtime.close(), { timeoutMs: idleTimeoutMs, canDispose: bundle => !bundle.isBusy() });
  const sessionIdOf = (ctx: any): string | undefined => ctx?.sessionManager?.getSessionId?.();
  pi.on("session_shutdown", async (_event: any, ctx: any) => {
    const sessionId = sessionIdOf(ctx);
    if (sessionId) {
      await Promise.all([runtimes.close(sessionId), runtimes.close()]);
    } else {
      await runtimes.closeAll();
    }
  });
  pi.registerTool({
    name: PERMISSION_TOOL_NAME,
    label: "Antigravity ACP Permission",
    description: "Answer a pending Antigravity permission request.",
    parameters: Type.Object({ requestId: Type.String({ minLength: 1 }) }),
    async execute(_id: string, params: any, _signal: any, _update: any, ctx: any) {
      const request = runtimes.values().map(bundle => bundle.runtime.getPermission(params.requestId)).find(Boolean);
      if (!request) throw new Error("Permission request expired or missing");
      const labels = request.options.map((option: any) => option.label);
      const selected = await ctx.ui.select(request.title, labels);
      const optionId = request.options[labels.indexOf(selected)]?.id;
      return {
        content: [{ type: "text", text: optionId ? `Permission: ${selected}` : "Permission denied." }],
        details: { kind: PERMISSION_RESULT_KIND, requestId: request.id, optionId, cancelled: !optionId },
      };
    },
  });
  pi.registerCommand("antigravity-acp", {
    description: "Inspect ACP status/tools/usage, toggle debug (on|off), refresh models, set native-tools or permissions",
    async handler(args: string, ctx: any) {
      const [command, value] = args.trim().split(/\s+/);
      if (command === "debug") {
        if (value !== "on" && value !== "off") throw new Error("Usage: /antigravity-acp debug on|off");
        const enabled = value === "on";
        saveDebugToolUpdates(toolPolicyPath, enabled);
        for (const connection of connections) connection.debugToolUpdates = enabled;
        ctx.ui.notify(`ACP tool-status debug display: ${value}. Normal OMP tool results and thought summaries are preserved.`, "info");
        return;
      }
      if (command === "native-tools") {
        const mode = parseNativeToolMode(value);
        await runtimes.closeAll();
        saveNativeToolMode(toolPolicyPath, mode);
        ctx.ui.notify(`Native tools: ${mode}. ACP connections will be recreated on the next request with the new policy.`, "info");
        return;
      }
      const { runtime } = runtimes.get(sessionIdOf(ctx));
      if (command === "usage") {
        ctx.ui.notify(JSON.stringify([...connections].map(connection => ({
          context: [...connection.contextUsage.values()],
          accounting: [...connection.usageStatus.values()],
          activePrompts: connection.activePrompts,
        })), null, 2), "info");
        return;
      }
      if (command === "refresh") {
        initialModels = await refreshCatalog();
        adapted.registerProvider();
        ctx.ui.notify(`Refreshed ACP model cache: ${initialModels.map((model: any) => model.id).join(", ")}`, "info");
        return;
      }
      if (command === "permissions" && ["default", "auto-edit", "yolo"].includes(value)) {
        const mode = value.replace("-", "_");
        await Promise.all(runtimes.values().map(bundle => bundle.runtime.setPermissionMode(mode as any)));
        savePermissionMode(mode as any, configPath);
      }
      const snapshot = await runtime.snapshot();
      if (command === "tools") {
        ctx.ui.notify(lastToolAudit
          ? `OMP ACP tool bridge\nAvailable: ${lastToolAudit.available.join(", ")}\nOmitted: ${JSON.stringify(lastToolAudit.omitted)}\nLive ACP checks: ${JSON.stringify(snapshot.processes.map((item: any) => ({ mcpHttp: item.mcpHttp, omittedTools: item.omittedTools })))}`
          : "No model request yet. Send a message with this ACP model to inspect its offered OMP tools.", "info");
        return;
      }
      ctx.ui.notify(`Antigravity ACP (OMP adapter)\nAuth storage: ${authReady() ? "configured (ACP-owned token file or macOS keychain)" : inspectAntigravityAuth().status}\nPermissions: ${snapshot.permissionMode}\nNative tools: ${loadNativeToolMode(toolPolicyPath)}\nDebug tool updates: ${loadToolPolicy(toolPolicyPath).debugToolUpdates ? "on" : "off"}\nTool routing: ${JSON.stringify([...connections].map(connection => connection.toolRouting).filter(Boolean))}\nActive sessions: ${snapshot.bindings}\nConfirmed thinking: ${JSON.stringify([...connections].map(connection => connection.confirmedThinking).filter(Boolean))}\nUsage: ${JSON.stringify(snapshot.metrics)}\n${JSON.stringify(snapshot.processes)}`, "info");
    },
  });
  const upstreamModels = new Map<string, any>();
  function catalog(models: any[]) {
    return models.map(source => {
      const model = { ...source, cost: officialApiCost(source.id) ?? source.cost };
      const efforts = EFFORTS.filter(effort => model.thinkingLevelMap?.[effort]);
      if (efforts.length && !model.thinking) {
        model.thinking = { mode: "effort", efforts, defaultLevel: efforts.includes("high") ? "high" : efforts[0] };
      }
      upstreamModels.set(model.id, model);
      return model;
    });
  }
  function readCachedCatalog() {
    try {
      const cache = JSON.parse(fs.readFileSync(cachePath, "utf8"));
      if (![1, 2].includes(cache.schemaVersion)) return [];
      return readModels(cache.models);
    } catch { return []; }
  }
  async function discoverModels() {
    await prepareRuntime();
    const connection = new TierConnection({ cwd: process.cwd() });
    try {
      await connection.initialize();
      const session = await connection.newSession(process.cwd());
      const modern = choices(selector(session, "model"));
      if (modern.length) {
        const models = [];
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
      await connection.close();
    }
  }
  async function refreshCatalog() {
    const models = await discoverModels();
    upstreamModels.clear();
    const registered = catalog(projectCatalog(models));
    const cache = { schemaVersion: 2, discoveredAt: new Date().toISOString(), models };
    fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    const temporary = `${cachePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(cache, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, cachePath);
    return registered;
  }
  const cached = readCachedCatalog();
  let initialModels = catalog(cached.length ? projectCatalog(cached) : runtimes.get().provider.getModels());

  const adapted = new Proxy(pi, {
    get(target, key) {
      if (key !== "registerProvider") {
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      }
      return () => target.registerProvider("antigravity-acp", {
        api: "antigravity-acp",
        baseUrl: "acp://antigravity",
        // This is a non-secret marker. Google tokens remain in ACP storage.
        apiKey: MARKER,
        models: initialModels,
        async fetchDynamicModels() {
          // OMP may call this during startup, even for another provider.
          // Network discovery is reserved for explicit refresh or first ACP use.
          const cached = readCachedCatalog();
          return catalog(cached.length ? projectCatalog(cached) : runtimes.get().provider.getModels());
        },
        streamSimple(model: any, context: any, options: any) {
          const tools = stableTools(context.tools ?? []);
          const bridged = tools.filter((tool: any) => tool.name !== PERMISSION_TOOL_NAME);
          const omitted = planToolProjection(tools);
          const omittedNames = new Set(omitted.map((tool: any) => tool.name));
          const available = bridged.filter((tool: any) => !omittedNames.has(tool.name));
          lastToolAudit = { offered: bridged.map((tool: any) => tool.name), available: available.map((tool: any) => tool.name), omitted };
          const routedContext = {
            ...context,
            tools,
            systemPrompt: `${context.systemPrompt ?? ""}\n\n${TOOL_ROUTING}\nOMP tool names: ${available.length ? available.map((tool: any) => `pi_${tool.name}`).join(", ") : "none currently available; report missing capabilities before proposing native operations"}`,
          };
          if (process.env.OMP_ACP_TRACE === "1") {
            console.error("[ACP tools]", JSON.stringify(lastToolAudit));
          }
          // OMP needs a stream synchronously. Defer runtime setup behind it so
          // loading/selecting/listing models performs no ACP process activity.
          const deferred = new PiEventWriter(model);
          void (async () => {
            try {
              if (options?.signal?.aborted) throw new Error("ACP request cancelled before startup");
              await prepareRuntime();
              if (options?.signal?.aborted) throw new Error("ACP request cancelled during startup");
              if (!upstreamModels.has(model.id)) await refreshCatalog();
              const original = upstreamModels.get(model.id);
              if (!original) throw new Error(`Antigravity model was not discovered: ${model.id}. Run /antigravity-acp refresh.`);
              const lease = runtimes.acquire(options?.sessionId);
              const { runtime, provider } = lease.value;
              try {
                const stream = provider.streamSimple(selectRuntimeModel(original, options?.reasoning), routedContext, options);
                for await (const event of stream) {
                  const message = event.message ?? event.partial;
                  if (message?.usage) applyApiCostEstimate(model.id, message.usage, message.timestamp ?? Date.now());
                  deferred.stream.push(event);
                }
                deferred.stream.end();
                if (process.env.OMP_ACP_TRACE === "1") {
                  const snapshot = await runtime.snapshot();
                  console.error("[ACP bridge]", JSON.stringify(snapshot.processes.map((item: any) => ({ mcpHttp: item.mcpHttp, omittedTools: item.omittedTools }))));
                }
              } finally { lease.release(); }
            } catch (error) {
              deferred.fail(error, options?.signal?.aborted === true);
            }
          })();
          return deferred.stream;
        },
        oauth: {
          name: "Google Antigravity (ACP)",
          async login(callbacks: any) {
            await prepareRuntime();
            return runtimes.get().provider.auth.oauth.login({
              signal: callbacks.signal,
              notify(event: any) {
                if (event.links?.length) {
                  for (const link of event.links) callbacks.onAuth({ url: link.url, instructions: event.message });
                } else callbacks.onProgress?.(event.message);
              },
              prompt: (request: any) => callbacks.onPrompt({ message: request.message, placeholder: request.placeholder }),
            });
          },
          refreshToken: (credentials: any) => runtimes.get().provider.auth.oauth.refresh(credentials),
          getApiKey: () => MARKER,
        },
      });
    },
  });
  adapted.registerProvider();
}
