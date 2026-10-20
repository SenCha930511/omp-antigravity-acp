// Compatibility seam for pi-antigravity-acp-provider 0.1.15 / ACP server 1.4.x.
// OMP effort -> upstream advertised legacy ID -> official model/thought selectors.
import { AntigravityAcpConnection } from "pi-antigravity-acp-provider/src/acp/connection.ts";
import { choices, resolveSelection, selector } from "./selectors.ts";
import { installSessionRouting, type NativeToolMode } from "./tool-routing.ts";

export class TierConnection extends AntigravityAcpConnection {
  confirmedThinking: { model: string; effort: string } | undefined;
  toolRouting: { nativeTools: NativeToolMode; channel: "pending" | "system-append" | "legacy-prompt" } | undefined;

  constructor(options: ConstructorParameters<typeof AntigravityAcpConnection>[0] & { ompNativeTools?: NativeToolMode }) {
    super(options);
    if (options.ompNativeTools) {
      this.toolRouting = { nativeTools: options.ompNativeTools, channel: "pending" };
      installSessionRouting((this as any).connection, this.initialized, options.ompNativeTools, advanced => {
        this.toolRouting!.channel = advanced ? "system-append" : "legacy-prompt";
      });
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
