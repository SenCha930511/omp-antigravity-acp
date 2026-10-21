import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { SessionCleanup, saveCleanupPolicy } from "../extension/session-cleanup.ts";

function fixture(t: any) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "omp-acp-cleanup-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let now = 1_000_000;
  const living = new Set([process.pid, 987654]);
  const acp = path.join(root, "acp");
  fs.mkdirSync(path.join(acp, "conversations"), { recursive: true });
  const create = () => new SessionCleanup(path.join(root, "state"), acp, () => now, pid => living.has(pid));
  const cleaner = create();
  function session() {
    const id = randomUUID();
    for (const suffix of [".db", ".meta", ".db-wal", ".db-shm", ".db-journal"]) fs.writeFileSync(path.join(acp, "conversations", id + suffix), "fixture");
    fs.mkdirSync(path.join(acp, "brain", id, "mcp"), { recursive: true });
    fs.writeFileSync(path.join(acp, "brain", id, "mcp", "tool.json"), "{}");
    return id;
  }
  const exists = (id: string) => fs.existsSync(path.join(acp, "conversations", `${id}.db`));
  return { root, acp, cleaner, create, session, exists, living, advance: (days: number) => { now += days * 86_400_000; } };
}

async function trackedSource(f: any, id: string) {
  const root = path.join(f.root, "sessions"), file = path.join(root, "workspace", "chat.jsonl");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ type: "session", id: "omp-chat" }) + "\n");
  const mappingFile = path.join(f.root, "state", "sessions.json");
  fs.writeFileSync(mappingFile, JSON.stringify([{ piSessionId: "omp-chat", acpSessionId: id, acpModelId: "flash", cwd: f.root, messageCount: 1, historyFingerprint: "test", lastActive: Date.now() }]));
  await f.cleaner.trackSource("omp-chat", file);
  return { root, file, mappingFile };
}

test("deleted OMP source removes its mapping and owned ACP files only after two checks and lease release", async t => {
  const f = fixture(t), id = f.session();
  const token = await f.cleaner.acquire(id, true, 987654);
  const source = await trackedSource(f, id);
  fs.unlinkSync(source.file);
  f.advance(1); await f.cleaner.collect(); assert.ok(f.exists(id), "live lease protects deleted source");
  await f.cleaner.release(token); assert.ok(f.exists(id), "first missing observation only");
  f.advance(30 / 86400); await f.cleaner.collect(); assert.ok(f.exists(id), "less than one minute");
  f.advance(31 / 86400); assert.equal(await f.create().collect(), 1, "observation survives process restart");
  assert.equal(f.exists(id), false); assert.equal(fs.existsSync(source.mappingFile), false);
});

test("closing, moving, restoring or unmounting an OMP source never proves deletion", async t => {
  const f = fixture(t), id = f.session();
  const token = await f.cleaner.acquire(id, true, 987654);
  const source = await trackedSource(f, id);
  await f.cleaner.release(token); f.advance(10); await f.cleaner.collect(); assert.ok(f.exists(id));
  const moved = path.join(source.root, "other", "renamed.jsonl");
  fs.mkdirSync(path.dirname(moved)); fs.renameSync(source.file, moved);
  await f.cleaner.collect(); f.advance(1); await f.cleaner.collect(); assert.ok(f.exists(id), "search finds moved header id");
  fs.unlinkSync(moved); await f.cleaner.collect();
  fs.writeFileSync(moved, JSON.stringify({ type: "session", id: "omp-chat" }) + "\n");
  f.advance(1); await f.cleaner.collect(); assert.ok(f.exists(id), "restoration cancels pending deletion");
  fs.renameSync(source.root, source.root + "-offline");
  f.advance(1); await f.cleaner.collect(); assert.ok(f.exists(id), "missing volume/root fails closed");
  assert.ok(fs.existsSync(source.mappingFile));
});

