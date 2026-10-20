import fs from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { parseNativeToolMode, type NativeToolMode } from "./tool-routing.ts";

export function loadNativeToolMode(file: string): NativeToolMode {
  try { return parseNativeToolMode(JSON.parse(fs.readFileSync(file, "utf8")).nativeTools); }
  catch (error: any) {
    if (error.code === "ENOENT") return "prefer";
    throw new Error(`Invalid OMP ACP tool policy: ${error.message}`);
  }
}

export function saveNativeToolMode(file: string, mode: NativeToolMode) {
  parseNativeToolMode(mode);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify({ nativeTools: mode }, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, file);
  } finally { fs.rmSync(temporary, { force: true }); }
}
