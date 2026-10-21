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
  ["inspectAntigravityAuth, hasAntigravityAuth, clearAntigravityCredentials", "acp/antigravity.ts"],
  ["describeCredentialStorage", "acp/credential-storage.ts"],
  ["projectModels", "models.ts"],
  ["AcpSessionStore", "acp/session-store.ts"],
  ["ensureAntigravityAcpReady", "acp/setup.ts"],
  ["planToolProjection", "mcp/bridge.ts"],
  ["PiEventWriter", "stream/pi-events.ts"],
];
const result = await build({
  stdin: {
    contents: [
      ...exports.map(([names, file]) => `export { ${names} } from ${JSON.stringify(path.join(upstream, "src", file))};`),
      `export { TierConnection } from ${JSON.stringify(path.join(root, "extension/tier-connection.ts"))};`,
      `export { SessionCleanup } from ${JSON.stringify(path.join(root, "extension/session-cleanup.ts"))};`,
      'export { Type } from "typebox";',
    ].join("\n"),
    resolveDir: root,
    sourcefile: "omp-adapter-entry.ts",
    loader: "ts",
  },
  bundle: true,
  metafile: true,
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
      builder.onResolve({ filter: /^\.\/stream\/context\.js$/ }, ({ importer }) => {
        if (importer === path.join(upstream, "src/runtime.ts")) return { path: path.join(root, "extension/context-transfer.ts") };
      });
      builder.onResolve({ filter: /^\.\/stream\/usage\.js$/ }, ({ importer }) => {
        if (importer === path.join(upstream, "src/runtime.ts")) return { path: path.join(root, "extension/usage.ts") };
      });
      builder.onLoad({ filter: /\/src\/runtime\.ts$/ }, async ({ path: file }) => {
        if (file !== path.join(upstream, "src/runtime.ts")) return;
        const source = await fs.readFile(file, "utf8");
        const marker = "buildPromptParts(context, fresh, unseenStart)";
        if (source.split(marker).length !== 2) throw new Error("Pinned upstream context seam changed; review compatibility");
        const retirement = "if (!persistent) await this.dropBinding(key, binding);";
        if (source.split(retirement).length !== 2) throw new Error("Pinned upstream connection retirement seam changed; review compatibility");
        const cleanupRetire = "const current = this.bindings.get(key);\n\t\tif (current && (await current) === binding";
        const cleanupConfirm = "this.persistBinding(binding);\n\t\t\tswitch (response.stopReason)";
        for (const seam of [cleanupRetire, cleanupConfirm]) if (source.split(seam).length !== 2) throw new Error("Pinned upstream cleanup seam changed; review compatibility");
        return { contents: source.replace(marker, "buildPromptParts(context, fresh, unseenStart, { contextWindow: model.contextWindow, maxTokens: model.maxTokens, policy: model.ompContextPolicy })")
          .replace(retirement, "if (!persistent || !binding.connection.process.alive) await this.dropBinding(key, binding);")
          .replace(cleanupRetire, "if (removeSaved) binding.connection.retireForReplacement?.(key, binding.session.sessionId);\n\t\t" + cleanupRetire)
          .replace(cleanupConfirm, "this.persistBinding(binding);\n\t\t\tif (response.stopReason === 'end_turn') { binding.connection.confirmReplacement?.(key, binding.session.sessionId); if (!persistent) binding.connection.discardSession?.(binding.session.sessionId); }\n\t\t\tswitch (response.stopReason)"), loader: "ts" };
      });
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

// The npm tarball ships a bundle. Include the full notices of packages whose
// code is bundled, in addition to their individually installed npm licenses.
const packages = new Map();
for (const input of Object.keys(result.metafile.inputs)) {
  if (!input.includes("node_modules")) continue;
  let directory = path.dirname(path.resolve(root, input));
  while (directory !== path.dirname(directory)) {
    try {
      const metadata = JSON.parse(await fs.readFile(path.join(directory, "package.json"), "utf8"));
      if (metadata.name && metadata.version) {
        packages.set(directory, metadata);
        break;
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    directory = path.dirname(directory);
  }
}
const notices = [];
for (const [directory, metadata] of [...packages].sort((a, b) => a[1].name.localeCompare(b[1].name))) {
  const names = (await fs.readdir(directory)).filter(name => /^(?:licen[cs]e|copying|notice)(?:[.-].*)?$/i.test(name));
  const texts = [];
  for (const name of names) {
    if ((await fs.stat(path.join(directory, name))).isFile()) {
      texts.push(`${name}\n${await fs.readFile(path.join(directory, name), "utf8")}`);
    }
  }
  if (!texts.length && metadata.name === "@earendil-works/pi-ai" && metadata.version === "1.3.0") {
    texts.push(await fs.readFile(path.join(root, "licenses/pi-ai-1.3.0.txt"), "utf8"));
  }
  if (!texts.length) {
    for (const name of (await fs.readdir(directory)).filter(name => /^readme(?:\..*)?$/i.test(name))) {
      const readme = await fs.readFile(path.join(directory, name), "utf8");
      const license = readme.match(/^#{1,6}\s+License\s*\r?\n([\s\S]*)/im)?.[1];
      if (license?.includes("Copyright") && license.includes("Permission is hereby granted")) {
        texts.push(`${name} license section\n${license}`);
      }
    }
  }
  if (!texts.length) throw new Error(`Missing bundled license notice for ${metadata.name}`);
  notices.push(`${metadata.name}@${metadata.version}\nLicense: ${metadata.license ?? "see notice"}\n\n${texts.join("\n\n")}`);
}
await fs.writeFile(path.join(root, "THIRD_PARTY_LICENSES.txt"), notices.join("\n\n============================================================\n\n") + "\n");
