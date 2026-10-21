// Offline provider: only measure host object reuse; never contacts a model.
import { PiEventWriter } from "../../extension/runtime.mjs";
export default function(pi: any) {
  let previous: any[] = [], turns = 0;
  pi.registerProvider("fingerprint-probe", {
    api: "fingerprint-probe", baseUrl: "offline://probe", apiKey: "synthetic-probe-marker",
    models: [{ id: "probe", name: "Offline probe", api: "fingerprint-probe", provider: "fingerprint-probe",
      contextWindow: 524288, maxTokens: 1024, reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple(model: any, context: any) {
      const compared = Math.min(previous.length, context.messages.length);
      console.error("FINGERPRINT_IDENTITY " + JSON.stringify({ turn: ++turns, messages: context.messages.length,
        compared, shared: previous.filter((m, i) => i < compared && m === context.messages[i]).length }));
      previous = [...context.messages];
      const writer = new PiEventWriter(model);
      queueMicrotask(() => { writer.text("OK"); writer.done("stop"); });
      return writer.stream;
    },
  });
}
