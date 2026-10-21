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
  ["inspectAntigravityAuth, hasAntigravityAuth, clearAntigravityCredentials, resolveAntigravityAcpDirectory", "acp/antigravity.ts"],
  ["describeCredentialStorage", "acp/credential-storage.ts"],
  ["FALLBACK_MODELS, projectModels", "models.ts"],
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
        const patches = [
          {
            name: "context",
            anchor: "buildPromptParts(context, fresh, unseenStart)",
            replacement: "buildPromptParts(context, fresh, unseenStart, { contextWindow: model.contextWindow, maxTokens: model.maxTokens, policy: model.ompContextPolicy })",
          },
          {
            name: "new request supersedes continuation",
            anchor: "\t\t// A permission tool result resumes the still-running ACP prompt rather than",
            replacement: [
              "\t\t// A new/edited user request is not a tool-result continuation of the",
              "\t\t// previous ACP prompt. Never let old pending results swallow it.",
              "\t\tif ((binding.turnCompletion || binding.permission || binding.pendingTools.size > 0) &&",
              "\t\t\t(context.messages.findLastIndex(message => message.role === 'user') >= binding.pendingContextCount ||",
              "\t\t\t messagesFingerprint(context.messages.slice(0, binding.pendingContextCount)) !== binding.pendingContextFingerprint)) {",
              "\t\t\tconst prefixMatches = context.messages.length >= binding.pendingContextCount &&",
              "\t\t\t\tmessagesFingerprint(context.messages.slice(0, binding.pendingContextCount)) === binding.pendingContextFingerprint;",
              "\t\t\tconst drained = prefixMatches && await drainCancelledTurn(binding, () => abortTurn(binding), options.signal);",
              "\t\t\tif (!drained || !binding.connection.process.alive || binding.needsReconstruction ||",
              "\t\t\t\t!['cancelled', 'end_turn'].includes(binding.ompTerminalStopReason)) {",
              "\t\t\t\tawait this.invalidateBinding(binding);",
              "\t\t\t}",
              "\t\t\tbinding = await this.getBinding(key, model, acpModelId, options.apiKey, writer, tools, options.signal);",
              "\t\t}",
              "",
              "\t\t// A permission tool result resumes the still-running ACP prompt rather than",
            ].join("\n"),
          },
          {
            name: "checkpoint acknowledged cancellation",
            anchor: "if (isAbort(error) || binding.abortRequested) abortTurn(binding);",
            replacement: [
              "if (isAbort(error) || binding.abortRequested) {",
              "\t\t\t\tabortTurn(binding);",
              "\t\t\t\tif (binding.connection.process.alive && !binding.needsReconstruction &&",
              "\t\t\t\t\t['cancelled', 'end_turn'].includes(binding.ompTerminalStopReason)) {",
              "\t\t\t\t\tbinding.messageCount = binding.pendingContextCount;",
              "\t\t\t\t\tbinding.historyFingerprint = binding.pendingContextFingerprint;",
              "\t\t\t\t\tbinding.expectedAssistantFingerprint = messageFingerprint((binding.writer ?? writer).message);",
              "\t\t\t\t\tbinding.ompCancelledCheckpoint = true;",
              "\t\t\t\t\tbinding.ompCancelledHadOutput = (binding.writer ?? writer).message.content.length > 0;",
              "\t\t\t\t\tthis.persistBinding(binding);",
              "\t\t\t\t} else await this.invalidateBinding(binding);",
              "\t\t\t}",
            ].join("\n"),
          },
          {
            name: "reset cancellation acknowledgement per prompt",
            anchor: "binding.instructionsFingerprint = instructionFingerprint(context);",
            replacement: "binding.ompTerminalStopReason = undefined;\n\t\t\t" + "binding.instructionsFingerprint = instructionFingerprint(context);",
          },
          {
            name: "record official terminal reason before abort handling",
            anchor: "if (binding.abortRequested) throw abortError();",
            replacement: "binding.ompTerminalStopReason = response.stopReason;\n\t\t\tif (binding.abortRequested) throw abortError();",
          },
          {
            name: "cancelled partial output must match retained OMP history",
            anchor: "binding.needsReconstruction || binding.mode !== this.permissionMode ||",
            replacement: [
              "binding.needsReconstruction ||",
              "\t\t\t\t(binding.ompCancelledCheckpoint && (context.messages[binding.messageCount]?.role === 'assistant'",
              "\t\t\t\t\t? messageFingerprint(context.messages[binding.messageCount]) !== binding.expectedAssistantFingerprint",
              "\t\t\t\t\t: binding.ompCancelledHadOutput)) || binding.mode !== this.permissionMode ||",
            ].join("\n"),
          },
          {
            name: "persist cancellation checkpoint flags",
            anchor: "acpModelId: binding.modelId,",
            replacement: "acpModelId: binding.modelId,\n\t\t\tompCancelledCheckpoint: binding.ompCancelledCheckpoint === true,\n\t\t\tompCancelledHadOutput: binding.ompCancelledHadOutput === true,",
          },
          {
            name: "restore cancellation checkpoint flags",
            anchor: "messageCount: restored && saved ? saved.messageCount : 0,",
            replacement: "messageCount: restored && saved ? saved.messageCount : 0,\n\t\t\t\tompCancelledCheckpoint: restored && saved?.ompCancelledCheckpoint === true,\n\t\t\t\tompCancelledHadOutput: restored && saved?.ompCancelledHadOutput === true,",
          },
          {
            name: "connection retirement",
            anchor: "if (!persistent) await this.dropBinding(key, binding);",
            replacement: "if (!persistent || !binding.connection.process.alive) await this.dropBinding(key, binding);",
          },
          {
            name: "cleanup retire",
            anchor: "const current = this.bindings.get(key);\n\t\tif (current && (await current) === binding",
            replacement: "if (removeSaved) binding.connection.retireForReplacement?.(key, binding.session.sessionId);\n\t\tconst current = this.bindings.get(key);\n\t\tif (current && (await current) === binding",
          },
          {
            name: "cleanup confirm",
            anchor: "this.persistBinding(binding);\n\t\t\tswitch (response.stopReason)",
            replacement: "if (response.stopReason !== 'cancelled') binding.ompCancelledCheckpoint = false;\n\t\t\tthis.persistBinding(binding);\n\t\t\tif (response.stopReason === 'end_turn') { binding.connection.confirmReplacement?.(key, binding.session.sessionId); if (!persistent) binding.connection.discardSession?.(binding.session.sessionId); }\n\t\t\tswitch (response.stopReason)",
          },
        ];
        let contents = await fs.readFile(file, "utf8");
        for (const patch of patches) {
          if (contents.split(patch.anchor).length !== 2) {
            throw new Error(`Pinned upstream ${patch.name} seam changed; review compatibility`);
          }
          contents = contents.replace(patch.anchor, patch.replacement);
        }
        contents = `import { drainCancelledTurn } from ${JSON.stringify(path.join(root, "extension/turn-cancellation.ts"))};\n` + contents;
        return { contents, loader: "ts" };
      });
      builder.onLoad({ filter: /\/src\/acp\/connection\.ts$/ }, async ({ path: file }) => {
        if (file !== path.join(upstream, "src/acp/connection.ts")) return;
        const source = await fs.readFile(file, "utf8");
        const anchor = "if (aborting) finish(() => reject(abortError()));";
        if (source.split(anchor).length !== 2) throw new Error("Pinned upstream prompt cancellation seam changed; review compatibility");
        return { contents: source.replace(anchor,
          "if (aborting && this.process.alive && ['cancelled', 'end_turn'].includes(value.stopReason)) finish(() => resolve(value));\n\t\t\t\t\telse if (aborting) finish(() => reject(abortError()));"), loader: "ts" };
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
