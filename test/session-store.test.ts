import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { lock } from "proper-lockfile";
import { AcpSessionStore } from "../extension/runtime.mjs";

const record = (id: string) => ({ piSessionId: id, acpSessionId: id, acpModelId: "flash", cwd: "/synthetic",
  messageCount: 1, historyFingerprint: "digest", lastActive: Date.now(), ompCancelledCheckpoint: true });
async function fixture(run: (file: string) => Promise<void>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-async-store-"));
  try { await run(path.join(root, "sessions.json")); }
  finally { await fs.rm(root, { recursive: true, force: true }); }
}

test("contended checkpoint lock yields to the event loop and persists before resolving", async () => fixture(async file => {
  const release = await lock(file, { realpath: false });
  const store = new AcpSessionStore(file);
  let settled = false;
  const save = store.save(record("one")).then(() => { settled = true; });
  try {
    await delay(30);
    assert.equal(settled, false, "A timer runs while a competing process/instance holds the lock");
  } finally { await release(); }
  await save;
  assert.equal((await store.get("one"))?.historyFingerprint, "digest");
  assert.equal(JSON.parse(await fs.readFile(file, "utf8"))[0].ompCancelledCheckpoint, true);
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
}));

test("separate processes merge records; ordered clear/remove cannot be overtaken by old writes", async () => fixture(async file => {
  const bundle = pathToFileURL(path.resolve("extension/runtime.mjs")).href;
  const script = `const {AcpSessionStore}=await import(${JSON.stringify(bundle)});
    const store=new AcpSessionStore(process.argv[1]); const prefix=process.argv[2];
    for(let i=0;i<6;i++) await store.save({piSessionId:prefix+i,acpSessionId:prefix+i,acpModelId:'flash',cwd:'/synthetic',messageCount:1,historyFingerprint:'digest',lastActive:Date.now()});
    await store.flush();`;
  const children = ["A", "B"].map(prefix => spawn(process.execPath, ["--input-type=module", "-e", script, file, prefix], { stdio: "ignore" }));
  const exits = children.map(child => once(child, "exit"));
  const a = new AcpSessionStore(file), b = new AcpSessionStore(file);
  await Promise.all(Array.from({ length: 6 }, (_, i) => (i % 2 ? a : b).save(record("P" + i))));
  for (const result of await Promise.all(exits)) assert.equal(result[0], 0);
  assert.equal(JSON.parse(await fs.readFile(file, "utf8")).length, 18);
  const mutable = record("captured"), save = a.save(mutable);
  mutable.historyFingerprint = "changed after enqueue";
  await save;
  assert.equal((await b.get("captured"))?.historyFingerprint, "digest");
  const writes = [a.save(record("old")), b.remove("old"), a.clear(), b.save(record("new"))];
  await Promise.all(writes); await a.flush();
  assert.deepEqual(JSON.parse(await fs.readFile(file, "utf8")).map((value: any) => value.piSessionId), ["new"]);
}));

test("corrupt/failed registry writes preserve data, clean temporary files, and do not poison the queue", async () => fixture(async file => {
  const store = new AcpSessionStore(file);
  await fs.writeFile(file, "{corrupt");
  await assert.rejects(store.save(record("bad")));
  assert.equal(await fs.readFile(file, "utf8"), "{corrupt");
  await fs.rm(file); await fs.mkdir(file);
  await assert.rejects(store.save(record("bad")));
  assert.deepEqual((await fs.readdir(path.dirname(file))).filter(name => name.endsWith(".tmp")), []);
  await fs.rm(file, { recursive: true });
  await store.save(record("recovered")); await store.flush();
  assert.ok(await store.get("recovered"));
}));
