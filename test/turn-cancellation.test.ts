import { test } from "node:test";
import assert from "node:assert/strict";
import { drainCancelledTurn } from "../extension/turn-cancellation.ts";

test("drain stops old waits and waits for terminal completion before accepting another request", async () => {
  const pending = Promise.withResolvers<void>();
  const steps: string[] = [];
  const binding = { session: { sessionId: "old" }, turnCompletion: pending.promise,
    connection: { async cancel(id: string) { assert.equal(id, "old"); steps.push("cancel"); pending.resolve(); } } };
  assert.equal(await drainCancelledTurn(binding, () => steps.push("stop-waits")), true);
  assert.deepEqual(steps, ["stop-waits", "cancel"]);
});
test("unacknowledged, failed or pre-aborted cancellation requests require reconstruction", async () => {
  const never = Promise.withResolvers<void>();
  const binding = { session: { sessionId: "old" }, turnCompletion: never.promise,
    connection: { async cancel() {} } };
  assert.equal(await drainCancelledTurn(binding, () => {}, undefined, 10), false);
  assert.equal(await drainCancelledTurn({ ...binding, connection: { async cancel() { throw new Error("closed"); } } }, () => {}), false);
  assert.equal(await drainCancelledTurn(binding, () => {}, AbortSignal.abort()), false);
});
