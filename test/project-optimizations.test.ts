import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Diagnostics } from "../extension/diagnostics.ts";
import { CatalogStore } from "../extension/catalog-store.ts";
import { SessionRuntimePool } from "../extension/runtime-pool.ts";
import { registerOmpAdapter } from "../extension/index.ts";
import { Type } from "../extension/runtime.mjs";

test("actual OMP wrapper refreshes tool audit for same-array additions/removals and schema/name edits", async () => {
  const state = await fs.mkdtemp(path.join(os.tmpdir(), "omp-tools-mutable-"));
  const hooks = new Map<string, Function>(), notices: string[] = [];
  let provider: any, command: any;
  try {
    await registerOmpAdapter({ on: (name: string, fn: Function) => hooks.set(name, fn), registerTool() {},
      registerProvider: (_name: string, value: any) => { provider = value; },
      registerCommand: (_name: string, value: any) => { command = value; } }, state);
    const tools: any[] = [{ name: "read", description: "read", parameters: Type.Object({ path: Type.String() }) }];
    async function audit() {
      // Abort before startup: exercises real tool projection, but never spawns
      // ACP, reads credentials or sends a model request.
      for await (const _ of provider.streamSimple(provider.models[0], { messages: [{ role: "user", content: "synthetic", timestamp: 1 }], tools }, { signal: AbortSignal.abort() })) {}
      await command.handler("tools", { ui: { notify: (s: string) => notices.push(s) } });
      return notices.pop()!;
    }
    assert.match(await audit(), /Available: read/);
    tools.push({ name: "bash", parameters: Type.Object({ cmd: Type.String() }) });
    assert.match(await audit(), /Available: bash, read/);
    tools.splice(0, 1); assert.match(await audit(), /Available: bash\n/);
    tools[0].name = "renamed"; assert.match(await audit(), /Available: renamed/);
    tools[0].parameters.type = "array"; assert.match(await audit(), /schema omitted/);
  } finally { await hooks.get("session_shutdown")?.({}, {}); await fs.rm(state, { recursive: true, force: true }); }
});

test("idle runtime cap evicts LRU only, protects leases/busy work and awaits pending teardown", async () => {
  const closed: number[] = []; let serial = 0, busy = false;
  const pool = new SessionRuntimePool(() => ({ id: ++serial }), async entry => { closed.push(entry.id); },
    { timeoutMs: 0, maxIdleEntries: 1, canDispose: () => !busy });
  const active = pool.acquire("active");
  const old = pool.get("old"); pool.get("recent");
  assert.deepEqual(closed, [old.id]); assert.ok(pool.peek("active"));
  busy = true; pool.get("busy"); assert.ok(pool.peek("recent"));
  busy = false; active.release();
  assert.equal(pool.values().length, 1);
  await pool.closeAll(); assert.equal(new Set(closed).size, serial);
});

test("model discovery is single-flight, shares failure and retries on next refresh", async () => {
  const state = await fs.mkdtemp(path.join(os.tmpdir(), "omp-discovery-shared-"));
  try {
    const store: any = new CatalogStore(path.join(state, "models.json"), {} as any, async () => {}, () => []);
    let calls = 0, fail = true;
    store.discoverOnce = async () => { calls++; await Promise.resolve(); if (fail) throw new Error("synthetic"); return [{ modelId: "gemini-3.8-flash", name: "Flash" }]; };
    const failed = await Promise.allSettled([store.refresh({ defaults: {}, models: {} }), store.refresh({ defaults: {}, models: {} })]);
    assert.equal(calls, 1); assert.ok(failed.every(r => r.status === "rejected"));
    fail = false;
    await Promise.all([store.refresh({ defaults: {}, models: {} }), store.refresh({ defaults: {}, models: {} })]);
    assert.equal(calls, 2); assert.equal(store.currentModels[0].id, "gemini-3.8-flash");
  } finally { await fs.rm(state, { recursive: true, force: true }); }
});

test("shared refresh uses the latest settings and removes stale model entries", async () => {
  const state = await fs.mkdtemp(path.join(os.tmpdir(), "omp-refresh-settings-"));
  try {
    const store = new CatalogStore(path.join(state, "models.json"), {} as any, async () => {}, () => []);
    const gate = Promise.withResolvers<any[]>();
    store.discoverModels = () => gate.promise;
    const first = store.refresh({ defaults: { contextWindow: 65536 }, models: {} });
    const second = store.refresh({ defaults: { contextWindow: 131072 }, models: {} });
    gate.resolve([{ modelId: "gemini-3.8-flash", name: "Flash" }]);
    const [a, b] = await Promise.all([first, second]);
    assert.equal(a, b); assert.equal(a[0].contextWindow, 131072);
    store.projectWithSettings([], { defaults: {}, models: {} });
    assert.equal(store.upstreamModels.size, 0);
  } finally { await fs.rm(state, { recursive: true, force: true }); }
});

test("global shutdown waits for a detached runtime teardown", async () => {
  const gate = Promise.withResolvers<void>();
  const pool = new SessionRuntimePool(() => ({}), () => gate.promise);
  pool.get("closing");
  const closing = pool.close("closing");
  let stopped = false;
  const stopping = pool.closeAll().then(() => { stopped = true; });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(stopped, false);
  gate.resolve(); await Promise.all([closing, stopping]);
  assert.equal(stopped, true);
});

test("diagnostics defaults off, bounds samples, persists only enablement and clears on disable", async () => {
  const state = await fs.mkdtemp(path.join(os.tmpdir(), "omp-diagnostics-"));
  try {
    const file = path.join(state, "diagnostics.json"), d = new Diagnostics(file);
    d.record("ignored", 1); assert.equal(d.status().samples, 0);
    d.configure(true); for (let i = 0; i < 200; i++) d.record("history.compare", i);
    assert.equal(d.status().samples, 128);
    assert.deepEqual(JSON.parse(await fs.readFile(file, "utf8")), { enabled: true });
    assert.equal(new Diagnostics(file).status().enabled, true);
    d.configure(false); assert.equal(d.status().samples, 0);
  } finally { await fs.rm(state, { recursive: true, force: true }); }
});
