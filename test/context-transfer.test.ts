import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPromptParts, historyBudget } from "../extension/context-transfer.ts";

const user = (content: any) => ({ role: "user", content, timestamp: 0 });
// The official ACP parser appends embedded-resource text to its result and
// merges subsequent text blocks into that string with a single space.
function parsedText(prompt: any[]) {
  const result: string[] = [];
  for (const block of prompt) {
    if (block.type === "resource") result.push(`Embedded resource (${block.resource.uri}):\n${block.resource.text}`);
    else if (block.type === "text") {
      if (result.length) result[result.length - 1] += " " + block.text;
      else result.push(block.text);
    }
  }
  return result.join("\n");
}
test("cold history and newest request remain explicitly separated after official ACP text merging", () => {
  const output = buildPromptParts({ messages: [user("OLD_REQUEST"),
    { role: "assistant", content: [{ type: "text", text: "OLD_ALREADY_ANSWERED" }] }, user("NEW_REQUEST")] }, true);
  const parsed = parsedText(output.prompt);
  assert.match(parsed, /Do not answer historical user requests/);
  assert.match(parsed, /# End of prior OMP conversation[\s\S]*\n\n# Current OMP user request\n\n[\s\S]*NEW_REQUEST$/);
  assert.equal(output.prompt.at(-1).text, "NEW_REQUEST");
});
test("cold handoff after a tool result explicitly resumes the active request instead of restarting it", () => {
  const output = buildPromptParts({ messages: [user("OLD_REQUEST"), user("ACTIVE_REQUEST"),
    { role: "assistant", content: [{ type: "toolCall", id: "call-active", name: "read", arguments: {} }] },
    { role: "toolResult", toolName: "read", toolCallId: "call-active", content: [{ type: "text", text: "ALREADY_READ" }] }] }, true);
  const parsed = parsedText(output.prompt);
  assert.match(parsed, /already in progress/);
  assert.match(parsed, /Continue from those results/);
  assert.ok(parsed.includes("call-active") && parsed.includes("ALREADY_READ"));
  assert.equal(output.prompt.at(-1).text, "ACTIVE_REQUEST");
});
test("warm new user turn has an explicit current-request boundary without replaying old tasks", () => {
  const output = buildPromptParts({ messages: [user("OLD_REQUEST"),
    { role: "assistant", content: [{ type: "text", text: "DONE" }] }, user("NEW_REQUEST")] }, false, 2);
  const parsed = parsedText(output.prompt);
  assert.match(parsed, /# Current OMP user request\n\n[\s\S]*NEW_REQUEST$/);
  assert.ok(!parsed.includes("OLD_REQUEST"));
});
test("cold transfer retains old text beyond the former 32000-character cutoff", () => {
  const context = { systemPrompt: "RULES", messages: [user("EARLY_MARKER" + "x".repeat(80_000)), user("LATEST")] };
  const output = buildPromptParts(context, true, undefined, { contextWindow: 1_000_000 });
  const encoded = JSON.stringify(output.prompt);
  assert.ok(encoded.includes("EARLY_MARKER"));
  assert.ok(encoded.includes("RULES"));
  assert.equal(output.prompt.at(-1).text, "LATEST");
});
test("overflow fails explicitly instead of silently losing history or tool results", () => {
  assert.throws(() => buildPromptParts({ messages: [user("x".repeat(1_500_000)), user("LATEST")] }, true, undefined, { contextWindow: 1_000_000, policy: { inputTokenBudget: 400_000 } }), /Maximum context length exceeded/);
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
test("byte budget is independent of token windows and can exceed the old 500KB limit", () => {
  assert.equal(historyBudget(1_000_000, {}), 16_777_216);
  assert.equal(historyBudget(32_768, {}), 16_777_216);
  assert.equal(historyBudget(1_000_000, { OMP_ACP_HISTORY_BYTES: "33554432" }), 33_554_432);
  assert.throws(() => historyBudget(1_000_000, { OMP_ACP_HISTORY_BYTES: "NaN" }), /must be/);
  const output = buildPromptParts({ messages: [user("x".repeat(1_200_000)), user("LATEST")] }, true, undefined, { contextWindow: 1_000_000 });
  assert.ok(JSON.stringify(output).length > 1_200_000);
});
