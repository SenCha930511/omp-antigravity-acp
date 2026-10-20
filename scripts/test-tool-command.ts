// Offline command integration test; requires Bun but never launches ACP.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { registerOmpAdapter } from "../extension/index.ts";
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "omp-tool-command-"));
const hooks = new Map<string, Function>();
let command: any;
try {
  await registerOmpAdapter({
    on(name: string, handler: Function) { hooks.set(name, handler); },
    registerProvider() {}, registerTool() {},
    registerCommand(_name: string, registered: any) { command = registered; },
  }, temporary);
  const notices: string[] = [];
  const context = { ui: { notify: (text: string) => notices.push(text) }, sessionManager: { getSessionId: () => "fixture" } };
  for (const mode of ["disabled", "prefer"]) {
    await command.handler(`native-tools ${mode}`, context);
    const policy = JSON.parse(await fs.readFile(path.join(temporary, "omp-tools.json"), "utf8"));
    assert.equal(policy.nativeTools, mode);
  }
  await assert.rejects(command.handler("native-tools typo", context), /must be prefer or disabled/);
  assert.equal(JSON.parse(await fs.readFile(path.join(temporary, "omp-tools.json"), "utf8")).nativeTools, "prefer");
  assert.ok(notices.length === 2);
  console.log("Isolated native-tool command persistence and validation: PASS");
} finally {
  await hooks.get("session_shutdown")?.({}, {});
  await fs.rm(temporary, { recursive: true, force: true });
}
