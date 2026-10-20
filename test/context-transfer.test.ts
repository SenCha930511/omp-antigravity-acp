import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPromptParts, historyBudget } from "../extension/context-transfer.ts";

const user = (content: any) => ({ role: "user", content, timestamp: 0 });
test("cold transfer retains old text beyond the former 32000-character cutoff", () => {
  const context = { systemPrompt: "RULES", messages: [user("EARLY_MARKER" + "x".repeat(80_000)), user("LATEST")] };
  const output = buildPromptParts(context, true, undefined, { contextWindow: 1_000_000 });
  const encoded = JSON.stringify(output.prompt);
  assert.ok(encoded.includes("EARLY_MARKER"));
  assert.ok(encoded.includes("RULES"));
  assert.equal(output.prompt.at(-1).text, "LATEST");
});
test("overflow fails explicitly instead of silently losing history or tool results", () => {
  assert.throws(() => buildPromptParts({ messages: [user("x".repeat(600_000)), user("LATEST")] }, true, undefined, { contextWindow: 1_000_000 }), /Use OMP \/compact/);
});
test("warm delta sends only external results and retains tool identities", () => {
  const messages = [user("OLD"), user("CURRENT"), { role: "toolResult", toolName: "read", toolCallId: "call-42", content: [{ type: "text", text: "RESULT" }] }];
  const output = buildPromptParts({ messages }, false, 2, { contextWindow: 1_000_000 });
  const text = JSON.stringify(output.prompt);
  assert.ok(text.includes("RESULT")); assert.ok(text.includes("call-42"));
  assert.ok(!text.includes('"OLD"')); assert.ok(!text.includes('"CURRENT"'));
  assert.equal(output.messageCount, 3);
});
test("historical images remain actual attachments; thinking is not replayed as text", () => {
  const image = { type: "image", data: "aW1hZ2U=", mimeType: "image/png" };
  const messages = [user([image]), { role: "assistant", content: [{ type: "thinking", thinking: "PRIVATE" }, { type: "text", text: "ANSWER" }] }, user("NEXT")];
  const output = buildPromptParts({ messages }, true, undefined, { contextWindow: 1_000_000 });
  assert.deepEqual(output.prompt.find(x => x.type === "image"), image);
  assert.ok(!JSON.stringify(output).includes("PRIVATE"));
});
test("transfer budget validates configuration and caps unknown model sizes", () => {
  assert.equal(historyBudget(1_000_000, {}), 500_000);
  assert.equal(historyBudget(32_768, {}), 16_384);
  assert.throws(() => historyBudget(1_000_000, { OMP_ACP_HISTORY_BYTES: "NaN" }), /must be/);
});
