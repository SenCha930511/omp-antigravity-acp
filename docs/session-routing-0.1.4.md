# 0.1.4 routing verification

The new adapter uses Google's ACP session extension fields on `session/new`, `session/load` and `session/resume`. It keeps the upstream dependency unmodified. Only the provider-specific routing rule is appended through the system channel; ordinary OMP context reconstruction remains intact.

Default behavior is `prefer`, with native built-ins retained. Optional `disabled` mode sends an empty built-in allowlist while keeping MCP tools. Returning to `prefer` explicitly sends an empty denylist and omits the allowlist to clear any filter restored by the Google server. Unsupported runtimes use the legacy conversation prompt in prefer mode and reject session setup in disabled mode.

## Offline checks

- 33 regression tests passed, including metadata propagation to all three session lifecycle RPCs, strict compatibility failure before dispatch, clearing inherited filters, and independent atomic policy persistence.
- The command integration test passed with an injected temporary state directory and ACP execution disabled. It validates mode changes and rejects invalid values without changing the saved mode.
- OMP catalog loading passed with ACP execution disabled.
- A fresh production-only install of the packed package passed portable runtime asset checks and offline OMP catalog loading.

## Live checks

Tested on 2026-10-20 with official ACP 1.4.1. The client recorded session metadata at the SDK's final request dispatch boundary. The tools read, edited and checked a synthetic in-memory fixture; no real workspace files were changed and no real command was executed.

| Initial mode | Restored mode | Restore RPC | Model transition | OMP task tools |
| --- | --- | --- | --- | --- |
| prefer | disabled | session/resume | Argon Medium → Flash Medium | read, edit, bash, read |
| disabled | prefer | session/resume | Argon Medium → Flash Medium | read, edit, bash, read |

Every new/resumed session request contained the real system-append rule and `eagerMcpServers: ["pi-bridge"]`. Disabled mode contained `enabledTools: []`; prefer contained `disabledTools: []` and no allowlist. All observed server task tool titles were `Running pi_read`, `Running pi_edit` or `Running pi_bash`. The fixture changed from BEFORE to AFTER, the synthetic command result was returned through OMP, and the resumed conversation completed successfully.

The two live cases establish a functioning route and restoration path, not universal prompt adherence in prefer mode or complete compatibility of every OMP schema. The default unit tests perform no live inference. The explicit live script closes its runtimes and removes temporary client session mappings; Google retains server history in its normal storage.
