import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ensureAdapter } from "./provision.ts";

export default async function (omp: any) {
  const root = path.dirname(fileURLToPath(import.meta.url));
  const entry = await ensureAdapter(path.join(root, ".runtime"));
  const adapter = await import(pathToFileURL(entry).href);
  await adapter.default(omp);
}
