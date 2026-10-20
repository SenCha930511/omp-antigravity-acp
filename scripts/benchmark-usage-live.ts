// Explicit Flash-only benchmark; six tiny model turns, no tools or workspace I/O.
import assert from "node:assert/strict";
import { TierConnection } from "../extension/runtime.mjs";
import { thoughtRoute } from "../extension/model-catalog.ts";
if (!process.argv.includes("--live")) throw new Error("Pass --live; consumes Flash quota and creates two ACP sessions.");
const rows: any[] = [], connections: any[] = [];
const fixtures = new Map<string, any>();
try {
  for (const mode of ["auto", "off"] as const) {
    const timing = { first: 0, last: 0 };
    const c = new TierConnection({ cwd: process.cwd(), ompNativeTools: "disabled", ompUsageMode: mode,
      handlers: { onUpdate: (n: any) => {
        if (n.update.sessionUpdate === "agent_message_chunk" && n.update.content.type === "text") {
          timing.first ||= performance.now(); timing.last = performance.now();
        }
      } } });
    connections.push(c);
    await c.initialize();
    const s = await c.newSession(process.cwd());
    await c.setModel(s.sessionId, thoughtRoute("gemini-3.8-flash", "low"));
    fixtures.set(mode, { c, id: s.sessionId, timing });
  }
  for (const mode of ["auto", "off", "off", "auto", "auto", "off"]) {
    const { c, id, timing } = fixtures.get(mode);
    timing.first = timing.last = 0;
    const beforeMs = c.usageQueryMs, beforeQueries = c.usageQueryCount;
    const start = performance.now();
    await c.prompt({ sessionId: id, prompt: [{ type: "text", text: "Reply with exactly OK. Do not use tools." }] }, AbortSignal.timeout(120000));
    const end = performance.now();
    assert.ok(timing.last > 0);
    if (mode === "off") assert.equal(c.usageQueryCount, 0);
    const row = { mode, firstTextMs: timing.first - start, textDoneMs: timing.last - start,
      turnDoneMs: end - start, tailMs: end - timing.last,
      usageQueryMs: c.usageQueryMs - beforeMs, queries: c.usageQueryCount - beforeQueries };
    rows.push(row); console.log(JSON.stringify(row));
  }
  const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
  console.log(JSON.stringify({ summary: ["auto", "off"].map(mode => ({ mode, samples: 3,
    medianTailMs: median(rows.filter(r => r.mode === mode).map(r => r.tailMs)),
    medianTurnMs: median(rows.filter(r => r.mode === mode).map(r => r.turnDoneMs)),
    medianUsageQueryMs: median(rows.filter(r => r.mode === mode).map(r => r.usageQueryMs)) })) }));
} finally { await Promise.all(connections.map(c => c.close())); }
