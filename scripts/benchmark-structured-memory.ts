// Synthetic retained-heap probe. No model traffic, user files or disk cache.
import { setImmediate as immediate } from "node:timers/promises";
import { AntigravityRuntime, Type } from "../extension/runtime.mjs";
const gc = (globalThis as any).gc;
if (!gc) throw new Error("Run with --expose-gc");
async function collect() {
  for (let i = 0; i < 4; i++) {
    await immediate();
    if ((globalThis as any).Bun) (globalThis as any).Bun.gc(true); else gc();
  }
}
async function prime() {
  const runtime: any = new AntigravityRuntime(() => {}, "yolo");
  const tools = Array.from({ length: 64 }, (_, i) => ({ name: `tool_${i}`, description: "offline",
    execute: async () => {}, parameters: Type.Object(Object.fromEntries(Array.from({ length: 30 }, (_, j) =>
      [`field_${j}`, Type.String({ description: "schema documentation ".repeat(20) })]))) }));
  const system = { role: "system", content: "rules", toolsAdded: tools };
  // Settle the original serializer/string-flattening cost before measuring
  // snapshot metadata, rather than attributing all first-use allocation to it.
  const systemMemo = runtime.ompSystemMemo, toolsMemo = runtime.ompToolsMemo;
  const bypass = (_value: any, compute: () => string) => compute();
  runtime.ompSystemMemo = bypass; runtime.ompToolsMemo = bypass;
  runtime.ompMessageFingerprint(system); runtime.ompToolsFingerprint(tools);
  runtime.ompSystemMemo = systemMemo; runtime.ompToolsMemo = toolsMemo;
  await collect(); const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 20; i++) { runtime.ompMessageFingerprint({ ...system }); runtime.ompToolsFingerprint([...tools]); }
  await collect();
  return { runtime, before, cached: process.memoryUsage().heapUsed, weak: new WeakRef(tools[0].execute) };
}
const result = await prime(); await collect();
const closureCollectedWhileCached = result.weak.deref() === undefined;
const beforeClose = process.memoryUsage().heapUsed;
await result.runtime.close(); await collect();
console.log(JSON.stringify({ tools: 64, fieldsPerTool: 30, snapshotHeapDeltaBytes: result.cached - result.before,
  releasedOnCloseBytes: beforeClose - process.memoryUsage().heapUsed, closureCollectedWhileCached,
  runtime: process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.version}` }));
