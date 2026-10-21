import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { SessionCleanup } from "../extension/session-cleanup.ts";

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

test("conservative cleanup waits for successful replacement AND old process release", t => {
  const f = fixture(t); const old = f.session(), next = f.session();
  const lease = f.cleaner.acquire(old, true, 987654);
  f.cleaner.retire("sid:chat", old);
  f.cleaner.release(lease);
  assert.ok(f.exists(old), "failed/uncompleted replacement must preserve old data");
  const secondLease = f.cleaner.acquire(old, false, 987654);
  f.cleaner.confirm("sid:chat", next);
  assert.ok(f.exists(old), "live old connection must block removal");
  f.cleaner.release(secondLease);
  assert.equal(f.exists(old), false);
  assert.equal(fs.existsSync(path.join(f.acp, "brain", old)), false);
  assert.ok(f.exists(next));
  assert.deepEqual(fs.readdirSync(path.join(f.acp, "conversations")), [".db", ".db-journal", ".db-shm", ".db-wal", ".meta"].map(s => next + s).sort());
});

test("off defers even confirmed superseded data; switching back retries", t => {
  const f = fixture(t); f.cleaner.configure("off"); const id = f.session();
  const token = f.cleaner.acquire(id, true, 987654);
  f.cleaner.retire("chat", id); f.cleaner.confirm("chat", randomUUID()); f.cleaner.release(token);
  assert.ok(f.exists(id));
  f.cleaner.configure("conservative"); assert.equal(f.cleaner.collect(), 1);
});

test("idle/resumable sessions survive conservative mode; timeout uses configured last activity", t => {
  const f = fixture(t); const id = f.session();
  const token = f.cleaner.acquire(id, true, 987654); f.cleaner.release(token);
  f.advance(100); assert.equal(f.cleaner.collect(), 0);
  f.cleaner.configure("timeout", 7); f.cleaner.touch(id);
  f.advance(6); assert.equal(f.cleaner.collect(), 0);
  f.advance(1); assert.equal(f.cleaner.collect(), 1);
  assert.equal(f.exists(id), false);
});

test("independent instances share leases; parent OR server process protects a session", t => {
  const f = fixture(t); const id = f.session();
  f.cleaner.acquire(id, true, 987654);
  const peer = f.create(); peer.configure("timeout", 1); f.advance(2);
  f.living.delete(process.pid); assert.equal(peer.collect(), 0, "surviving supervisor still protects data");
  f.living.add(process.pid); f.living.delete(987654); assert.equal(peer.collect(), 0, "live OMP still protects data");
  f.living.delete(process.pid); assert.equal(peer.collect(), 1);
});

test("unregistered and resumed legacy sessions are never adopted for deletion", t => {
  const f = fixture(t); const unregistered = f.session(), legacy = f.session();
  const token = f.cleaner.acquire(legacy, false, 987654); f.cleaner.release(token);
  f.cleaner.retire("chat", legacy); f.cleaner.confirm("chat", randomUUID());
  f.cleaner.configure("timeout", 1); f.advance(100); f.cleaner.collect();
  assert.ok(f.exists(unregistered)); assert.ok(f.exists(legacy));
});

test("only matching OMP replacement group can confirm retirement; cancelled replacement cannot confirm itself", t => {
  const f = fixture(t); const id = f.session();
  const token = f.cleaner.acquire(id, true, 987654); f.cleaner.retire("chat-A", id); f.cleaner.release(token);
  f.cleaner.confirm("chat-B", randomUUID()); f.cleaner.confirm("chat-A", id);
  assert.ok(f.exists(id)); f.cleaner.confirm("chat-A", randomUUID()); assert.equal(f.exists(id), false);
});

test("symlinked artifacts or parent directories preserve all session files and external data", t => {
  const f = fixture(t); const id = f.session();
  const external = path.join(f.root, "keep.txt"); fs.writeFileSync(external, "keep");
  fs.symlinkSync(external, path.join(f.acp, "brain", id, "link"));
  const token = f.cleaner.acquire(id, true, 987654); f.cleaner.retire("chat", id); f.cleaner.confirm("chat", randomUUID()); f.cleaner.release(token);
  assert.ok(f.exists(id)); assert.equal(fs.readFileSync(external, "utf8"), "keep");
  fs.unlinkSync(path.join(f.acp, "brain", id, "link"));
  fs.renameSync(path.join(f.acp, "conversations"), path.join(f.root, "external-conversations"));
  fs.symlinkSync(path.join(f.root, "external-conversations"), path.join(f.acp, "conversations"));
  assert.equal(f.cleaner.collect(), 0); assert.ok(f.exists(id));
});

test("invalid UUID/settings, corrupted registry, and busy locks fail closed", t => {
  const f = fixture(t);
  assert.throws(() => f.cleaner.acquire("../../credentials", true, 987654));
  for (const days of [0, NaN, 4000]) assert.throws(() => f.cleaner.configure("timeout", days));
  assert.throws(() => f.cleaner.configure("typo" as any));
  const id = f.session(); const token = f.cleaner.acquire(id, true, 987654); f.cleaner.release(token);
  const state = path.join(f.root, "state");
  const file = path.join(state, fs.readdirSync(state).find(n => n.startsWith("cleanup-sessions-"))!);
  fs.mkdirSync(file + ".lock");
  assert.equal(f.cleaner.collect(), 0);
  assert.throws(() => f.cleaner.acquire(id, false, 987654));
  fs.rmdirSync(file + ".lock"); fs.writeFileSync(file, "broken");
  assert.equal(f.cleaner.collect(), 0); assert.ok(f.exists(id));
});

test("throttled touch skips redundant disk writes within throttle window and flushes before collect", t => {
  const f = fixture(t);
  f.cleaner.configure("timeout", 1);
  const id = f.session();
  const token = f.cleaner.acquire(id, true, 987654);
  f.cleaner.release(token);
  const state = path.join(f.root, "state");
  const file = path.join(state, fs.readdirSync(state).find(n => n.startsWith("cleanup-sessions-"))!);
  f.advance(0.0001); // ~8.64 seconds (< 60s throttle window)
  fs.mkdirSync(file + ".lock");
  // Within throttle window, touch() updates in-memory pendingTouches without acquiring disk lock
  f.cleaner.touch(id);
  fs.rmdirSync(file + ".lock");
  // Advance just short of 1 day from the throttled touch; collect() flushes pendingTouches so session survives
  f.advance(0.99995);
  assert.equal(f.cleaner.collect(), 0);
  assert.ok(f.exists(id));
  f.advance(0.0002);
  assert.equal(f.cleaner.collect(), 1);
  assert.equal(f.exists(id), false);
});