test("off preserves deleted OMP sources and malformed relocation scans fail closed", async t => {
  const f = fixture(t), id = f.session();
  const token = await f.cleaner.acquire(id, true, 987654);
  const source = await trackedSource(f, id);
  f.cleaner.configure("off"); fs.unlinkSync(source.file); await f.cleaner.release(token);
  f.advance(10); await f.cleaner.collect(); assert.ok(f.exists(id)); assert.ok(fs.existsSync(source.mappingFile));
  f.cleaner.configure("conservative");
  fs.writeFileSync(path.join(source.root, "broken.jsonl"), "not-json");
  await f.cleaner.collect(); f.advance(10); await f.cleaner.collect(); assert.ok(f.exists(id));
  assert.ok(f.cleaner.status().failures > 0);
});

test("deleted-source reconciliation recovers after mapping removal without losing ownership proof", async t => {
  const f = fixture(t), id = f.session();
  const token = await f.cleaner.acquire(id, true, 987654);
  const source = await trackedSource(f, id);
  fs.unlinkSync(source.file); await f.cleaner.release(token);
  // Simulate the cross-file crash boundary: source evidence is durable, the
  // mapping disappeared, but the registry's deletion flag was not committed.
  fs.unlinkSync(source.mappingFile);
  f.advance(61 / 86400);
  assert.equal(await f.create().collect(), 1); assert.equal(f.exists(id), false);
});

test("an old mapping without a verified journal source is never inferred deleted", async t => {
  const f = fixture(t), id = f.session();
  const token = await f.cleaner.acquire(id, true, 987654);
  fs.writeFileSync(path.join(f.root, "state", "sessions.json"), JSON.stringify([{ piSessionId: "unknown", acpSessionId: id }]));
  await f.cleaner.release(token); f.advance(100); await f.cleaner.collect();
  assert.ok(f.exists(id));
});

test("conservative cleanup waits for successful replacement AND old process release", async t => {
  const f = fixture(t); const old = f.session(), next = f.session();
  const lease = await f.cleaner.acquire(old, true, 987654);
  await f.cleaner.retire("sid:chat", old);
  await f.cleaner.release(lease);
  assert.ok(f.exists(old), "failed/uncompleted replacement must preserve old data");
  const secondLease = await f.cleaner.acquire(old, false, 987654);
  await f.cleaner.confirm("sid:chat", next);
  assert.ok(f.exists(old), "live old connection must block removal");
  await f.cleaner.release(secondLease);
  assert.equal(f.exists(old), false);
  assert.equal(fs.existsSync(path.join(f.acp, "brain", old)), false);
  assert.ok(f.exists(next));
  assert.deepEqual(fs.readdirSync(path.join(f.acp, "conversations")), [".db", ".db-journal", ".db-shm", ".db-wal", ".meta"].map(s => next + s).sort());
});

test("off defers even confirmed superseded data; switching back retries", async t => {
  const f = fixture(t); f.cleaner.configure("off"); const id = f.session();
  const token = await f.cleaner.acquire(id, true, 987654);
  await f.cleaner.retire("chat", id); await f.cleaner.confirm("chat", randomUUID()); await f.cleaner.release(token);
  assert.ok(f.exists(id));
  f.cleaner.configure("conservative"); assert.equal(await f.cleaner.collect(), 1);
});

test("idle/resumable sessions survive conservative mode; timeout uses configured last activity", async t => {
  const f = fixture(t); const id = f.session();
  const token = await f.cleaner.acquire(id, true, 987654); await f.cleaner.release(token);
  f.advance(100); assert.equal(await f.cleaner.collect(), 0);
  f.cleaner.configure("timeout", 7); await f.cleaner.touch(id);
  f.advance(6); assert.equal(await f.cleaner.collect(), 0);
  f.advance(1); assert.equal(await f.cleaner.collect(), 1);
  assert.equal(f.exists(id), false);
});

