// OMP 18.x adapter for pi-antigravity-acp-provider 0.1.15 (Pi 1.1 API).
// Keep upstream code intact; translate only the provider registration contract.
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { officialApiCost, applyApiCostEstimate } from "./pricing.ts";
import { SessionRuntimePool } from "./runtime-pool.ts";
import { Type, createAntigravityProvider, AntigravityRuntime, PERMISSION_TOOL_NAME, PERMISSION_RESULT_KIND, loadConfig, savePermissionMode, inspectAntigravityAuth, hasAntigravityAuth, projectModels, AcpSessionStore, ensureAntigravityAcpReady, TierConnection, planToolProjection, PiEventWriter } from "./runtime.mjs";

const MARKER = "pi-antigravity-acp:managed-by-antigravity";
const requested = new Set(["gemini-4-argon", "gemini-3.8-flash"]);
const TOOL_ROUTING = `
OMP tool routing:
The supplied OMP tools are exposed by the authenticated pi-bridge MCP server with pi_ prefixes.
For workspace reads, searches, edits, command execution, and other user tasks, choose an appropriate supplied pi_ MCP tool before considering an Antigravity-native tool. Their results return through the OMP tool loop.
You may use Antigravity's normal MCP discovery mechanism to inspect the pi-bridge tool manifests. Do not search unrelated directories or configuration files to locate MCP tools.
If an OMP tool fails, inspect the error and correct its arguments when appropriate. Do not switch to a native tool merely because the OMP call failed.
If no suitable OMP tool is available, explain the missing capability. Before substituting an Antigravity-native tool for a user task, state the proposed tool and reason and obtain the user's explicit approval. Without approval, stop that operation and report the limitation.
This exception does not require approval for normal pi-bridge MCP manifest discovery; it applies to performing the user's task with native tools.
`;

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
  const stateDir = path.join(os.homedir(), ".omp/agent/antigravity-acp-provider");
  const configPath = path.join(stateDir, "config.json");
  const cachePath = path.join(stateDir, "models-cache.json");
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
  let lastToolAudit: { offered: string[]; available: string[]; omitted: any[] } | undefined;
  const runtimes = new SessionRuntimePool(() => {
    const runtime = new AntigravityRuntime((options: any) => {
      const connection = new TierConnection(options);
      connections.add(connection);
      void connection.process.exited.finally(() => connections.delete(connection));
      return connection;
    }, loadConfig(configPath).permissions, new AcpSessionStore(path.join(stateDir, "sessions.json")));
    return { runtime, provider: createAntigravityProvider(runtime).provider };
  }, bundle => bundle.runtime.close());
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
    description: "Inspect ACP status/tools, refresh cached models, or set permissions (default|auto-edit|yolo)",
    async handler(args: string, ctx: any) {
      const { runtime } = runtimes.get(sessionIdOf(ctx));
      const [command, value] = args.trim().split(/\s+/);
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
      ctx.ui.notify(`Antigravity ACP (OMP adapter)\nAuth storage: ${authReady() ? "configured (ACP-owned token file or macOS keychain)" : inspectAntigravityAuth().status}\nPermissions: ${snapshot.permissionMode}\nActive sessions: ${snapshot.bindings}\nConfirmed thinking: ${JSON.stringify([...connections].map(connection => connection.confirmedThinking).filter(Boolean))}\nUsage: ${JSON.stringify(snapshot.metrics)}\n${JSON.stringify(snapshot.processes)}`, "info");
    },
  });
  const upstreamModels = new Map<string, any>();
  function catalog(models: any[]) {
    return models.filter(model => requested.has(model.id)).map(source => {
      const model = { ...source, cost: officialApiCost(source.id) ?? source.cost };
      upstreamModels.set(model.id, model);
      const efforts = ["low", "medium", "high"].filter(effort => model.thinkingLevelMap?.[effort]);
      return efforts.length ? { ...model, thinking: { mode: "effort", efforts, defaultLevel: "high" } } : model;
    });
  }
  function readCachedCatalog() {
    try {
      const cache = JSON.parse(fs.readFileSync(cachePath, "utf8"));
      if (cache.schemaVersion !== 1 || !Array.isArray(cache.models) || cache.models.length > 64) return [];
      return cache.models.filter((model: any) =>
        typeof model.modelId === "string" && typeof model.name === "string" &&
        /^(gemini-4-argon|gemini-3\.8-flash)-(low|medium|high)$/.test(model.modelId));
    } catch { return []; }
  }
  async function discoverModels() {
    await prepareRuntime();
    const connection = new TierConnection({ cwd: process.cwd() });
    try {
      await connection.initialize();
      const session = await connection.newSession(process.cwd());
      // 1.4.x also advertises legacy effort-qualified IDs. Use those exact
      // advertised IDs for the upstream effort map; never synthesize tiers.
      const models = session.models?.availableModels;
      if (!models?.length) throw new Error("Antigravity did not advertise effort-qualified models");
      return models;
    } finally {
      await connection.close();
    }
  }
  async function refreshCatalog() {
    const models = await discoverModels();
    const registered = catalog(projectModels(models));
    const cache = { schemaVersion: 1, discoveredAt: new Date().toISOString(), models };
    fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    const temporary = `${cachePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(cache, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, cachePath);
    return registered;
  }
  const cached = readCachedCatalog();
  let initialModels = catalog(cached.length ? projectModels(cached) : runtimes.get().provider.getModels());

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
          return catalog(cached.length ? projectModels(cached) : runtimes.get().provider.getModels());
        },
        streamSimple(model: any, context: any, options: any) {
          const tools = context.tools ?? [];
          const bridged = tools.filter((tool: any) => tool.name !== PERMISSION_TOOL_NAME);
          const omitted = planToolProjection(tools);
          const omittedNames = new Set(omitted.map((tool: any) => tool.name));
          const available = bridged.filter((tool: any) => !omittedNames.has(tool.name));
          lastToolAudit = { offered: bridged.map((tool: any) => tool.name), available: available.map((tool: any) => tool.name), omitted };
          const routedContext = {
            ...context,
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
              const { runtime, provider } = runtimes.get(options?.sessionId);
              const stream = provider.streamSimple(original, routedContext, options);
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
