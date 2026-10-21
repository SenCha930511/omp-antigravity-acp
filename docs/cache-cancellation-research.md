# ACP caching and graceful cancellation (2026-10-21)

The research below informed the guarded graceful-cancellation implementation following commit `5b5c9c8`. Original measurements remain distinguished from implementation validation below.

## Public guarantees and limits

[Gemini API caching](https://ai.google.dev/gemini-api/docs/caching?hl=en) supports implicit caching in both stateful and stateless modes. It recommends a large stable prefix and closely spaced requests. Its current minimum is 4,096 tokens for Argon and Flash 3.8. Those public API values are not a documented Antigravity subscription-backend guarantee; Antigravity's cache key, routing scope and TTL are not exposed by ACP.

Changing an ACP session ID is therefore not proof of a cache miss. However, our cold reconstruction turns the OMP transcript into a JSON resource, whereas a warm ACP session holds native agent turns, tool outputs and internal state. These are not identical token prefixes. Stable resource URIs and tool ordering alone cannot make them identical.

[ACP prompt cancellation](https://agentclientprotocol.com/protocol/v1/prompt-turn#cancellation) ends a turn with `cancelled`; it does not require deleting its session. Clients must settle pending permissions and drain final notifications. A subsequent prompt can continue the conversation after the terminal response.

The installed official ACP code calls `agent.conversation.cancel()`, returns `stop_reason="cancelled"`, closes pending tool-status notifications and sweeps stranded permission frames. The pinned client already sends `session/cancel`, waits for the prompt to settle and kills the connection only after its 1.5-second cancellation deadline. Its AbortError wrapper loses the distinction between acknowledged cancellation and a failed/forced cancellation. Our conservative runtime fix currently invalidates both.

## Explicit live probe

`OMP_ACP_USAGE=auto bun scripts/probe-cache-cancellation-live.ts --live`

Five inference calls, Flash 3.8 Low only, no workspace tools. Two new sessions use an identical static reference resource and prime request. The first session also receives a short warm follow-up, an intentionally interrupted counting request and a new exact-output request after cancellation. Startup is excluded from the table. The temporary cleanup registry owns only the probe sessions; sessions/connections are retired afterward. The user's saved usage setting is unchanged.

| Case | Elapsed | Reported input delta | Reported cached delta |
| --- | ---: | ---: | ---: |
| Session A initial prime | 3328 ms | 19916 | unavailable |
| Session A warm follow-up | 2298 ms | 20032 | unavailable |
| Session B identical cold prime | 6534 ms | 19919 | unavailable |
| Session A after cancellation | 2595 ms | 40325 | 18089 |

The last usage delta spans **both the cancelled request and its follow-up**, because cancellation skips the normal supplemental query. It demonstrates real cached input on the ACP path, but does not isolate which request contributed it or establish a post-cancellation hit percentage. Missing cached values are unknown, not zero. The latency differences are single samples and do not establish cache hits or their speedup.

The interrupted prompt returned the official terminal reason `cancelled`; the ACP process remained alive. The next request used **the same session ID** and returned exactly `NEW_REQUEST_OK`, without resuming counting. This validates a tool-free graceful-cancellation path, not all pending-tool/permission races or production OMP history bookkeeping.

## Implemented cancellation policy

1. Stop old OMP tool/permission waits and detach the old writer; do not resolve stale results into a newer request.
2. Send official `session/cancel` and wait for the original prompt's terminal response and updates. Keep new prompts queued during that drain.
3. If cancellation is acknowledged (or the old prompt cleanly finishes), the transport is alive and OMP's accepted history matches the server checkpoint, advance the history fingerprint/message boundary correctly and reuse that session.
4. Rebuild on timeout, process failure, edited/divergent history or any uncertain terminal state. Preserve the new-request continuation guard from `5b5c9c8`.

The adapter preserves the official terminal response through the pinned client wrapper, checkpoints accepted input plus emitted assistant output, and validates that fingerprint before reuse. Checkpoint flags survive idle shutdown/resume. Cancelled turns skip supplemental usage queries. The existing 1.5-second cancellation fallback is preserved.

`npm run test:continuity` covers the built client/runtime: new/edited requests, ordinary tool continuations, queued new prompts, pending tool/permission cancellation, matching partial output, saved checkpoint restore, missing partial output, edited prefixes and nonresponsive cancellation. `bun scripts/verify-graceful-cancellation-live.ts --live` exercises the actual adapter with Flash Low, first interrupting a text response and then a synthetic MCP tool wait. It checks official cancellation acknowledgement, exact follow-up answer, unchanged ACP session ID and absence of a cold history replay. The live probe uses its own state/policies and retires only its sessions. Argon is never used.

Observed on 2026-10-21 through the source adapter (four Flash Low inference requests):

| Interrupted work | Official terminal reason | Follow-up session | Cold history replay | Follow-up answer |
| --- | --- | --- | --- | --- |
| Text generation | `cancelled` | unchanged | none | `NEW_REQUEST_OK` |
| Synthetic MCP tool wait | `cancelled` | unchanged | none | `NEW_REQUEST_OK` |

These are adapter integration checks, not a claim about every OMP frontend's handling of discarded partial output or a measured cache-hit-rate improvement. Production usage/accounting and native-tool settings were not changed.
