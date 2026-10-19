# omp-antigravity-acp

Google Antigravity's official ACP server, adapted for **Oh My Pi (OMP)**.

**An OMP-focused derivative fork of [zacbemis/pi-antigravity-acp-provider](https://github.com/zacbemis/pi-antigravity-acp-provider).** Original project by [zacbemis](https://github.com/zacbemis) and contributors, licensed under MIT.

This is an independent adaptation, not an official Google or OMP integration. It uses ACP over stdio. The local HTTP MCP bridge carries tool calls; it is not a model API reverse proxy.

## Upstream and fork scope

The original project's ACP transport, Google-managed authentication, runtime installation, session restoration and MCP tool bridge form the foundation of this project. Credit for those capabilities belongs to the upstream authors.

This derivative adds OMP-specific provider registration, confirmed model/thinking selectors, lazy catalog loading, OMP-first tool instructions, API-equivalent pricing and per-session runtime lifecycle fixes for planning/refinement.

The repository keeps the OMP adapter sources separately and installs upstream version **0.1.15** as an unmodified, pinned npm dependency. It does not contain a copy of upstream's Git history. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the original copyright and license notice.

## Status

Version 0.1.1 packages a working local adapter tested with macOS, OMP 18.12.2, upstream provider 0.1.15 and official ACP runtime 1.4.1. Other platforms and OMP versions are not yet verified.

Google's consumer-plan policies can restrict third-party agent access even through the official CLI or ACP executable. An official transport does not establish permission to use a subscription in OMP. Check the current [Antigravity FAQ](https://www.antigravity.google/docs/faq/) and [terms](https://antigravity.google/terms) for your account.

## Features

- `antigravity-acp/gemini-4-argon` and `antigravity-acp/gemini-3.8-flash`.
- Server-confirmed Low, Medium and High thinking selection.
- Compatible OMP tools exposed through an authenticated loopback MCP bridge.
- Provider-specific instructions prefer OMP tools and require approval before substituting native Antigravity tools. These instructions are not a hard tool-disable mechanism.
- Lazy ACP startup; model selection and cached listing do not launch the server.
- Runtimes scoped to OMP sessions, including recovery after a planning session is disposed.
- OAuth credentials owned by Antigravity; OMP stores only a non-secret marker.
- API-equivalent cost estimates, not subscription billing or quota measurements.

## Install from npm

Use Node.js 22.19 or newer and OMP:

```sh
omp plugin install npm:omp-antigravity-acp
```

Restart OMP after installation. The npm package includes the built adapter; users do not need esbuild or a manual build step. Disable any older ACP adapter for the same provider before loading this package.

The upstream dependency declares Pi-specific peers, so package managers that automatically install peers may also fetch the Pi CLI. The OMP adapter does not invoke that CLI. This does not apply to source installs using this repository's `.npmrc`.

## Build from source

Use Node.js 22.19 or newer and OMP. Node.js is also required by the upstream process supervisor.

```sh
npm ci
npm run check
```

The checked-in npm configuration disables automatic peer installation because the upstream package declares Pi-specific peers. This adapter explicitly supplies its runtime dependency on `pi-ai`; it does not need the Pi coding-agent CLI.

The build produces `extension/runtime.mjs` and `THIRD_PARTY_LICENSES.txt`. They are ignored by Git, rebuilt locally and included in published npm tarballs. Supervisor and runtime catalog paths resolve against the installed upstream dependency, so the bundle does not embed the developer's home directory.

For a temporary session, from this repository:

```sh
omp --no-extensions -e ./extension/index.ts
```

This disables other extension discovery for that invocation, avoiding duplicate registration of an existing ACP adapter. For normal installation, use OMP's extension configuration or point `~/.omp/agent/extensions/omp-antigravity-acp` at the built `extension` directory. Disable any previous `antigravity-acp-omp` or upstream Pi extension first; do not load two adapters for the same provider.

This repository does not change an existing OMP installation or overwrite its settings.

## Sign in and choose a model

1. Run `/login` and select **Google Antigravity (ACP)**.
2. Complete Google's authorization flow. On headless machines the upstream provider can relay a browser callback.
3. Run `/antigravity-acp refresh` to discover the models actually advertised for the account.
4. Select a model with `/model` and use OMP's thinking control to select a supported effort.

First use or login may download the official runtime. The observed macOS runtime occupies about **383 MiB**; size varies by platform/version. It lives outside this repository under `~/.local/opt/agy-acp/`. Do not remove it while ACP processes are running.

If OMP's `enabledModels` whitelist is configured, add the two provider/model IDs above. The adapter does not rewrite that whitelist or any model-role preset.

## Commands

| Command | Purpose |
| --- | --- |
| `/antigravity-acp status` | Runtime, confirmed thinking and usage information |
| `/antigravity-acp tools` | Available and omitted OMP tool schemas after a request |
| `/antigravity-acp refresh` | Explicit network discovery and local catalog refresh |
| `/antigravity-acp permissions default` | Prompting permission mode |
| `/antigravity-acp permissions auto-edit` | Auto-edit mode |
| `/antigravity-acp permissions yolo` | Upstream permissive mode |

The initial permission mode follows upstream configuration, whose default is `yolo`. Native Antigravity tools have separate execution permissions from OMP tools.

## Data locations

| Data | Location |
| --- | --- |
| Adapter configuration, catalog and session mappings | `~/.omp/agent/antigravity-acp-provider/` |
| Official credentials/settings/history | Managed by Antigravity under its own storage/keychain |
| Downloaded official runtime | `~/.local/opt/agy-acp/` |
| Generated adapter bundle | `extension/runtime.mjs` |

Never include those user data directories, OAuth callback URLs, account identifiers or downloaded runtime binaries in issues or commits. `OMP_ACP_TRACE=1` enables opt-in tool/selector diagnostics; review diagnostic output before sharing.

## Limitations

- The adapter advertises a conservative 1,000,000-token context and 65,536-token output metadata. These are not controls over Antigravity's internal context compaction.
- API background execution and long decode controls are not exposed.
- The bridge advertises text and image input, not the full Gemini API media surface.
- Thought summaries appear only if the ACP server emits them. A verified Argon High request returned no `agent_thought_chunk`; tool/plan progress can appear in OMP's thinking area.
- Cached-token usage appears only when ACP reports it. Missing counts are not proof that backend caching was disabled.
- The prompt inactivity watchdog is 10 minutes without progress, or 60 minutes while tools/permissions are outstanding.
- Argon estimates use the undiscounted list price: $4 input, $20 output and $0.20 cached input per million tokens. Flash estimates use the announced date-dependent rates. These are snapshots, not live pricing discovery.
- Not every OMP tool schema is bridge-compatible. Inspect `tools` after a request.
- Antigravity still manages its own native tools and checkpoint summaries.

## Development and verification

`npm test` runs offline regression tests for session ownership, restart-after-shutdown, asynchronous teardown and price calculations. It performs no model inference and consumes no account quota.

`npm run test:packed` additionally requires OMP on PATH. It installs the exact npm tarball into a temporary consumer directory with development dependencies omitted and install scripts disabled, checks runtime assets, and loads its model catalog with ACP execution disabled. It downloads production dependencies and removes the temporary installation afterward.

Before publishing, verify local OMP loading without allowing ACP to start:

```sh
AGY_ACP_BIN=/usr/bin/false omp models antigravity-acp --no-extensions -e ./extension/index.ts --json
```

With no local model cache, upstream's conservative fallback may list fewer models. Listing a model is not proof of account entitlement or successful inference.

The original local implementation also passed live Argon/Flash inference, effort-selector and OMP tool round-trip checks. The planning lifecycle fix passed a live Argon Medium request, session shutdown and a subsequent request with conversation history. Those tests do not cover every platform or the complete interactive Refine plan UI.

## License and attribution

MIT. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Upstream source is installed as a pinned npm dependency rather than vendored or modified. Official Google executables and their licenses are separate.
