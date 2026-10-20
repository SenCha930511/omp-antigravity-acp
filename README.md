# omp-antigravity-acp-provider

[![npm version](https://img.shields.io/npm/v/omp-antigravity-acp-provider.svg)](https://www.npmjs.com/package/omp-antigravity-acp-provider)
[![npm downloads](https://img.shields.io/npm/dm/omp-antigravity-acp-provider.svg)](https://www.npmjs.com/package/omp-antigravity-acp-provider)

Google Antigravity's official ACP server, adapted for **Oh My Pi (OMP)**.

**An OMP-focused derivative fork of [zacbemis/pi-antigravity-acp-provider](https://github.com/zacbemis/pi-antigravity-acp-provider).** Original project by [zacbemis](https://github.com/zacbemis) and contributors, licensed under MIT.

This is an independent adaptation, not an official Google or OMP integration. It uses ACP over stdio. The local HTTP MCP bridge carries tool calls; it is not a model API reverse proxy.

## Upstream and fork scope

The original project's ACP transport, Google-managed authentication, runtime installation, session restoration and MCP tool bridge form the foundation of this project. Credit for those capabilities belongs to the upstream authors.

This derivative adds OMP-specific provider registration, confirmed model/thinking selectors, lazy catalog loading, OMP-first tool instructions, API-equivalent pricing and per-session runtime lifecycle fixes for planning/refinement.

The repository keeps the OMP adapter sources separately and installs upstream version **0.1.15** as an unmodified, pinned npm dependency. It does not contain a copy of upstream's Git history. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the original copyright and license notice.

## Status

Version 0.1.8 supports all models advertised by the official ACP server. Tested with macOS, OMP 18.12.3, upstream provider 0.1.15 and official ACP runtime 1.4.1. Other platforms and OMP versions are not yet verified.

Google's consumer-plan policies can restrict third-party agent access even through the official CLI or ACP executable. An official transport does not establish permission to use a subscription in OMP. Check the current [Antigravity FAQ](https://www.antigravity.google/docs/faq/) and [terms](https://antigravity.google/terms) for your account.

## Features

- All server-advertised model IDs, without a Gemini-only whitelist. Claude, GPT-OSS or future models become available when the ACP endpoint advertises them for your account.
- Per-model, server-confirmed thinking selection. OMP efforts `off`, `minimal`, `low`, `medium`, `high`, `xhigh` and `max` are exposed only when advertised; models without these choices use the server default.
- Compatible OMP tools exposed through an authenticated loopback MCP bridge.
- Provider-specific instructions prefer OMP tools and require approval before substituting native Antigravity tools. Supported runtimes receive these instructions through the official system-append extension and eagerly register the pi-bridge tools.
- Optional native built-in tool filtering; default `prefer` mode keeps native tools available, while `disabled` mode removes native built-ins for this adapter's ACP sessions.
- Duplicate gray ACP tool-status lines are hidden by default, with an optional debug display switch. OMP tool calls/results and actual thought summaries remain visible.
- Lazy ACP startup; model selection and cached listing do not launch the server.
- Runtimes scoped to OMP sessions, including recovery after a planning session is disposed.
- OAuth credentials owned by Antigravity; OMP stores only a non-secret marker.
- API-equivalent cost estimates, not subscription billing or quota measurements.

## Install from the OMP marketplace

No server is needed: this GitHub repository is also an OMP marketplace named **sencha-plugins**.

Add the source once, then install the plugin:

```sh
omp plugin marketplace add SenCha930511/omp-antigravity-acp-provider
omp plugin install omp-antigravity-acp-provider@sencha-plugins
```

Or, inside OMP:

```text
/marketplace add SenCha930511/omp-antigravity-acp-provider
/marketplace
```

Select **omp-antigravity-acp-provider** in the browser, install it, and restart OMP to load the provider.

OMP's marketplace installer currently copies Git content without installing npm dependencies. This marketplace therefore ships a small source launcher that retrieves the exact published **0.1.8** prebuilt npm adapter and production dependencies on first load. It disables npm install scripts, skips Pi CLI peer installation, and performs no local compilation. Node.js 22.19+ and npm must be on PATH. First preparation needs internet access and roughly **150 MiB** of disk space; later loads reuse the installed cache without npm network access.

The launcher stores its versioned dependencies in `.runtime/` inside the installed marketplace plugin's cache directory. Uninstalling the marketplace plugin removes that cache when it is no longer referenced by another scope. Google credentials and the separately downloaded official ACP runtime are unaffected.

Use either marketplace installation or direct npm installation for this provider. Disable/remove an existing installation before switching to avoid duplicate provider registration. Adding this source makes it available to users who add **sencha-plugins**; it does not submit the package to a central curated store.

To refresh the catalog and upgrade an existing marketplace installation:

```sh
omp plugin marketplace update sencha-plugins
omp plugin upgrade omp-antigravity-acp-provider@sencha-plugins
```

## Install directly from npm

The prebuilt package is published on [npm as `omp-antigravity-acp-provider`](https://www.npmjs.com/package/omp-antigravity-acp-provider). Use Node.js 22.19 or newer and OMP to install the latest release:

```sh
omp plugin install npm:omp-antigravity-acp-provider
```

To pin a specific release:

```sh
omp plugin install npm:omp-antigravity-acp-provider@0.1.8
```

Restart OMP after installation. The npm package includes the built adapter; users do not need esbuild or a manual build step. Disable any older ACP adapter for the same provider before loading this package.

The upstream dependency declares Pi-specific peers, so package managers that automatically install peers may also fetch the Pi CLI. The OMP adapter does not invoke that CLI. This does not apply to source installs using this repository's `.npmrc`.

## Find it with zmarketplace

[zmarketplace](https://github.com/zico20047/zmarketplace) searches npm using ecosystem keywords; it has no separate submission catalog. This package includes the `pi-package` keyword used for both Pi and OMP discovery, plus `extension` and `plugin` resource tags. These discovery tags do not establish compatibility with untested agent runtimes; this adapter targets OMP.

With zmarketplace already installed in OMP:

```text
/zmarketplace search omp-antigravity-acp-provider --eco=omp --type=extension
```

Or search from a terminal with Bun:

```sh
bunx zmarketplace search omp-antigravity-acp-provider --eco=omp --type=extension
```

Use the OMP installation target when installing from the search result. The direct OMP command is `omp plugin install npm:omp-antigravity-acp-provider`. Newly published metadata may take time to appear in npm search results.

## Build from source

Use Node.js 22.19 or newer and OMP. Node.js is also required by the upstream process supervisor.

```sh
git clone https://github.com/SenCha930511/omp-antigravity-acp-provider.git
cd omp-antigravity-acp-provider
npm ci
npm run check
```

The checked-in npm configuration disables automatic peer installation because the upstream package declares Pi-specific peers. This adapter explicitly supplies its runtime dependency on `pi-ai`; it does not need the Pi coding-agent CLI.

The build produces `extension/runtime.mjs` and `THIRD_PARTY_LICENSES.txt`. They are ignored by Git, rebuilt locally and included in published npm tarballs. Supervisor and runtime catalog paths resolve against the installed upstream dependency, so the bundle does not embed the developer's home directory.

For a temporary session, from this repository:

```sh
omp --no-extensions -e ./extension/index.ts
```

This disables other extension discovery for that invocation, avoiding duplicate registration of an existing ACP adapter. For normal installation, use OMP's extension configuration or point `~/.omp/agent/extensions/omp-antigravity-acp-provider` at the built `extension` directory. Disable any previous `antigravity-acp-omp` or upstream Pi extension first; do not load two adapters for the same provider.

This repository does not change an existing OMP installation or overwrite its settings.

## Sign in and choose a model

1. Run `/login` and select **Google Antigravity (ACP)**.
2. Complete Google's authorization flow. On headless machines the upstream provider can relay a browser callback.
3. Run `/antigravity-acp refresh` to discover the models actually advertised for the account.
4. Select a model with `/model` and use OMP's thinking control to select a supported effort.

First use or login may download the official runtime. The observed macOS runtime occupies about **383 MiB**; size varies by platform/version. It lives outside this repository under `~/.local/opt/agy-acp/`. Do not remove it while ACP processes are running.

If OMP's `enabledModels` whitelist is configured, add `antigravity-acp/*` alongside your existing entries in `~/.omp/agent/config.yml` to allow newly discovered models. Use individual `antigravity-acp/<server-model-id>` entries instead if you prefer a restricted list. The adapter does not rewrite that whitelist or any model-role preset.

After upgrading from an older adapter, run `/antigravity-acp refresh` once to replace the old cached list with per-model selector choices. Startup and ordinary catalog listing remain offline, so new server models appear after an explicit refresh. Availability in the Antigravity app or CLI does not guarantee availability through ACP: on the tested account, ACP still advertised only `gemini-4-argon` and `gemini-3.8-flash` on 2026-10-20.

## Commands

| Command | Purpose |
| --- | --- |
| `/antigravity-acp status` | Runtime, confirmed thinking and usage information |
| `/antigravity-acp usage` | Current ACP context occupancy, accounting source and cache-data availability |
| `/antigravity-acp usage auto` | Enable supplemental usage queries |
| `/antigravity-acp usage off` | Skip supplemental queries; preserve context occupancy updates |
| `/antigravity-acp context` | Show saved settings and effective per-model budgets |
| `/antigravity-acp context set default KEY NUMBER` | Set a default token or payload setting |
| `/antigravity-acp context set MODEL KEY NUMBER` | Override one advertised model ID |
| `/antigravity-acp tools` | Available and omitted OMP tool schemas after a request |
| `/antigravity-acp refresh` | Explicit network discovery and local catalog refresh |
| `/antigravity-acp native-tools prefer` | Prefer OMP tools; retain native built-ins (default) |
| `/antigravity-acp native-tools disabled` | Disable native built-ins for this adapter's ACP sessions |
| `/antigravity-acp debug on` | Show ACP tool-status lines for debugging |
| `/antigravity-acp debug off` | Hide ACP tool-status lines (default) |
| `/antigravity-acp permissions default` | Prompting permission mode |
| `/antigravity-acp permissions auto-edit` | Auto-edit mode |
| `/antigravity-acp permissions yolo` | Upstream permissive mode |

The initial permission mode follows upstream configuration, whose default is `yolo`. Native Antigravity tools have separate execution permissions from OMP tools.

The debug switch controls gray `[Antigravity tool: …]` and `[Antigravity tool update: …]` lines. It defaults to off and applies immediately to this process's active ACP connections. Normal OMP tool displays/results, real thought chunks and plan messages are preserved. The option is saved as `debugToolUpdates` in `omp-tools.json` alongside `nativeTools`; toggling either option preserves the other. Existing policy files without the debug field default to off. Other OMP processes need a restart to read a setting changed elsewhere. `OMP_ACP_TRACE=1` is a separate, opt-in terminal diagnostic setting.

## OMP tool routing and native-tool mode

By default, `prefer` mode sends the OMP-first instruction through `_meta.antigravity.systemPrompt.append` and preloads the `pi-bridge` tools with `eagerMcpServers`. These are official runtime extension fields on session new/load/resume, not model API requests. The adapter preserves conversation-level instructions as well. Prompt preference can still be ignored by a model; it does not enforce a tool allowlist.

Eager loading supplies tool schemas up front, which can increase initial prompt size compared with lazy discovery.

For strict native built-in filtering, run `/antigravity-acp native-tools disabled`. This sets `enabledTools: []` in the session extension while retaining the OMP MCP bridge. Run `/antigravity-acp native-tools prefer` to restore native tool availability. The command closes this process's ACP runtimes; the next request recreates/restores them with the selected policy. Switching back explicitly clears the saved server filter, including on restored sessions.

The setting is stored separately in `~/.omp/agent/antigravity-acp-provider/omp-tools.json` as `{"nativeTools":"prefer"}` or `{"nativeTools":"disabled"}`. It applies to this adapter and does not configure other providers. Other already-running OMP processes need to restart to pick up a change. Native filtering does not remove separately configured global MCP servers and is not a filesystem sandbox. Unsupported or omitted OMP tool schemas remain unavailable; disabled mode cannot substitute native tools for them.

Advanced routing requires the official `antigravity-acp` 1.x server, version 1.4.1 or newer, advertising system-append support in its agent capabilities. On an incompatible server, `prefer` falls back to the conversation-level prompt; `disabled` rejects session creation/restoration rather than silently allowing native tools. `/antigravity-acp status` shows the selected mode and whether active connections use system append or the legacy prompt channel. Live behavior has been verified on server 1.4.1.

## Data locations

| Data | Location |
| --- | --- |
| Adapter configuration, catalog and session mappings | `~/.omp/agent/antigravity-acp-provider/` |
| OMP-specific native-tool policy | `~/.omp/agent/antigravity-acp-provider/omp-tools.json` |
| Official credentials/settings/history | Managed by Antigravity under its own storage/keychain |
| Downloaded official runtime | `~/.local/opt/agy-acp/` |
| Generated adapter bundle | `extension/runtime.mjs` |

Never include those user data directories, OAuth callback URLs, account identifiers or downloaded runtime binaries in issues or commits. `OMP_ACP_TRACE=1` enables opt-in tool/selector diagnostics; review diagnostic output before sharing.

## Context continuity and local performance

The adapter now transfers complete replay history within a bounded budget, including historical image attachments. It no longer silently keeps only a 32,000-character history tail. If a transfer does not fit, it stops with an explicit error requesting OMP `/compact` or smaller attachments. This is a local transfer limit, not Antigravity's model context window or its internal compaction threshold. Active requests, history text and system instructions share the token and wire budgets; images also have a separate decoded-data limit. No automatic summarization or extra inference is added by the transfer layer.

Token budgets and wire payload size are independent; the former 500,000-byte clamp is removed. The default wire payload limit is 16 MiB, configurable up to 128 MiB. Image data additionally defaults to an 8 MiB decoded payload limit. The automatic input-token budget is `contextWindow - maxTokens - reserveTokens`, where reserve defaults to the smaller of 16,384 and 5% of the window. A lightweight Unicode-aware estimate checks serialized text plus approximately 4,096 tokens per image. This is not a Gemini tokenizer, cannot guarantee exact token counts and does not include every hidden server instruction.

Persist settings in `~/.omp/agent/antigravity-acp-provider/context.json`, or use the commands below. Defaults apply to every ACP model; entries under `models` override one advertised model ID. Model limits are client metadata and transfer budgets: they do not expand Google's server window or set an unsupported ACP generation-output parameter.

```json
{
  "defaults": {
    "contextWindow": 524288,
    "maxTokens": 32000,
    "reserveTokens": 16384,
    "maxTransferBytes": 16777216,
    "maxImageBytes": 8388608,
    "usageMode": "off"
  },
  "models": {}
}
```

Numeric keys: `contextWindow`, `maxTokens`, `reserveTokens`, `inputTokenBudget`, `maxTransferBytes`, `maxImageBytes`. Omit `inputTokenBudget` to calculate it automatically. A custom input budget must fit alongside output and reserve. Settings load once per process, without disk reads on every streamed chunk. Direct file edits require a restart; commands persist settings and refresh registration in the current process. Restart OMP or reselect the model to refresh displayed metadata. Other OMP processes must restart.

```text
/antigravity-acp context
/antigravity-acp context set default maxTransferBytes 33554432
/antigravity-acp context set gemini-4-argon contextWindow 1000000
/antigravity-acp usage off
/antigravity-acp usage auto
```

For OMP-managed automatic compaction, keep `compaction.enabled`, `compaction.midTurnEnabled` and `compaction.autoContinue` enabled with a working method such as `soft`. A provider-specific threshold can be set without changing other providers:

```sh
omp config set compaction.modelThresholds '{"antigravity-acp/*":"85%"}'
```

Merge that map with existing model-specific entries before running the command. At the example 524,288-token window, 85% triggers at 445,644 tokens, below the automatic transfer estimate budget of 475,904 tokens. OMP can also recover from local context/payload overflow errors. Google independently controls its internal agent summaries. Plugin installation does not automatically change OMP's global compaction configuration.

Active sessions are reused. After five idle minutes, the adapter closes its ACP runtime, bridge and child processes; the next request tries to restore the saved server session. Active streams, outstanding ACP prompts, tools and permission waits prevent eviction. No background model prewarming, quota polling or tokenizer model download is performed.

Optional environment settings, applied when OMP starts:

| Setting | Default | Effect |
| --- | --- | --- |
| `OMP_ACP_HISTORY_BYTES` | context.json or 16 MiB | Optional byte-limit override, 64 KiB–128 MiB; independent of token window |
| `OMP_ACP_IDLE_TIMEOUT_MS` | `300000` | Idle runtime reclamation; `0` disables it, positive values must be at least `1000` |
| `OMP_ACP_USAGE` | context.json or auto | `off` forces supplemental queries off, including when the saved option is auto |

When automatic usage is enabled and `/usage` is advertised by the official server, the adapter queries it after each completed ACP prompt and computes a difference from the previous cumulative snapshot. A restored session first establishes a baseline so its old tokens are not charged again. These are main-agent totals and can include multiple internal model calls. Thinking tokens count toward estimated output cost. Queries are bounded by a five-second deadline; unavailable/malformed usage or a counter reset does not turn a successful model answer into a billing claim. Native ACP response usage takes priority when supplied. Query failures can cancel/retire the connection; subsequent work can restore the server session.

Supplemental queries default to `auto` for compatibility; the example above opts out. Use `/antigravity-acp usage off` to reduce the delay between the last text chunk and OMP regaining control, or `auto` to retain available token/cache/cost estimates. In a Flash Low test with three turns per mode, that final delay had a median of **282 ms with auto vs 21 ms with off** (261 ms less). Individual queries took 241–580 ms. This small sample does not establish a universal speedup, and total response time also varies with inference. Turning queries off preserves ACP context-occupancy updates used by OMP compaction; missing accounting data stays unavailable.

ACP `usage_update.used` is passed to OMP separately as `usage.contextTokens`, rather than treating aggregate billable consumption as context occupancy. OMP 18.12.3 recognizes this field; it can still use a local stored-history estimate when deciding whether to compact. Google continues to control its own internal summaries.

Stable tool ordering and stable context-resource identifiers avoid unnecessary client-side prefix changes. They do not guarantee implicit cache hits. `/antigravity-acp usage` marks cache information as `unknown` when Google omits it; zero cache fields in OMP's numeric usage structure must not be read as proof of zero backend caching. If cache counts are missing, the API-equivalent estimate prices input as uncached and cannot reflect any unreported cache discount. This is not a subscription bill or a measurement of quota deduction.

See the [0.1.8 context/compaction and usage benchmark](docs/context-compaction-0.1.8.md) for current settings and measurements. The [0.1.7 report](docs/continuity-performance-0.1.7.md) documents the previous implementation.

## Limitations

- Argon/Flash default to client metadata of 1,000,000 context tokens and 65,536 output tokens. These can be overridden in context.json. Other models use conservative defaults of 32,768 context tokens and 8,192 output tokens because the model selector does not supply these limits. These are client metadata, not verified server limits or controls over Antigravity's internal compaction.
- API background execution and long decode controls are not exposed.
- The bridge advertises text and image input, not the full Gemini API media surface.
- Thought summaries appear only if the ACP server emits them. A verified Argon High request returned no `agent_thought_chunk`; plan progress and optional debug tool-status lines can appear in OMP's thinking area.
- Cached-token usage appears only when ACP reports it. Missing counts are not proof that backend caching was disabled.
- The prompt inactivity watchdog is 10 minutes without progress, or 60 minutes while tools/permissions are outstanding.
- Argon estimates use the undiscounted list price: $4 input, $20 output and $0.20 cached input per million tokens. Flash estimates use the announced date-dependent rates. These are snapshots, not live pricing discovery.
- Other models have no configured API price yet. Their zero cost fields are placeholders for unavailable estimates and do not mean free usage.
- Not every OMP tool schema is bridge-compatible. Inspect `tools` after a request.
- Antigravity still manages its own native tools and checkpoint summaries.

## Development and verification

`npm test` runs offline regression tests for all-vendor catalogs, per-model thinking choices, selector routing, session ownership, restart-after-shutdown, asynchronous teardown and price calculations. It performs no model inference and consumes no account quota.

`npm run test:usage` uses Bun and mocked protocol responses to verify restored-session baselines, counter resets, query failures and advertised-command gating without starting ACP. `bun scripts/verify-continuity-live.ts --live` is a separate Flash-only probe of long history, synthetic tools, usage accounting and idle process reclamation/restoration; it consumes quota. Its one-second idle setting is isolated to the test process and is not the production default.

`npm run test:packed` additionally requires OMP on PATH. It installs the exact npm tarball into a temporary consumer directory with development dependencies omitted and install scripts disabled, checks runtime assets, and loads its model catalog with ACP execution disabled. It downloads production dependencies and removes the temporary installation afterward.

`npm run test:marketplace` exercises catalog discovery, installation, automatic provider loading, offline cache reuse and uninstallation in a temporary named OMP profile. It downloads the published adapter and cleans the entire test profile afterward. Add `-- --remote` after publishing catalog changes to test the GitHub source instead of the local working tree. No model inference is performed.

`bun scripts/verify-session-routing-live.ts --live` tests synthetic read/edit/command tool round trips, cold ACP session restoration, model changes, and both directions of native-tool mode switching. It consumes quota and creates server history, but does not execute real commands or edit workspace files. Temporary client session mappings are removed afterward.

`npm run test:commands` requires Bun and exercises command persistence and validation offline with an explicitly isolated state directory. The 0.1.4 live routing check passed both `prefer → disabled` and `disabled → prefer` on cold session resume, including an Argon-to-Flash model change; all observed task tools were `pi_read`, `pi_edit` and `pi_bash`.

`bun scripts/verify-debug-live.ts --live` explicitly tests default-off, on and off again on the same ACP session, using an isolated policy and a synthetic read tool. It checks that tool calls/results and a clearly marked synthetic thought event still reach OMP while debug status visibility follows the switch. It consumes quota and creates server history.

For an explicit live check of outgoing tool-priority instructions, incoming thought events and a synthetic OMP tool round trip, use `bun scripts/diagnose-observability.ts --live --installed` from this source checkout. It consumes quota and creates ACP sessions. See the [2026-10-20 verification report](docs/observability-check-2026-10-20.md), including the corrected diagnosis of an isolated prompt-precedence test.

Before publishing, verify local OMP loading without allowing ACP to start:

```sh
AGY_ACP_BIN=/usr/bin/false omp models antigravity-acp --no-extensions -e ./extension/index.ts --json
```

With no local model cache, upstream's conservative fallback may list fewer models. Listing a model is not proof of account entitlement or successful inference.

The original local implementation also passed live Argon/Flash inference, effort-selector and OMP tool round-trip checks. The planning lifecycle fix passed a live Argon Medium request, session shutdown and a subsequent request with conversation history. Those tests do not cover every platform or the complete interactive Refine plan UI.

The generic catalog implementation passed a live refresh and Argon Low/High inference. Claude, GPT-OSS and future IDs are covered by offline catalog/selector fixtures; live inference for those models remains unverified until the ACP server advertises them.

## License and attribution

MIT. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Upstream source is installed as a pinned npm dependency rather than vendored or modified. Official Google executables and their licenses are separate.
