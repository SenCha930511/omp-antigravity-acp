import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profile = `fingerprint-probe-${randomUUID()}`, profilePath = path.join(os.homedir(), ".omp/profiles", profile);
await fs.mkdir(profilePath, { recursive: true });
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "omp-fingerprint-host-"));
let child;
try {
  child = spawn("omp", ["--mode", "rpc", "--no-ui", "--no-extensions", "-e", path.join(root, "test/fixtures/fingerprint-identity-extension.ts"),
    "--model", "fingerprint-probe/probe", "--api-key", "synthetic-probe-marker", "--no-tools", "--no-skills", "--no-rules", "--no-title", "--no-session", "--no-prewalk", "--system-prompt", "Offline diagnostic."],
    { cwd: temp, env: { ...process.env, OMP_PROFILE: profile, AGY_ACP_BIN: "/usr/bin/false" }, stdio: ["pipe", "pipe", "pipe"] });
  let stderr = "", turns = 0;
  child.stderr.on("data", data => { stderr += data; });
  const done = Promise.withResolvers();
  child.on("error", done.reject); child.on("exit", code => done.resolve(code));
  const timeout = setTimeout(() => { child.kill("SIGTERM"); done.reject(new Error("Offline host probe timed out: " + stderr.slice(-1000))); }, 20_000);
  const send = message => child.stdin.write(JSON.stringify({ type: "prompt", message }) + "\n");
  send("Reference: " + "stable ".repeat(1500));
  try {
    for await (const line of createInterface({ input: child.stdout })) {
      let event; try { event = JSON.parse(line); } catch { continue; }
      if (event.type === "response" && event.success === false) throw new Error(JSON.stringify(event));
      if (event.type !== "agent_end") continue;
      if (++turns < 3) send("Next request " + turns);
      else child.stdin.end();
    }
    await done.promise;
    const rows = stderr.split("\n").filter(l => l.startsWith("FINGERPRINT_IDENTITY ")).map(l => JSON.parse(l.slice("FINGERPRINT_IDENTITY ".length)));
    assert.equal(rows.length, 3);
    console.log(JSON.stringify({ ompHost: "real RPC process, offline provider", rows }));
  } finally { clearTimeout(timeout); }
} finally {
  if (child?.exitCode === null) child.kill("SIGTERM");
  await fs.rm(profilePath, { recursive: true, force: true });
  await fs.rm(temp, { recursive: true, force: true });
}
