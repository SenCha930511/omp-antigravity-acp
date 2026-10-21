// Offline auth command integration test; requires Bun but never launches ACP,
// never touches the real ~/.gemini directory, OMP state or the macOS keychain.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { registerOmpAdapter, keychain } from "../extension/index.ts";
import { AntigravityRuntime } from "../extension/runtime.mjs";
import { SessionRuntimePool } from "../extension/runtime-pool.ts";

const MARKER = "pi-antigravity-acp:managed-by-antigravity";
const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-auth-command-"));
const geminiHome = await fs.mkdtemp(path.join(os.tmpdir(), "omp-auth-gemini-"));
// Isolate every Antigravity-owned path the handlers touch.
process.env.GEMINI_HOME = geminiHome;
// A local executable makes ensureAntigravityAcpReady resolve offline; the
// loginGoogle prototype stub below keeps it from ever being spawned.
process.env.AGY_ACP_BIN = process.execPath;
const originalPresent = keychain.present;
const originalRemove = keychain.remove;
const originalLoginGoogle = AntigravityRuntime.prototype.loginGoogle;
const originalPoolValues = SessionRuntimePool.prototype.values;
const keychainCalls: string[] = [];
const hooks = new Map<string, Function>();
let command: any;
try {
  keychain.present = () => { keychainCalls.push("present"); return true; };
  keychain.remove = () => { keychainCalls.push("remove"); return true; };
  await registerOmpAdapter({
    on(name: string, handler: Function) { hooks.set(name, handler); },
    registerProvider() {}, registerTool() {},
    registerCommand(_name: string, registered: any) { command = registered; },
  }, stateDir);

  const notices: string[] = [];
  const inputs: { message: string; placeholder?: string }[] = [];
  const ompCredentials = new Map<string, any>();
  let refreshCalls = 0;
  const baseContext = {
    ui: { notify: (text: string) => notices.push(text), input: async (message: string, placeholder?: string) => { inputs.push({ message, placeholder }); return "http://127.0.0.1:45678/?state=abc&code=xyz"; } },
    sessionManager: { getSessionId: () => "fixture" },
  };
  const context = { ...baseContext, modelRegistry: {
    authStorage: {
      credentials: {
        getOAuth: (provider: string) => ompCredentials.get(provider),
        remove: async (provider: string) => { ompCredentials.delete(provider); },
      },
      keys: { describe: () => "local store (oauth marker)" },
    },
    refreshProvider: async () => { refreshCalls++; },
  } };
  ompCredentials.set("antigravity-acp", { type: "oauth", refresh: MARKER, access: MARKER, expires: Number.MAX_SAFE_INTEGER, authorizedAt: 1234567890123 });
  const sessionRecord = {
    piSessionId: "018f24e1-7cbb-7000-8000-000000000001", acpSessionId: "018f24e1-7cbb-7000-8000-000000000002",
    acpModelId: "gemini-3.8-flash", cwd: stateDir, messageCount: 2, historyFingerprint: "f".repeat(64),
    expectedAssistantFingerprint: "a".repeat(64), lastActive: Date.now(),
  };
  await fs.writeFile(path.join(stateDir, "sessions.json"), JSON.stringify([sessionRecord], null, 2));

  // account: read-only view over OMP marker, isolated ACP state and keychain.
  await command.handler("account", context);
  const account = JSON.parse(notices.pop());
  assert.equal(account.provider, "antigravity-acp");
  assert.equal(account.ompCredential.present, true);
  assert.equal(account.ompCredential.record, "managed marker (non-secret)");
  assert.equal(account.ompCredential.authorizedAt, new Date(1234567890123).toISOString());
  assert.equal(account.ompAuthSource, "local store (oauth marker)");
  assert.equal(account.acpAuth.status, "missing");
  assert.equal(account.acpAuth.usable, true, "Stubbed keychain presence must mark auth usable");
  assert.equal(account.macOSKeychainEntry, true);
  assert.equal(account.savedAcpSessions, 1);
  assert.equal(account.runtime.permissionMode, "yolo");
  await assert.rejects(command.handler("account extra", context), /Usage:/);

  // login: upstream OAuth flow stubbed at loginGoogle; the command must map
  // OMP dialogs onto the upstream interaction and return the pasted callback.
  const loginSeen: { pasted?: string } = {};
  AntigravityRuntime.prototype.loginGoogle = async function (_signal: any, onProgress: any, manual: any) {
    onProgress?.("Stub login progress");
    manual.showAuthorizationUrl("https://accounts.google.com/o/oauth2/v2/auth?scope=test", "Open the authorization URL");
    loginSeen.pasted = await manual.promptForCallback();
  } as any;
  await command.handler("login", context);
  assert.equal(inputs.length, 1);
  assert.equal(inputs[0].message, "Paste the final localhost callback URL (or authorization code):");
  assert.equal(inputs[0].placeholder, "http://127.0.0.1:PORT/?state=…&code=…");
  assert.equal(loginSeen.pasted, "http://127.0.0.1:45678/?state=abc&code=xyz");
  const loginNotice = notices.join("\n");
  assert.ok(loginNotice.includes("Stub login progress"));
  assert.ok(loginNotice.includes("https://accounts.google.com/o/oauth2/v2/auth?scope=test"));
  assert.ok(loginNotice.includes("Antigravity Google login finished"), notices.join(" | "));
  // prepareRuntime wrote the default auth choice into the isolated GEMINI_HOME.
  assert.equal(JSON.parse(await fs.readFile(path.join(geminiHome, "antigravity-acp", "settings.json"), "utf8")).auth.type, "oauth-personal");
  await assert.rejects(command.handler("login extra", context), /Usage:/);

  // logout with active work must refuse rather than tear down live sessions.
  SessionRuntimePool.prototype.values = function () { return [{ isBusy: () => true }]; } as any;
  await assert.rejects(command.handler("logout", context), /Wait for active Antigravity requests/);
  SessionRuntimePool.prototype.values = originalPoolValues;
  assert.ok(ompCredentials.has("antigravity-acp"), "Refused logout must keep the OMP marker");

  // logout: real upstream runtime.logout() against isolated directories.
  await fs.writeFile(path.join(geminiHome, "antigravity-acp", "acp_token.json"), JSON.stringify({ refresh_token: "secret-ref" }));
  await command.handler("logout", context);
  const logoutNotice = notices.pop();
  assert.match(logoutNotice, /Antigravity ACP logout/);
  assert.match(logoutNotice, /ACP auth after logout: missing/);
  assert.match(logoutNotice, /macOS keychain entry: removed/);
  assert.match(logoutNotice, /OMP marker record: removed/);
  assert.equal(refreshCalls, 1, "Logout must refresh the provider after removing the marker");
  assert.ok(keychainCalls.includes("remove"));
  await assert.rejects(fs.access(path.join(stateDir, "sessions.json")));
  await assert.rejects(fs.access(path.join(geminiHome, "antigravity-acp", "acp_token.json")));
  assert.equal(JSON.parse(await fs.readFile(path.join(geminiHome, "antigravity-acp", "settings.json"), "utf8")).auth, undefined);
  assert.equal(ompCredentials.size, 0);
  // The next request must build a fresh runtime pool entry, not the closed one.
  await command.handler("account", context);
  const afterLogout = JSON.parse(notices.pop());
  assert.equal(afterLogout.acpAuth.status, "missing");
  assert.equal(afterLogout.savedAcpSessions, 0);
  await assert.rejects(command.handler("logout extra", context), /Usage:/);

  // logout without a model registry reports the manual /logout fallback.
  await command.handler("logout", baseContext);
  const fallbackNotice = notices.pop();
  assert.match(fallbackNotice, /OMP marker record: could not be removed; run \/logout/);
  assert.match(fallbackNotice, /macOS keychain entry: removed/);
  console.log("Account view, login dialog mapping, logout isolation and busy guard: PASS");
} finally {
  keychain.present = originalPresent;
  keychain.remove = originalRemove;
  AntigravityRuntime.prototype.loginGoogle = originalLoginGoogle;
  SessionRuntimePool.prototype.values = originalPoolValues;
  await hooks.get("session_shutdown")?.({}, {});
  await fs.rm(stateDir, { recursive: true, force: true });
  await fs.rm(geminiHome, { recursive: true, force: true });
}
