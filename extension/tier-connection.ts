// Compatibility seam for pi-antigravity-acp-provider 0.1.15 / ACP server 1.4.x.
// OMP effort -> upstream advertised legacy ID -> official model/thought selectors.
import { AntigravityAcpConnection } from "pi-antigravity-acp-provider/src/acp/connection.ts";

export class TierConnection extends AntigravityAcpConnection {
  confirmedThinking: { model: string; effort: string } | undefined;

  override async setModel(sessionId: string, modelId: string, signal?: AbortSignal): Promise<void> {
    const match = modelId.match(/^(gemini-4-argon|gemini-3\.8-flash)-(low|medium|high)$/);
    if (!match) {
      await super.setModel(sessionId, modelId, signal);
      return;
    }
    const [, base, effort] = match;
    // These are official ACP session/set_config_option requests. The legacy
    // model ID is never submitted as a made-up value to the modern selector.
    await super.setModel(sessionId, base!, signal);
    // Upstream 0.1.15 already has a deadline/abort-aware, verified selector
    // helper. Its TypeScript signature only mentions model/mode; thought_level
    // uses the exact same stable ACP RPC and server-advertised category.
    const selected = await (this as any).setSelector(sessionId, "thought_level", effort, signal);
    if (!selected) throw new Error("Antigravity did not advertise a thinking-level selector");
    const state = this.getSessionState(sessionId);
    const model = state.configOptions?.find(option => option.category === "model");
    const thought = state.configOptions?.find(option => option.category === "thought_level");
    if (model?.currentValue !== base || thought?.currentValue !== effort) {
      throw new Error("Antigravity did not confirm the requested model and thinking level");
    }
    this.confirmedThinking = { model: base!, effort: effort! };
    if (process.env.OMP_ACP_TRACE === "1") {
      console.error(`[ACP confirmed] model=${base} thinking=${effort}`);
    }
  }
}
