# Changelog

## 0.1.8 — 2026-10-20

- Separate estimated token budgets from wire payload and image size limits; remove the erroneous context-window-to-byte clamp.
- Add persistent default/per-model context settings and `/antigravity-acp context` inspection/update commands.
- Add `/antigravity-acp usage auto|off`, retaining context occupancy when supplemental statistics are disabled.
- Emit recognizable local context/payload overflow errors for OMP recovery and document provider-specific compaction thresholds.
- Verify actual OMP automatic compaction with Flash and a synthetic occupancy trigger; benchmark usage-query latency over six Flash turns.

## 0.1.7 — 2026-10-20

- Replace the 32,000-character reconstruction cutoff with bounded full-history transfer, explicit overflow errors and historical image attachments.
- Read official advertised `/usage` totals and attach per-turn main-agent token deltas, including thinking output; mark absent cache metadata unknown.
- Supply ACP context occupancy independently of aggregate consumption through OMP's `usage.contextTokens` field.
- Reclaim idle runtimes after five minutes while protecting active streams, pending tools and permissions; preserve server session restoration.
- Stabilize tool ordering and context resource identifiers to avoid unnecessary prefix changes, without promising backend cache hits.
- Add offline regressions, Flash-only continuity/resource measurements and opt-out performance settings.

## 0.1.6 — 2026-10-20

- Rename the project, npm package and marketplace plugin to `omp-antigravity-acp-provider`.
- Preserve the `antigravity-acp` provider ID, commands, configuration and session paths.
- Retain upstream fork attribution.

## 0.1.5 — 2026-10-20

- Hide duplicate ACP tool-status lines by default; `/antigravity-acp debug on|off` controls their display immediately without recreating the connection.
- Preserve normal OMP tool calls/results, real thought events, plans and SDK progress watchdog updates.
- Persist the debug option independently of native-tool filtering and retain existing 0.1.4 policy files.
- Add presentation, settings and live same-session debug-toggle checks.

## 0.1.4 — 2026-10-20

- Append OMP tool-routing instructions to the official ACP system prompt and eagerly load pi-bridge tools on supported runtimes.
- Add `/antigravity-acp native-tools prefer|disabled` with an independent OMP policy file. Default to prefer; disabled mode filters native built-ins and fails closed on incompatible runtimes.
- Apply session metadata to new/load/resume, preserving routing after model changes and clearing persisted native-tool filters when returning to prefer mode.
- Add offline routing/policy regressions, explicit live metadata/restoration probes, and research reports distinguishing absent server thought output from client display behavior.

## 0.1.3 — 2026-10-20

- Add npm ecosystem/resource keywords used by zmarketplace to discover OMP extensions.
- Clarify the package description and document zmarketplace search and OMP installation.
- Keep adapter runtime behavior unchanged from 0.1.2.

## 0.1.2 — 2026-10-19

- Discover all server-advertised ACP models without a Gemini-only whitelist, including grouped model selectors and legacy catalogs.
- Read thinking options per model and preserve every advertised OMP-compatible effort, including off, minimal, xhigh and max.
- Migrate existing cached catalogs on refresh; use conservative metadata and unconfigured cost placeholders for unknown models.

- Add the GitHub-hosted sencha-plugins OMP marketplace and a source launcher for the published adapter.
- Prepare production dependencies atomically on first load and reuse the cache offline afterward; npm install scripts and unnecessary Pi CLI peers are disabled.
- Add marketplace provisioning regressions and an isolated end-to-end install/uninstall check.

## 0.1.1 — 2026-10-19

- Make the derivative fork relationship, upstream authorship and OMP-specific modification scope explicit in the README, package metadata and third-party notices.
- Prepare a public npm package with a prebuilt runtime, portable asset resolution, bundled dependency notices and installation instructions.
- Add repository links and publication-time checks.

## 0.1.0 — 2026-10-19

- Extract the locally verified OMP adapter into a portable source project.
- Support official ACP model and thinking selectors for Argon and Flash.
- Keep startup and model listing offline with cached discovery.
- Prefer OMP tools through the authenticated MCP bridge.
- Estimate API-equivalent token costs separately from subscription charges.
- Scope runtimes by OMP session and recreate them after planning-session shutdown.
- Resolve upstream supervisor and runtime-manifest assets at runtime.
