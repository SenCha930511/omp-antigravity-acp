// OMP 18.x adapter for pi-antigravity-acp-provider 0.1.15 (Pi 1.1 API).
// Keep upstream code intact; translate only the provider registration contract.
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { officialApiCost, applyApiCostEstimate } from "./pricing.ts";
import { SessionRuntimePool } from "./runtime-pool.ts";
import { stableTools } from "./tool-order.ts";
import { loadContextSettings, saveContextSettings, resolveContextOptions, updateContextSettings } from "./context-settings.ts";
import { EFFORTS, projectCatalog, readModels, selectRuntimeModel } from "./model-catalog.ts";
import { advertisedRecord, choices, selector } from "./selectors.ts";
import { TOOL_ROUTING, parseNativeToolMode } from "./tool-routing.ts";
import { loadNativeToolMode, loadToolPolicy, saveNativeToolMode, saveDebugToolUpdates } from "./tool-policy.ts";
import { Type, createAntigravityProvider, AntigravityRuntime, PERMISSION_TOOL_NAME, PERMISSION_RESULT_KIND, loadConfig, savePermissionMode, inspectAntigravityAuth, hasAntigravityAuth, clearAntigravityCredentials, resolveAntigravityAcpDirectory, describeCredentialStorage, AcpSessionStore, ensureAntigravityAcpReady, TierConnection, planToolProjection, PiEventWriter, SessionCleanup } from "./runtime.mjs";

const MARKER = "pi-antigravity-acp:managed-by-antigravity";

// macOS keychain operations behind one mutable object so offline command
// tests can substitute them without touching the user's real keychain.
export const keychain = {
  // Check existence only. Never retrieve credentials from the keychain.
  present(): boolean | undefined {
    if (process.platform !== "darwin") return undefined;
    try {
      execFileSync("/usr/bin/security", ["find-generic-password", "-s", "gemini", "-a", "antigravity-acp"], { stdio: "ignore", timeout: 3000 });
      return true;
    } catch { return false; }
  },
  // Local logout for macOS keychain storage. The Antigravity server owns this
  // item; removing it is required for a complete logout when no token file exists.
  remove(): boolean | undefined {
    if (process.platform !== "darwin") return undefined;
    try {
      execFileSync("/usr/bin/security", ["delete-generic-password", "-s", "gemini", "-a", "antigravity-acp"], { stdio: "ignore", timeout: 3000 });
      return true;
    } catch { return false; }
  },
  // Extract only the email claim from the ACP item's stored id_token. The
  // token bytes stay in this process and are never logged or persisted; the
  // agy CLI's separate keychain item is never read.
  accountEmail(): string | undefined {
    if (process.platform !== "darwin") return undefined;
    try {
      const raw = execFileSync("/usr/bin/security", ["find-generic-password", "-s", "gemini", "-a", "antigravity-acp", "-w"], { timeout: 3000 });
      return emailFromTokenJson(raw.toString("utf8"));
    } catch { return undefined; }
  },
};

function emailFromTokenJson(raw: string): string | undefined {
  try {
    const idToken = JSON.parse(raw)?.id_token;
    if (typeof idToken !== "string" || !idToken.includes(".")) return undefined;
    const claims = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8"));
    return typeof claims.email === "string" && claims.email.includes("@") ? claims.email : undefined;
  } catch { return undefined; }
}

// The signed-in Google account, from the ACP server's own stored token. The
// token file is preferred because it needs no keychain access.
function antigravityAccountEmail(): string | undefined {
  try {
    return emailFromTokenJson(fs.readFileSync(path.join(resolveAntigravityAcpDirectory(), "acp_token.json"), "utf8"));
  } catch { /* keychain storage or signed out */ }
  return keychain.accountEmail();
}

// Timing knobs for following OMP-side logouts; mutable so offline tests can
// run the delayed detection without real waits.
export const logoutFollow = { delayMs: 500, retryMs: 15_000 };

function authReady() {
  return hasAntigravityAuth() || keychain.present() === true;
}

