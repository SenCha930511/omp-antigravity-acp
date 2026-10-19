import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { ADAPTER_NAME, ADAPTER_VERSION, ensureAdapter } from "../marketplace/antigravity-acp/provision.ts";

async function fakeInstall(directory: string) {
  const root = path.join(directory, "node_modules", ADAPTER_NAME);
  await fs.mkdir(path.join(root, "extension"), { recursive: true });
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ name: ADAPTER_NAME, version: ADAPTER_VERSION }));
  await fs.writeFile(path.join(root, "extension/index.ts"), "export default () => {};");
  await fs.writeFile(path.join(root, "extension/runtime.mjs"), "export {};");
}

test("marketplace provision shares concurrent work and warm loads stay offline", async () => {
  const root = await fs.mkdtemp(path.join(tmpdir(), "omp-marketplace-unit-"));
  try {
    let installs = 0;
    const install = async (directory: string) => { installs++; await fakeInstall(directory); };
    const [first, second] = await Promise.all([ensureAdapter(root, install), ensureAdapter(root, install)]);
    assert.equal(first, second);
    assert.equal(installs, 1);
    assert.equal(await ensureAdapter(root, async () => { throw Error("unexpected network"); }), first);
    assert.deepEqual(await fs.readdir(root), [ADAPTER_VERSION]);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test("failed marketplace preparation is cleaned and can be retried", async () => {
  const root = await fs.mkdtemp(path.join(tmpdir(), "omp-marketplace-unit-"));
  try {
    await assert.rejects(ensureAdapter(root, async () => { throw Error("offline"); }), /offline/);
    assert.deepEqual(await fs.readdir(root), []);
    await ensureAdapter(root, fakeInstall);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test("missing prebuilt content is not promoted into the cache", async () => {
  const root = await fs.mkdtemp(path.join(tmpdir(), "omp-marketplace-unit-"));
  try {
    await assert.rejects(ensureAdapter(root, async () => {}), /pinned prebuilt adapter/);
    assert.deepEqual(await fs.readdir(root), []);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
