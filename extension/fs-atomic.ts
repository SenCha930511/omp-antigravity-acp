import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

export function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function writeJsonAtomic(file: string, value: unknown, pretty = true): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const serialized = pretty ? `${JSON.stringify(value, null, 2)}\n` : `${JSON.stringify(value)}\n`;
    fs.writeFileSync(temporary, serialized, { mode: 0o600 });
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}