// OMP stores only the non-secret marker credential. Read it defensively:
// the model registry surface is host version dependent and absent in tests.
function ompCredentialSummary(ctx: any) {
  try {
    const stored = ctx?.modelRegistry?.authStorage?.credentials?.getOAuth?.("antigravity-acp");
    if (!stored) return { present: false };
    return {
      present: true,
      record: stored.refresh === MARKER ? "non-secret managed marker" : "oauth credential",
      email: typeof stored.email === "string" && stored.email ? stored.email : undefined,
      authorizedAt: typeof stored.authorizedAt === "number" ? new Date(stored.authorizedAt).toISOString() : undefined,
    };
  } catch (error: any) {
    return { present: undefined, error: error instanceof Error ? error.message : String(error) };
  }
}

// Removes OMP's stored marker record so one command completes the logout.
async function removeOmpCredentialRecord(ctx: any): Promise<"removed" | "absent" | "unavailable"> {
  try {
    const credentials = ctx?.modelRegistry?.authStorage?.credentials;
    if (!credentials?.remove || !credentials.getOAuth) return "unavailable";
    if (!credentials.getOAuth("antigravity-acp")) return "absent";
    await credentials.remove("antigravity-acp");
    try { await ctx.modelRegistry.refreshProvider?.("antigravity-acp", "online"); } catch { /* advisory only */ }
    return "removed";
  } catch { return "unavailable"; }
}

export default async function (pi: any) {
  return registerOmpAdapter(pi, path.join(os.homedir(), ".omp/agent/antigravity-acp-provider"));
}

