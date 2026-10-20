import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { lockSync } from "proper-lockfile";
import { resolveAntigravityAcpDirectory } from "pi-antigravity-acp-provider/src/acp/antigravity.ts";

export type CleanupMode = "off" | "conservative" | "timeout";
export interface CleanupPolicy { mode: CleanupMode; idleDays: number }
const DEFAULT: CleanupPolicy = { mode: "conservative", idleDays: 7 };
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
interface Lease { token: string; pid: number; serverPid: number }
interface Record { id: string; owned: boolean; lastUsed: number; leases: Lease[]; retiredFor?: string; replaced?: boolean }
interface Registry { version: 1; sessions: Record[] }

function validate(policy: any): CleanupPolicy {
  if (!policy || !["off", "conservative", "timeout"].includes(policy.mode) ||
      !Number.isFinite(policy.idleDays) || policy.idleDays < 1 / 24 || policy.idleDays > 3650) {
    throw new Error("Cleanup requires mode off|conservative|timeout and idleDays between 1/24 (one hour) and 3650");
  }
  return { mode: policy.mode, idleDays: policy.idleDays };
}
export function loadCleanupPolicy(file: string): CleanupPolicy {
  try { return validate(JSON.parse(fs.readFileSync(file, "utf8"))); }
  catch (error: any) { if (error.code === "ENOENT") return { ...DEFAULT }; throw error; }
}
export function saveCleanupPolicy(file: string, policy: CleanupPolicy) {
  atomicJson(file, validate(policy));
}
function atomicJson(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try { fs.writeFileSync(temporary, JSON.stringify(value) + "\n", { mode: 0o600 }); fs.renameSync(temporary, file); }
  finally { fs.rmSync(temporary, { force: true }); }
}
function live(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error: any) { return error.code !== "ESRCH"; }
}
function group(key: string) { return createHash("sha256").update(key).digest("hex"); }

// Only UUIDs registered by this adapter can become deletion candidates. No
// directory-wide adoption of old/unidentified Google sessions is performed.
export class SessionCleanup {
  readonly policyPath: string;
  private readonly registryPath: string;
  private timer?: ReturnType<typeof setInterval>;
  constructor(stateDir: string, readonly acpDir = resolveAntigravityAcpDirectory(),
    private readonly now = Date.now, private readonly isLive = live) {
    this.policyPath = path.join(stateDir, "cleanup.json");
    // Separate registries when the same OMP profile uses different GEMINI_HOME.
    const root = createHash("sha256").update(path.resolve(acpDir)).digest("hex").slice(0, 16);
    this.registryPath = path.join(stateDir, `cleanup-sessions-${root}.json`);
  }
  configure(mode: CleanupMode, idleDays = loadCleanupPolicy(this.policyPath).idleDays) {
    saveCleanupPolicy(this.policyPath, { mode, idleDays });
  }
  status() { return { ...loadCleanupPolicy(this.policyPath), file: this.policyPath, scope: "adapter-owned local ACP data" }; }
  start() {
    if (this.timer) return;
    this.collect();
    this.timer = setInterval(() => this.collect(), 15 * 60_000);
    this.timer.unref();
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = undefined; }

