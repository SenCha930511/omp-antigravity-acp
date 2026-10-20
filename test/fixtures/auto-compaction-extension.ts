// Only used by an explicit live integration probe in an isolated OMP profile.
import assert from "node:assert/strict";
import { registerOmpAdapter } from "../../extension/index.ts";
export default async function(pi: any) {
  const state = process.env.OMP_ACP_COMPACTION_PROBE_STATE;
  if (!state) throw new Error("Missing isolated probe state");
  let injected = false;
  await registerOmpAdapter(new Proxy(pi, { get(target, name) {
    if (name === "registerProvider") return (id: string, provider: any) => {
      const original = provider.streamSimple;
      provider.streamSimple = (...args: any[]) => {
        assert.equal(args[0].id, "gemini-3.8-flash", "Live probe must use Flash only");
        return (async function*() {
          for await (const event of original(...args)) {
            if (!injected && event.type === "done") {
              injected = true;
              // Synthetic occupancy triggers the real OMP compaction pipeline
              // without spending hundreds of thousands of model tokens.
              event.message.usage.contextTokens = 50000;
              console.error("SYNTHETIC_CONTEXT_TRIGGER_50000");
            }
            yield event;
          }
        })();
      };
      return target.registerProvider(id, provider);
    };
    const value = Reflect.get(target, name);
    return typeof value === "function" ? value.bind(target) : value;
  } }), state);
}