test("independent instances share leases; parent OR server process protects a session", async t => {
  const f = fixture(t); const id = f.session();
  await f.cleaner.acquire(id, true, 987654);
  const peer = f.create(); peer.configure("timeout", 1); f.advance(2);
  f.living.delete(process.pid); assert.equal(await peer.collect(), 0, "surviving supervisor still protects data");
  f.living.add(process.pid); f.living.delete(987654); assert.equal(await peer.collect(), 0, "live OMP still protects data");
  f.living.delete(process.pid); assert.equal(await peer.collect(), 1);
});

test("unregistered and resumed legacy sessions are never adopted for deletion", async t => {
  const f = fixture(t); const unregistered = f.session(), legacy = f.session();
  const token = await f.cleaner.acquire(legacy, false, 987654); await f.cleaner.release(token);
  await f.cleaner.retire("chat", legacy); await f.cleaner.confirm("chat", randomUUID());
  f.cleaner.configure("timeout", 1); f.advance(100); await f.cleaner.collect();
  assert.ok(f.exists(unregistered)); assert.ok(f.exists(legacy));
});

test("only matching OMP replacement group can confirm retirement; cancelled replacement cannot confirm itself", async t => {
  const f = fixture(t); const id = f.session();
  const token = await f.cleaner.acquire(id, true, 987654); await f.cleaner.retire("chat-A", id); await f.cleaner.release(token);
  await f.cleaner.confirm("chat-B", randomUUID()); await f.cleaner.confirm("chat-A", id);
  assert.ok(f.exists(id)); await f.cleaner.confirm("chat-A", randomUUID()); assert.equal(f.exists(id), false);
});

test("symlinked artifacts or parent directories preserve all session files and external data", async t => {
  const f = fixture(t); const id = f.session();
  const external = path.join(f.root, "keep.txt"); fs.writeFileSync(external, "keep");
  fs.symlinkSync(external, path.join(f.acp, "brain", id, "link"));
  const token = await f.cleaner.acquire(id, true, 987654); await f.cleaner.retire("chat", id); await f.cleaner.confirm("chat", randomUUID()); await f.cleaner.release(token);
  assert.ok(f.exists(id)); assert.equal(fs.readFileSync(external, "utf8"), "keep");
  fs.unlinkSync(path.join(f.acp, "brain", id, "link"));
  fs.renameSync(path.join(f.acp, "conversations"), path.join(f.root, "external-conversations"));
  fs.symlinkSync(path.join(f.root, "external-conversations"), path.join(f.acp, "conversations"));
  assert.equal(await f.cleaner.collect(), 0); assert.ok(f.exists(id));
});

test("invalid UUID/settings, corrupted registry, and busy locks fail closed", async t => {
  const f = fixture(t);
  await assert.rejects(async () => await f.cleaner.acquire("../../credentials", true, 987654));
  for (const days of [0, NaN, 4000]) assert.throws(() => f.cleaner.configure("timeout", days));
  assert.throws(() => f.cleaner.configure("typo" as any));
  const id = f.session(); const token = await f.cleaner.acquire(id, true, 987654); await f.cleaner.release(token);
  const state = path.join(f.root, "state");
  const file = path.join(state, fs.readdirSync(state).find(n => n.startsWith("cleanup-sessions-"))!);
  fs.mkdirSync(file + ".lock");
  assert.equal(await f.cleaner.collect(), 0);
  await assert.rejects(async () => await f.cleaner.acquire(id, false, 987654));
  fs.rmdirSync(file + ".lock"); fs.writeFileSync(file, "broken");
  assert.equal(await f.cleaner.collect(), 0); assert.ok(f.exists(id));
});

test("throttled touch skips redundant disk writes within throttle window and flushes before collect", async t => {
  const f = fixture(t);
  f.cleaner.configure("timeout", 1);
  const id = f.session();
  const token = await f.cleaner.acquire(id, true, 987654);
  await f.cleaner.release(token);
  const state = path.join(f.root, "state");
  const file = path.join(state, fs.readdirSync(state).find(n => n.startsWith("cleanup-sessions-"))!);
  f.advance(0.0001); // ~8.64 seconds (< 60s throttle window)
  fs.mkdirSync(file + ".lock");
  // Within throttle window, touch() updates in-memory pendingTouches without acquiring disk lock
  await f.cleaner.touch(id);
  fs.rmdirSync(file + ".lock");
  // Advance just short of 1 day from the throttled touch; collect() flushes pendingTouches so session survives
  f.advance(0.99995);
  assert.equal(await f.cleaner.collect(), 0);
  assert.ok(f.exists(id));
  f.advance(0.0002);
  assert.equal(await f.cleaner.collect(), 1);
  assert.equal(f.exists(id), false);
});

