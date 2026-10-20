import { test } from "node:test";
import assert from "node:assert/strict";
import { usageFromPrompt } from "../extension/usage.ts";
import { stableTools } from "../extension/tool-order.ts";

test("OMP receives context occupancy separately from multi-call billable usage", () => {
  const usage = usageFromPrompt({ usage: { inputTokens: 36_554, outputTokens: 613 }, _meta: { ompContextTokens: 12_695 } });
  assert.equal(usage.totalTokens, 37167);
  assert.equal(usage.contextTokens, 12695);
  assert.equal(usageFromPrompt({ _meta: { ompContextTokens: -1 } }).contextTokens, undefined);
});
test("reordered tools retain stable schemas and function identities without changing the caller", () => {
  const read = { name: "read", execute() {} }, bash = { name: "bash", execute() {} };
  const original = [read, bash];
  assert.deepEqual(stableTools(original), stableTools([bash, read]));
  assert.equal(stableTools(original)[1], read);
  assert.equal(original[0], read);
});
