# Project instructions

- Keep runtime communication on the official Antigravity ACP protocol; do not add a model API reverse proxy.
- Never commit credentials, OAuth callbacks, user configuration, session history, downloaded Google runtimes, or generated bundles.
- Keep upstream code unmodified. Compatibility changes belong in this adapter.
- Run `npm run check` and an offline OMP catalog load before committing runtime changes.
- Use conventional commit messages: lowercase prefix, colon, space, imperative summary.
- Live inference tests consume account quota and create Antigravity sessions. Keep them explicit and separate from the default tests.
