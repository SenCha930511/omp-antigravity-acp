# Changelog

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