// Explicit state injection keeps command integration tests away from user data.
export async function registerOmpAdapter(pi: any, stateDir: string) {
  const configPath = path.join(stateDir, "config.json");
  const cachePath = path.join(stateDir, "models-cache.json");
  const toolPolicyPath = path.join(stateDir, "omp-tools.json");
  const contextPath = path.join(stateDir, "context.json");
  let contextSettings = loadContextSettings(contextPath);
  const cleanup = new SessionCleanup(stateDir);
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
      const connection = new TierConnection({ ...options, ompNativeTools: policy.nativeTools, ompDebugToolUpdates: policy.debugToolUpdates,
        ompUsageMode: contextSettings.defaults.usageMode ?? "auto", ompCleanup: cleanup });
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
  // OMP's oauth contract has no logout hook: /logout only removes the stored
  // marker credential. Watching the credential store's generation counter lets
  // this adapter finish the Antigravity-side logout when OMP reports removal.
  let watchingCredentials = false;
  let markerPresent: boolean | undefined;
  let suppressFollow = false;
  let selfLogout = false;
  let followTimer: ReturnType<typeof setTimeout> | undefined;
  let followRetry: ReturnType<typeof setTimeout> | undefined;
  function ompMarkerStored(ctx: any): boolean | undefined {
    try {
      return Boolean(ctx?.modelRegistry?.authStorage?.credentials?.getOAuth?.("antigravity-acp"));
    } catch { return undefined; }
  }
  // A dying ACP server can flush its in-memory token back to the keychain,
  // racing a plain deletion and restoring the previous account. Wait for this
  // adapter's server processes to fully exit first, then verify the removal.
  async function removeKeychainCredentialDurably(): Promise<boolean | undefined> {
    const pending = [...connections].map(connection => connection.process.exited.catch(() => undefined));
    if (pending.length > 0) {
      await Promise.race([Promise.allSettled(pending), new Promise(resolve => setTimeout(resolve, 10_000))]);
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      if (keychain.present() === false) return true;
      const removed = keychain.remove();
      if (removed !== true) return removed;
      await new Promise(resolve => setTimeout(resolve, 400));
    }
    return keychain.present() === false;
  }
  // /login must mean a fresh Google sign-in: drop stored credentials (and this
  // process's old-account servers) so a new server cannot silently reuse the
  // saved login and keep the previous account.
  async function beginFreshGoogleLogin() {
    if (runtimes.values().some(bundle => bundle.isBusy())) {
      throw new Error("Wait for active Antigravity requests to finish before logging in.");
    }
    await runtimes.closeAll();
    clearAntigravityCredentials();
    keychain.remove();
  }
  async function finishFollowedLogout(ctx: any) {
    if (runtimes.values().some(bundle => bundle.isBusy())) {
      // Never interrupt an in-flight Antigravity request; retry once idle.
      clearTimeout(followRetry);
      followRetry = setTimeout(() => {
        followRetry = undefined;
        if (ompMarkerStored(ctx) === false) void finishFollowedLogout(ctx);
      }, logoutFollow.retryMs);
      followRetry.unref?.();
      return;
    }
    runtimes.get();
    await Promise.all(runtimes.values().map(bundle => bundle.runtime.logout()));
    await runtimes.closeAll();
    const keychainRemoved = await removeKeychainCredentialDurably();
    // Keep the confirmation terse; /antigravity-acp account shows the details.
    const cleared = ["Google credentials", "saved ACP sessions"];
    if (keychainRemoved === true) cleared.push("the macOS keychain entry");
    const list = cleared.slice(0, -1).join(", ") + " and " + cleared[cleared.length - 1];
    try {
      ctx?.ui?.notify?.(`Antigravity ACP: finished the logout OMP started — ${list} cleared.${keychainRemoved === false ? " The macOS keychain entry was not present or not removable." : ""}`, "info");
    } catch { /* the host UI may already be gone */ }
  }
  function watchOmpCredentials(ctx: any) {
    if (watchingCredentials) return;
    const credentials = ctx?.modelRegistry?.authStorage?.credentials;
    if (!credentials?.getOAuth || !credentials.onGeneration) return;
    const initial = ompMarkerStored(ctx);
    if (initial === undefined) return;
    watchingCredentials = true;
    markerPresent = initial;
    // Automatic soft-disables (for example an invalid_grant refresh) must not
    // destroy the Antigravity-side login. OMP emits credential_disabled for
    // those, but not for user-initiated removals such as /logout.
    pi.on("credential_disabled", (event: any) => {
      if (event?.provider === "antigravity-acp") suppressFollow = true;
    });
    credentials.onGeneration(() => {
      const current = ompMarkerStored(ctx);
      if (current === undefined) return;
      const wasPresent = markerPresent === true;
      markerPresent = current;
      if (current) suppressFollow = false;
      if (!wasPresent || current || selfLogout) return;
      clearTimeout(followTimer);
      followTimer = setTimeout(() => {
        followTimer = undefined;
        if (process.env.OMP_ACP_FOLLOW_LOGOUT === "0") return;
        if (suppressFollow) { suppressFollow = false; return; }
        // A quick re-login after the removal cancels the cleanup.
        if (ompMarkerStored(ctx) !== false) return;
        void finishFollowedLogout(ctx);
      }, logoutFollow.delayMs);
      followTimer.unref?.();
    });
  }
  pi.on("session_start", async (_event: any, ctx: any) => { watchOmpCredentials(ctx); });
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
    description: "Inspect ACP status/account/tools/usage/context/cleanup, manage Antigravity login/logout, configure budgets, toggle debug, refresh models or set tool policies",
    async handler(args: string, ctx: any) {
      watchOmpCredentials(ctx);
      const parts = args.trim().split(/\s+/);
      const [command, value] = parts;
      if (command === "cleanup") {
        if (value) {
          if (!["off", "conservative", "timeout"].includes(value) || parts.length > 3 || (parts[2] !== undefined && value !== "timeout")) {
            throw new Error("Usage: /antigravity-acp cleanup [off|conservative|timeout [DAYS]]");
          }
          cleanup.configure(value, parts[2] === undefined ? undefined : Number(parts[2]));
          cleanup.start();
        }
        const removed = cleanup.collect();
        ctx.ui.notify(JSON.stringify({ ...cleanup.status(), removed,
          note: "Active sessions are protected. Timeout cleanup loses ACP-only state; OMP history is retained." }, null, 2), "info");
        return;
      }
      if (command === "context") {
        if (value === "set") {
          const [, , target, key, raw] = parts;
          if (parts.length !== 5) throw new Error("Usage: /antigravity-acp context set default|MODEL KEY NUMBER");
          const next = updateContextSettings(contextSettings, target, key, key === "usageMode" ? raw : Number(raw));
          for (const model of initialModels) resolveContextOptions(model, next);
          saveContextSettings(contextPath, next);
          contextSettings = next;
          if (key === "usageMode") for (const connection of connections) connection.configureUsage(raw as "auto" | "off");
          initialModels = catalog(initialModels);
          adapted.registerProvider();
          ctx.ui.notify("ACP context settings saved. Restart OMP or reselect the model to refresh its displayed limits.", "info");
        } else if (value) throw new Error("Usage: /antigravity-acp context [set default|MODEL KEY NUMBER]");
        else ctx.ui.notify(JSON.stringify({ file: contextPath, settings: contextSettings,
          effective: initialModels.map((model: any) => ({ id: model.id, ...resolveContextOptions(model, contextSettings) })) }, null, 2), "info");
        return;
      }
      if (command === "usage" && value) {
        if (value !== "auto" && value !== "off") throw new Error("Usage: /antigravity-acp usage [auto|off]");
        contextSettings = updateContextSettings(contextSettings, "default", "usageMode", value);
        saveContextSettings(contextPath, contextSettings);
        for (const connection of connections) connection.configureUsage(value);
        ctx.ui.notify(`Supplemental ACP usage queries: ${value}${process.env.OMP_ACP_USAGE === "off" ? " (environment override keeps queries off)" : ""}. Context occupancy updates remain enabled.`, "info");
        return;
      }
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
      if (command === "login") {
        if (value) throw new Error("Usage: /antigravity-acp login");
        await prepareRuntime();
        await beginFreshGoogleLogin();
        // Direct Antigravity Google login through the command UI. OMP's /login
        // runs the same flow and additionally stores the provider marker.
        await runtimes.get().provider.auth.oauth.login({
          signal: undefined,
          notify(event: any) {
            const link = event.links?.[0];
            if (link) ctx.ui.notify(`${event.message ?? "Open this URL to authorize:"}\n${link.url}`, "info");
            else if (event.message) ctx.ui.notify(event.message, "info");
          },
          prompt: async (request: any) => {
            const answer = await ctx.ui.input(request.message, request.placeholder);
            if (!answer?.trim()) throw new Error("Antigravity OAuth login cancelled");
            return answer;
          },
        });
        const auth = inspectAntigravityAuth();
        const email = antigravityAccountEmail();
        ctx.ui.notify(`Antigravity Google login finished${email ? ` as ${email}` : ""} — fresh sign-in; ACP auth: ${auth.status}${auth.authType ? ` (${auth.authType})` : ""}.`, "info");
        return;
      }
      if (command === "logout") {
        if (value) throw new Error("Usage: /antigravity-acp logout");
        if (runtimes.values().some(bundle => bundle.isBusy())) {
          throw new Error("Wait for active Antigravity requests to finish before logging out.");
        }
        // Ensure a runtime (and its ACP session store) exists even before any request.
        runtimes.get();
        // runtime.logout() closes ACP connections, clears saved sessions and
        // removes the local token file plus the settings auth choice.
        await Promise.all(runtimes.values().map(bundle => bundle.runtime.logout()));
        await runtimes.closeAll();
        const keychainRemoved = await removeKeychainCredentialDurably();
        // Removing the marker ourselves must not trigger the follow-up logout.
        selfLogout = true;
        let ompMarker: "removed" | "absent" | "unavailable";
        try { ompMarker = await removeOmpCredentialRecord(ctx); } finally { selfLogout = false; }
        // Keep the confirmation terse; /antigravity-acp account shows the details.
        const cleared = ["Google credentials", "saved ACP sessions"];
        if (keychainRemoved === true) cleared.push("the macOS keychain entry");
        if (ompMarker === "removed") cleared.push("the OMP marker record");
        const list = cleared.slice(0, -1).join(", ") + " and " + cleared[cleared.length - 1];
        ctx.ui.notify(`Antigravity ACP: logged out — ${list} cleared.${ompMarker === "unavailable" ? " The OMP marker record could not be removed; run /logout to drop it." : ""}${keychainRemoved === false ? " The macOS keychain entry was not present or not removable." : ""}`, "info");
        return;
      }
      if (command === "account") {
        if (value) throw new Error("Usage: /antigravity-acp account");
        const auth = inspectAntigravityAuth();
        let ompSource: string | undefined;
        try { ompSource = ctx?.modelRegistry?.authStorage?.keys?.describe?.("antigravity-acp", sessionIdOf(ctx)); } catch { /* host version dependent */ }
        const runtime = runtimes.get(sessionIdOf(ctx)).runtime;
        const snapshot = await runtime.snapshot();
        const omp = ompCredentialSummary(ctx);
        const marker = omp.present === undefined ? "unknown (host did not expose the credential store)"
          : omp.present ? `present, authorized ${omp.authorizedAt ?? "unknown time"}${omp.email ? ` as ${omp.email}` : ""} (${omp.record})`
          : "not stored; run /login or /antigravity-acp login";
        // Mirrors the upstream provider's status/doctor wording for the shared
        // fields, with OMP-specific lines in the same style.
        ctx.ui.notify([
          "Antigravity ACP account",
          `Google account: ${antigravityAccountEmail() ?? "not signed in"}`,
          `Authentication: ${auth.status}${auth.authType ? ` (${auth.authType})` : ""}`,
          `Credential storage (preflight): ${describeCredentialStorage()}`,
          `OMP marker record: ${marker}`,
          ompSource ? `OMP auth source: ${ompSource}` : undefined,
          `Saved ACP sessions: ${runtime.sessionStore?.read().length ?? 0}`,
          `Requested permission mode: ${snapshot.permissionMode === "auto_edit" ? "auto-edit" : snapshot.permissionMode}`,
          `Active bindings: ${snapshot.bindings}`,
          "Google OAuth tokens stay in Antigravity-owned storage; OMP stores only a non-secret marker. /antigravity-acp logout clears both sides; OMP /logout also finishes the Antigravity-side cleanup.",
        ].filter(Boolean).join("\n"), "info");
        return;
      }
      const { runtime } = runtimes.get(sessionIdOf(ctx));
      if (command === "usage") {
        ctx.ui.notify(JSON.stringify({ configured: contextSettings.defaults.usageMode ?? "auto",
          effective: process.env.OMP_ACP_USAGE === "off" ? "off" : contextSettings.defaults.usageMode ?? "auto",
          connections: [...connections].map(connection => ({
          context: [...connection.contextUsage.values()],
          accounting: [...connection.usageStatus.values()],
          activePrompts: connection.activePrompts,
        })) }, null, 2), "info");
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
      const limits = resolveContextOptions(source, contextSettings);
      const model = { ...source, contextWindow: limits.contextWindow, maxTokens: limits.maxTokens,
        ompContextPolicy: limits, cost: officialApiCost(source.id) ?? source.cost };
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
    const connection = new TierConnection({ cwd: process.cwd(), ompCleanup: cleanup });
    let discoveredSession: string | undefined;
    try {
      await connection.initialize();
      const session = await connection.newSession(process.cwd());
      discoveredSession = session.sessionId;
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
      if (discoveredSession) connection.discardSession(discoveredSession);
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
            // Always offer a fresh Google sign-in; without this a new server
            // process silently reuses the saved login and keeps the old account.
            await beginFreshGoogleLogin();
            const result = await runtimes.get().provider.auth.oauth.login({
              signal: callbacks.signal,
              notify(event: any) {
                if (event.links?.length) {
                  for (const link of event.links) callbacks.onAuth({ url: link.url, instructions: event.message });
                } else callbacks.onProgress?.(event.message);
              },
              prompt: (request: any) => callbacks.onPrompt({ message: request.message, placeholder: request.placeholder }),
            });
            // Record the signed-in account on the marker credential so OMP's
            // account list can label it; the email is identity data, not a secret.
            const email = antigravityAccountEmail();
            return email ? { ...result, email } : result;
          },
          refreshToken: (credentials: any) => runtimes.get().provider.auth.oauth.refresh(credentials),
          getApiKey: () => MARKER,
        },
      });
    },
  });
  adapted.registerProvider();
}
