import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const upstream = path.dirname(require.resolve("pi-antigravity-acp-provider/package.json"));
const exports = [
  ["createAntigravityProvider", "provider.ts"],
  ["AntigravityRuntime, PERMISSION_TOOL_NAME, PERMISSION_RESULT_KIND", "runtime.ts"],
  ["loadConfig, savePermissionMode", "config.ts"],
  ["inspectAntigravityAuth, hasAntigravityAuth", "acp/antigravity.ts"],
  ["projectModels", "models.ts"],
  ["AcpSessionStore", "acp/session-store.ts"],
  ["ensureAntigravityAcpReady", "acp/setup.ts"],
  ["planToolProjection", "mcp/bridge.ts"],
  ["PiEventWriter", "stream/pi-events.ts"],
];
await build({
  stdin: {
    contents: [
      ...exports.map(([names, file]) => `export { ${names} } from ${JSON.stringify(path.join(upstream, "src", file))};`),
      `export { TierConnection } from ${JSON.stringify(path.join(root, "extension/tier-connection.ts"))};`,
      'export { Type } from "typebox";',
    ].join("\n"),
    resolveDir: root,
    sourcefile: "omp-adapter-entry.ts",
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  // Bundled CJS dependencies need require in ESM. Asset locations are resolved
  // on the consuming machine rather than embedded from the build machine.
  banner: { js: [
    'import { createRequire as __ompCreateRequire } from "node:module";',
    'import { pathToFileURL as __ompPathToFileURL } from "node:url";',
    'const require = __ompCreateRequire(import.meta.url);',
    'const __ompAssetURL = (specifier) => __ompPathToFileURL(require.resolve(specifier)).href;',
  ].join("\n") },
  external: ["@aws-sdk/client-s3"],
  plugins: [{
    name: "portable-upstream-assets",
    setup(builder) {
      builder.onLoad({ filter: /\/(?:process|runtime-manifest)\.ts$/ }, async ({ path: file }) => {
        const relative = path.relative(upstream, file).split(path.sep).join("/");
        return {
          contents: (await fs.readFile(file, "utf8")).replaceAll(
            "import.meta.url",
            `__ompAssetURL(${JSON.stringify("pi-antigravity-acp-provider/" + relative)})`,
          ),
          loader: "ts",
        };
      });
    },
  }],
  outfile: path.join(root, "extension/runtime.mjs"),
  logLevel: "info",
});
