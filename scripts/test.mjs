import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = await mkdtemp(path.join(tmpdir(), "omp-antigravity-acp-provider-tests-"));
try {
  const entries = (await readdir(path.join(root, "test")))
    .filter(file => file.endsWith(".test.ts"))
    .map(file => path.join(root, "test", file));
  await build({
    entryPoints: entries,
    outdir: output,
    outExtension: { ".js": ".mjs" },
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    logLevel: "warning",
  });
  const compiled = (await readdir(output)).filter(file => file.endsWith(".mjs"));
  const result = spawnSync(process.execPath, ["--test", ...compiled.map(file => path.join(output, file))], {
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  await rm(output, { recursive: true, force: true });
}
