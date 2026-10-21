// Opt-in Flash-only probe. No workspace tools, account/config edits or Argon.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SessionCleanup, TierConnection } from "../extension/runtime.mjs";
import { thoughtRoute } from "../extension/model-catalog.ts";
if (!process.argv.includes("--live")) throw new Error("Pass --live; consumes Flash quota.");
const state = fs.mkdtempSync(path.join(os.tmpdir(), "omp-cache-cancel-probe-"));
const cleanup = new SessionCleanup(state);
const connections: Array<{ c: any; id?: string }> = [];
const rows: any[] = [];
let text = "", cancelOnText: AbortController | undefined;
async function open() {
  const c: any = new TierConnection({ cwd: os.tmpdir(), ompNativeTools: "disabled", ompUsageMode: "auto", ompCleanup: cleanup,
    handlers: { onUpdate: (n: any) => {
      if (n.update.sessionUpdate === "agent_message_chunk" && n.update.content?.type === "text") {
        text += n.update.content.text;
        if (cancelOnText) { const controller = cancelOnText; cancelOnText = undefined; controller.abort(); }
      }
    } } });
  const item = { c, id: undefined as string | undefined }; connections.push(item);
  await c.initialize();
  const session = await c.newSession(os.tmpdir()); item.id = session.sessionId;
  await c.setModel(item.id, thoughtRoute("gemini-3.8-flash", "low"));
  // Observe the official terminal response before the upstream AbortError wrapper.
  const rpc = c.connection.prompt.bind(c.connection);
  c.connection.prompt = async (request: any) => { const response = await rpc(request); c.lastTerminal = response.stopReason; return response; };
  return item as { c: any; id: string };
}
async function ask(item: { c: any; id: string }, label: string, prompt: any[], expected?: string) {
  text = ""; const start = performance.now();
  const response = await item.c.prompt({ sessionId: item.id, prompt }, AbortSignal.timeout(90_000));
  if (expected) assert.equal(text.trim(), expected);
  const row = { label, ms: Math.round(performance.now() - start), input: response.usage?.inputTokens ?? null,
    cached: response.usage?.cachedReadTokens ?? null, accounting: item.c.usageStatus.get(item.id), text: text.trim().slice(0, 100) };
  rows.push(row); console.log(JSON.stringify(row));
}
const prefix = Array.from({ length: 650 }, (_, i) => `Reference record ${i}: stable background context for a harmless cache experiment; no actions are requested.`).join("\n");
const prime = [{ type: "resource", resource: { uri: "urn:omp:cache-probe:reference", mimeType: "text/plain", text: prefix } },
  { type: "text", text: "\n\nCurrent request: Reply with exactly PRIME_OK. Do not use tools." }];
try {
  const a = await open();
  await ask(a, "session-A-prime", prime, "PRIME_OK");
  await ask(a, "session-A-warm", [{ type: "text", text: "Reply with exactly WARM_OK. Do not use tools." }], "WARM_OK");
  const b = await open();
  await ask(b, "session-B-identical-cold-prompt", prime, "PRIME_OK");
  text = ""; a.c.lastTerminal = undefined;
  const controller = new AbortController(); cancelOnText = controller;
  const start = performance.now();
  try {
    await a.c.prompt({ sessionId: a.id, prompt: [{ type: "text", text: "Write 1500 numbered sentences about counting. Do not use tools. Start immediately." }] },
      AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)]));
    throw new Error("Expected a cancelled prompt");
  } catch (error: any) {
    assert.ok(controller.signal.aborted, "Probe must cancel after a real output chunk");
    assert.ok(a.c.process.alive, "A graceful cancellation should keep the server alive");
    assert.equal(a.c.lastTerminal, "cancelled");
    console.log(JSON.stringify({ label: "graceful-cancel", ms: Math.round(performance.now() - start),
      terminal: a.c.lastTerminal, processAlive: a.c.process.alive }));
  } finally { cancelOnText = undefined; }
  await ask(a, "same-session-after-cancel", [{ type: "text", text: "The counting request is cancelled. New request: reply with exactly NEW_REQUEST_OK. Do not resume counting or use tools." }], "NEW_REQUEST_OK");
  console.log(JSON.stringify({ sameSessionAfterCancel: true, cacheObserved: rows.some(r => r.cached > 0),
    unknownCacheRows: rows.filter(r => r.cached === null).length }));
} finally {
  for (const { c, id } of connections) { if (id) c.discardSession(id); await c.close(); }
  cleanup.stop();
  fs.rmSync(state, { recursive: true, force: true });
}