test("quota warns in conservative mode; timeout evicts only idle unmapped owned data after grace", async t => {
  const f = fixture(t), mapped = f.session(), active = f.session(), orphan = f.session(), foreign = f.session(), unknown = f.session();
  for (const id of [mapped, orphan]) { const token = await f.cleaner.acquire(id, true, 987654); await f.cleaner.release(token); }
  await f.cleaner.acquire(active, true, 987654);
  const token = await f.cleaner.acquire(foreign, false, 987654); await f.cleaner.release(token);
  fs.writeFileSync(path.join(f.root, "state/sessions.json"), JSON.stringify([{ acpSessionId: mapped }]));
  f.cleaner.budget(1, 1);
  assert.equal(await f.cleaner.collect(), 0); assert.equal(f.cleaner.status().overBudget, true);
  f.cleaner.configure("timeout", 100); f.advance(2);
  assert.equal(await f.cleaner.collect(), 1);
  assert.equal(f.exists(orphan), false);
  for (const id of [mapped, active, foreign, unknown]) assert.ok(f.exists(id));
  assert.equal(f.cleaner.status().overBudget, true, "Protected sessions can exceed a soft budget");
});

test("confirmed cleanup is batched and lifecycle lock failures are retried without adopting data", async t => {
  const f = fixture(t); f.cleaner.configure("off");
  const ids = Array.from({ length: 5 }, () => f.session());
  for (const id of ids) { const token = await f.cleaner.acquire(id, true, 987654); await f.cleaner.retire("batch", id); await f.cleaner.release(token); }
  await f.cleaner.confirm("batch", randomUUID());
  saveCleanupPolicy(f.cleaner.policyPath, { mode: "conservative", idleDays: 7, batchSize: 2 });
  assert.equal(await f.cleaner.collect(), 2); assert.equal(f.cleaner.status().deferred, 3);
  assert.equal(await f.cleaner.collect(), 2); assert.equal(await f.cleaner.collect(), 1);
  const id = f.session(), token = await f.cleaner.acquire(id, true, 987654);
  const state = path.join(f.root, "state"), file = path.join(state, fs.readdirSync(state).find(f => f.startsWith("cleanup-sessions-"))!);
  fs.mkdirSync(file + ".lock");
  await assert.rejects(f.cleaner.retire("retry", id));
  assert.equal(f.cleaner.status().pendingLifecycleUpdates, 1); fs.rmdirSync(file + ".lock");
  await f.cleaner.collect(); assert.equal(f.cleaner.status().pendingLifecycleUpdates, 0);
  await f.cleaner.confirm("retry", randomUUID()); await f.cleaner.release(token); assert.equal(f.exists(id), false);
});

test("malformed mappings block deletion and asynchronous directory inspection yields to timers", async t => {
  const f = fixture(t), id = f.session();
  const token = await f.cleaner.acquire(id, true, 987654); await f.cleaner.release(token);
  f.cleaner.configure("timeout", 1); f.advance(2);
  fs.writeFileSync(path.join(f.root, "state/sessions.json"), "broken");
  assert.equal(await f.cleaner.collect(), 0); assert.ok(f.exists(id));
  fs.unlinkSync(path.join(f.root, "state/sessions.json"));
  for (let i = 0; i < 100; i++) fs.writeFileSync(path.join(f.acp, "brain", id, String(i)), "fixture");
  let tick = false; const timer = setTimeout(() => { tick = true; }, 0);
  assert.equal(await f.cleaner.collect(), 1); clearTimeout(timer); assert.equal(tick, true);
});