  private transaction<T>(action: (registry: Registry) => T): T {
    fs.mkdirSync(path.dirname(this.registryPath), { recursive: true, mode: 0o700 });
    // No retries/blocking sleeps in the inference path. Busy/malformed stores
    // fail closed; callers defer cleanup instead of risking another process.
    const release = lockSync(this.registryPath, { realpath: false, stale: 600_000 });
    try {
      let registry: Registry = { version: 1, sessions: [] };
      try { registry = JSON.parse(fs.readFileSync(this.registryPath, "utf8")); }
      catch (error: any) { if (error.code !== "ENOENT") throw error; }
      if (registry.version !== 1 || !Array.isArray(registry.sessions) || !registry.sessions.every(r =>
        UUID.test(r.id) && typeof r.owned === "boolean" && Number.isFinite(r.lastUsed) && Array.isArray(r.leases) &&
        (r.replaced === undefined || typeof r.replaced === "boolean") &&
        (r.retiredFor === undefined || /^[a-f0-9]{64}$/.test(r.retiredFor)) &&
        r.leases.every(l => typeof l.token === "string" && Number.isSafeInteger(l.pid) && l.pid > 0 && Number.isSafeInteger(l.serverPid) && l.serverPid > 0))) {
        throw new Error("Invalid ACP cleanup registry; refusing deletion");
      }
      const result = action(registry);
      atomicJson(this.registryPath, registry);
      return result;
    } finally { release(); }
  }
  acquire(id: string, owned: boolean, serverPid: number): string {
    if (!UUID.test(id) || !Number.isSafeInteger(serverPid) || serverPid <= 0) throw new Error("Invalid ACP cleanup lease");
    return this.transaction(registry => {
      let record = registry.sessions.find(r => r.id === id);
      if (!record) { record = { id, owned, lastUsed: this.now(), leases: [] }; registry.sessions.push(record); }
      // Resuming an old/foreign session never upgrades its ownership.
      const token = randomUUID();
      record.leases.push({ token, pid: process.pid, serverPid });
      record.lastUsed = this.now();
      return token;
    });
  }
  release(token: string) {
    this.transaction(registry => { for (const r of registry.sessions) r.leases = r.leases.filter(l => l.token !== token); });
    this.collect();
  }
  touch(id: string) { this.transaction(registry => { const r = registry.sessions.find(r => r.id === id); if (r) r.lastUsed = this.now(); }); }
  retire(key: string, id: string) {
    this.transaction(registry => {
      const r = registry.sessions.find(r => r.id === id);
      if (r?.owned) { r.retiredFor = group(key); r.replaced = false; }
    });
  }
  confirm(key: string, replacement: string) {
    this.transaction(registry => {
      for (const r of registry.sessions) if (r.id !== replacement && r.retiredFor === group(key)) r.replaced = true;
    });
    this.collect();
  }
  collect(): number {
    try {
      const policy = loadCleanupPolicy(this.policyPath);
      if (policy.mode === "off") return 0;
      return this.transaction(registry => {
        let removed = 0;
        registry.sessions = registry.sessions.filter(r => {
          r.leases = r.leases.filter(l => this.isLive(l.pid) || this.isLive(l.serverPid));
          if (!r.owned && r.leases.length === 0) return false;
          const eligible = r.owned && r.leases.length === 0 && (r.replaced === true ||
            (policy.mode === "timeout" && this.now() - r.lastUsed >= policy.idleDays * 86_400_000));
          if (!eligible) return true;
          try { this.removeFiles(r.id); removed++; return false; }
          catch { return true; } // Keep ownership for a later retry; never fail a model answer.
        });
        return removed;
      });
    } catch { return 0; }
  }
  private removeFiles(id: string) {
    const root = path.resolve(this.acpDir);
    if (fs.realpathSync(root) !== root) throw new Error("Symlinked ACP root; refusing cleanup");
    const conversations = path.join(root, "conversations");
    const brain = path.join(root, "brain");
    const targets = [path.join(conversations, `${id}.db`), path.join(conversations, `${id}.db-wal`),
      path.join(conversations, `${id}.db-shm`), path.join(conversations, `${id}.db-journal`),
      path.join(conversations, `${id}.meta`), path.join(brain, id)];
    const inspect = (file: string) => {
      let stat: fs.Stats;
      try { stat = fs.lstatSync(file); } catch (error: any) { if (error.code === "ENOENT") return; throw error; }
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw new Error("Unsafe cleanup target");
      if (stat.isDirectory()) for (const child of fs.readdirSync(file)) inspect(path.join(file, child));
    };
    for (const parent of [conversations, brain]) {
      try { if (fs.realpathSync(parent) !== parent) throw new Error("Symlinked cleanup directory"); }
      catch (error: any) { if (error.code !== "ENOENT") throw error; }
    }
    for (const target of targets) inspect(target);
    for (const target of targets) fs.rmSync(target, { recursive: true, force: true });
  }
}
