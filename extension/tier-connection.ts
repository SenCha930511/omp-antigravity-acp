// Compatibility seam for pi-antigravity-acp-provider 0.1.15 / ACP server 1.4.x.
// OMP effort -> upstream advertised legacy ID -> official model/thought selectors.
import { AntigravityAcpConnection } from "pi-antigravity-acp-provider/src/acp/connection.ts";
import { choices, resolveSelection, selector } from "./selectors.ts";
import { installSessionRouting, type NativeToolMode } from "./tool-routing.ts";
import { showAcpUpdate } from "./activity-presentation.ts";
import { parseSessionUsage, usageDelta, type SessionUsage } from "./usage-accounting.ts";
import type { SessionCleanup } from "./session-cleanup.ts";

export class TierConnection extends AntigravityAcpConnection {
  confirmedThinking: { model: string; effort: string } | undefined;
  debugToolUpdates: boolean;
  activePrompts = 0;
  usageQueryCount = 0;
  usageQueryMs = 0;
  usageMode: "auto" | "off" = "auto";
  readonly contextUsage = new Map<string, { used: number; size: number }>();
  readonly usageStatus = new Map<string, { source: string; cache: string; error?: string }>();
  private readonly usageBaselines = new Map<string, SessionUsage>();
  private usageCapture: { text: string } | undefined;
  private readonly usageCommands = new Set<string>();
  private cleanup?: SessionCleanup;
  private cleanupLeases = new Map<string, string>();
  toolRouting: { nativeTools: NativeToolMode; channel: "pending" | "system-append" | "legacy-prompt" } | undefined;

  constructor(options: ConstructorParameters<typeof AntigravityAcpConnection>[0] & { ompNativeTools?: NativeToolMode; ompDebugToolUpdates?: boolean; ompUsageMode?: "auto" | "off"; ompCleanup?: SessionCleanup }) {
    super(options);
    this.cleanup = options.ompCleanup;
    this.cleanup?.start();
    void this.process.exited.then(() => this.releaseCleanupLeases());
    this.debugToolUpdates = options.ompDebugToolUpdates ?? false;
    this.usageMode = options.ompUsageMode ?? "auto";
    this.setHandlers({ ...options.handlers, onUpdate: async notification => {
      const update: any = notification.update;
      if (update.sessionUpdate === "available_commands_update") {
        if (update.availableCommands?.some((command: any) => command.name === "usage")) this.usageCommands.add(notification.sessionId);
        else this.usageCommands.delete(notification.sessionId);
      }
      if (update.sessionUpdate === "usage_update" && Number.isSafeInteger(update.used) && Number.isSafeInteger(update.size)) {
        this.contextUsage.set(notification.sessionId, { used: update.used, size: update.size });
      }
      if (this.usageCapture) {
        if (update.sessionUpdate === "agent_message_chunk" && update.content?.type === "text") this.usageCapture.text += update.content.text;
        return;
      }
      if (showAcpUpdate(notification, this.debugToolUpdates)) await options.handlers?.onUpdate?.(notification);
    } });
    if (options.ompNativeTools) {
      this.toolRouting = { nativeTools: options.ompNativeTools, channel: "pending" };
      installSessionRouting((this as any).connection, this.initialized, options.ompNativeTools, advanced => {
        this.toolRouting!.channel = advanced ? "system-append" : "legacy-prompt";
      });
    }
  }

  configureUsage(mode: "auto" | "off") {
    this.usageMode = mode;
    this.usageBaselines.clear();
  }

  override async newSession(...args: Parameters<AntigravityAcpConnection["newSession"]>) {
    const session = await super.newSession(...args);
    if (this.cleanup) {
      try { this.cleanupLeases.set(session.sessionId, this.cleanup.acquire(session.sessionId, true, this.process.pid!)); }
      catch { console.warn("[ACP cleanup] Could not register new session; preserving its files."); }
    }
    this.usageBaselines.set(session.sessionId, { input: 0, completion: 0, thinking: 0, cached: 0, total: 0 });
    return session;
  }

  private protectSession(id: string) {
    if (this.cleanup && !this.cleanupLeases.has(id)) {
      // Lease before the resume/load RPC, including while the server replays.
      this.cleanupLeases.set(id, this.cleanup.acquire(id, false, this.process.pid!));
    }
  }
  override async resumeSession(...args: Parameters<AntigravityAcpConnection["resumeSession"]>) {
    this.protectSession(args[0]);
    return super.resumeSession(...args);
  }
  override async loadSession(...args: Parameters<AntigravityAcpConnection["loadSession"]>) {
    this.protectSession(args[0]);
    return super.loadSession(...args);
  }
  retireForReplacement(key: string, id: string) {
    try { this.cleanup?.retire(key, id); } catch { /* Preserve files if bookkeeping is unavailable. */ }
  }
  confirmReplacement(key: string, id: string) {
    try { this.cleanup?.confirm(key, id); } catch { /* Retry cleanup on a later successful turn. */ }
  }
  discardSession(id: string) {
    // Explicitly disposable discovery sessions need no model replacement.
    this.retireForReplacement(`discovery:${id}`, id);
    this.confirmReplacement(`discovery:${id}`, "discovery-complete");
  }
  private releaseCleanupLeases() {
    if (this.process.alive) return;
    for (const [id, token] of this.cleanupLeases ?? []) {
      try { this.cleanup?.release(token); this.cleanupLeases.delete(id); } catch { /* Live PID leases fail closed. */ }
    }
  }
  override async close() {
    await super.close();
    this.releaseCleanupLeases();
  }

