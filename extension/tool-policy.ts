import fs from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { parseNativeToolMode, type NativeToolMode } from "./tool-routing.ts";

export function loadNativeToolMode(file: string): NativeToolMode {
  return loadToolPolicy(file).nativeTools;
}

export interface ToolPolicy { nativeTools: NativeToolMode; debugToolUpdates: boolean }

export function loadToolPolicy(file: string): ToolPolicy {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!data || Array.isArray(data) || typeof data !== "object") throw new Error("expected a policy object");
    if (data.debugToolUpdates !== undefined && typeof data.debugToolUpdates !== "boolean") {
      throw new Error("debugToolUpdates must be boolean");
    }
    return { nativeTools: parseNativeToolMode(data.nativeTools === undefined ? "prefer" : data.nativeTools), debugToolUpdates: data.debugToolUpdates ?? false };
  }
  catch (error: any) {
    if (error.code === "ENOENT") return { nativeTools: "prefer", debugToolUpdates: false };
    throw new Error(`Invalid OMP ACP tool policy: ${error.message}`);
  }
}

export function saveNativeToolMode(file: string, mode: NativeToolMode) {
  parseNativeToolMode(mode);
  saveToolPolicy(file, { ...loadToolPolicy(file), nativeTools: mode });
}

export function saveDebugToolUpdates(file: string, enabled: boolean) {
  if (typeof enabled !== "boolean") throw new Error("debugToolUpdates must be boolean");
  saveToolPolicy(file, { ...loadToolPolicy(file), debugToolUpdates: enabled });
}

function saveToolPolicy(file: string, policy: ToolPolicy) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(policy, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, file);
  } finally { fs.rmSync(temporary, { force: true }); }
}