  private async readUsage(sessionId: string, signal?: AbortSignal) {
    const started = performance.now();
    this.usageQueryCount++;
    const capture = { text: "" };
    this.usageCapture = capture;
    try {
      const deadline = AbortSignal.timeout(5_000);
      await super.prompt({ sessionId, prompt: [{ type: "text", text: "/usage" }] },
        signal ? AbortSignal.any([signal, deadline]) : deadline);
      return parseSessionUsage(capture.text);
    } finally { this.usageCapture = undefined; this.usageQueryMs += performance.now() - started; }
  }

  override async prompt(request: Parameters<AntigravityAcpConnection["prompt"]>[0], signal?: AbortSignal) {
    this.activePrompts++;
    const id = request.sessionId;
    try { this.cleanup?.touch(id); } catch { /* Cleanup must not affect inference. */ }
    try {
      const queryUsage = process.env.OMP_ACP_USAGE !== "off" && this.usageMode !== "off" && this.usageCommands.has(id);
      if (queryUsage && !this.usageBaselines.has(id)) {
        try {
          const baseline = await this.readUsage(id, signal);
          if (baseline) this.usageBaselines.set(id, baseline);
        } catch { /* Restore baseline is optional; never count the prior session as this turn. */ }
      }
      const response = await super.prompt(request, signal);
      const withContext = (value: any) => {
        const context = this.contextUsage.get(id);
        return context ? { ...value, _meta: { ...value._meta, ompContextTokens: context.used } } : value;
      };
      if (response.usage || process.env.OMP_ACP_USAGE === "off" || this.usageMode === "off" || !this.usageCommands.has(id) || signal?.aborted) {
        this.usageBaselines.delete(id);
        this.usageStatus.set(id, { source: response.usage ? "ACP response" : "unavailable", cache: "unknown" });
        return withContext(response);
      }
      try {
        const after = await this.readUsage(id, signal);
        const before = this.usageBaselines.get(id);
        const usage = before && after ? usageDelta(before, after) : undefined;
        if (after) this.usageBaselines.set(id, after); else this.usageBaselines.delete(id);
        this.usageStatus.set(id, { source: usage ? "official /usage delta (main agent)" : "unavailable", cache: usage?.cachedReadTokens === undefined ? "unknown" : "reported" });
        return withContext(usage ? { ...response, usage } : response);
      } catch {
        this.usageBaselines.delete(id);
        this.usageStatus.set(id, { source: "unavailable", cache: "unknown", error: "Official usage query failed or timed out" });
        return withContext(response);
      }
    } finally {
      this.activePrompts--;
      try { this.cleanup?.touch(id); } catch { /* Keep accounting optional. */ }
    }
  }

  override async setModel(sessionId: string, modelId: string, signal?: AbortSignal): Promise<void> {
    const { modelId: base, effort } = resolveSelection(this.getSessionState(sessionId), modelId);
    // These are official ACP session/set_config_option requests. The legacy
    // model ID is never submitted as a made-up value to the modern selector.
    await super.setModel(sessionId, base, signal);
    this.confirmedThinking = undefined;
    if (!effort) return;
    const thoughtSelector = selector(this.getSessionState(sessionId), "thought_level");
    if (!thoughtSelector || !choices(thoughtSelector).some(option => option.value === effort)) {
      throw new Error(`ACP does not advertise thinking level ${effort} for ${base}`);
    }
    // Upstream 0.1.15 already has a deadline/abort-aware, verified selector
    // helper. Its TypeScript signature only mentions model/mode; thought_level
    // uses the exact same stable ACP RPC and server-advertised category.
    const selected = await (this as any).setSelector(sessionId, thoughtSelector.id, effort, signal);
    if (!selected) throw new Error("Antigravity did not advertise a thinking-level selector");
    const state = this.getSessionState(sessionId);
    const model = selector(state, "model");
    const thought = selector(state, "thought_level");
    if (model?.currentValue !== base || thought?.currentValue !== effort) {
      throw new Error("Antigravity did not confirm the requested model and thinking level");
    }
    this.confirmedThinking = { model: base, effort };
    if (process.env.OMP_ACP_TRACE === "1") {
      console.error(`[ACP confirmed] model=${base} thinking=${effort}`);
    }
  }
}
