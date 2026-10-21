# Esc-to-session-reuse performance research — 2026-10-21

Research against `d279ca5`; production runtime and installed package are unchanged by this investigation. All local probes use synthetic messages and tools. The optional live probe uses Flash Low only and isolated adapter state.

## What the code actually waits for

The client does not ask Google a separate question to check whether history matches. It compares local accepted-history fingerprints/checkpoints, tool definitions, permission state and retained partial output. With a live compatible binding, `getBinding` returns the existing promise and does not perform a session-resume RPC. Restoring an evicted binding is a different path involving process initialization and resume/load.

The runtime already registers an abort listener, and the underlying connection's prompt wrapper sends `session/cancel` when Esc aborts its signal. It also arms the existing 1,500 ms forced-close fallback. Moving this work earlier is therefore not a new optimization. A new request arriving while cancellation is pending can additionally enter `drainCancelledTurn`, which sends another cancel. `awaitContinuation` has its own cancel path for parked tools/permissions.

In ACP v1, `session/cancel` is a **notification**, not a round-trip acknowledgement. Completion of the local `cancel()` send is insufficient evidence of an idle session. The original `session/prompt` terminal response confirms cancellation, after final updates have been flushed. See [official prompt-turn cancellation](https://agentclientprotocol.com/protocol/v1/prompt-turn#cancellation). The current v2 lifecycle is a separate draft and is not evidence that the installed v1 transport can skip this wait. Google's CLI ACP documentation URL could not be fetched by the web tool during this investigation, so no claim relies on that page.

## Instrumentation and local measurements

`bun scripts/probe-cancellation-cost.ts` loads the actual generated runtime into an in-memory instrumented module and uses the actual base connection prompt/abort wrapper with a deterministic fake transport. It records Esc until follow-up transport dispatch, cancellation notification count, synchronous persistence and selected function costs. It uses 100 shared synthetic long-message objects, optionally 64 tools with 30 string fields each, nine trials (first three excluded). The fake server either acknowledges on a zero-delay timer or after an injected 50 ms delay. It asserts session reuse and completion. Nested function times overlap and must not be summed. These are exploratory sequential samples with instrumentation/JIT/timer noise, not a randomized production benchmark or real server timing.

| Fixture | Current Esc-to-dispatch median | Structured-value prototype |
| --- | ---: | ---: |
| No tools, zero-delay fake acknowledgement, memory store | 1.295 ms | not tested |
| 64 tools, zero-delay acknowledgement, memory store | 3.114 ms | 1.890 ms |
| 64 tools, zero-delay acknowledgement, actual temporary file store | 4.509 ms | 2.201 ms |
| 64 tools, injected 50 ms acknowledgement, memory store | 55.786 ms | 55.069 ms |

The zero-delay tool case spent about 2.10 ms in three complete history-fingerprint calls and 0.89 ms in two tool-fingerprint calls. The expensive payload was the generated system message containing tool definitions, which does not qualify for the large-simple-text cache. `normalizeContext`/`collapseSystemMessages` also construct a new system-message container each request; an identity-keyed memo alone cannot handle that container across requests. The actual temporary session store contributed about 0.93 ms across writes in the disk fixture. This is a single-record synthetic store without lock contention, not a claim about the user's disk or session registry.

The research candidate validates a bounded flat snapshot of system/tool values before reusing results. It retains immutable primitive tokens, not live containers or execute-function closures. It handles equivalent new containers and detects schema edits without repeating canonical JSON, sorting, schema projection or hashing on hits. Equivalence probes cover repeated calls, replacement arrays, in-place schema descriptions and system-section changes. Unsupported shapes, proxies, cycles/aliases and TypeBox metadata symbols fall back. This candidate is **not production-ready**: production integration needs broader TypeBox/schema/mutation coverage, cache lifetime/isolation and memory profiling, and all existing continuity regressions. Increasing the current 128-node text-cache limit alone does not address generated-container identity or the separate tool-projection work.

The overlapping Esc/new-request fixture sent two cancellation notifications; a per-turn deduplication experiment sent one. With an injected 50 ms acknowledgement delay its median was 56.595 ms versus 55.786 ms current, so this test demonstrates less protocol traffic, **not a measured latency win**. A production deduplication must be keyed by connection, session and active-turn generation, share in-flight work and deadlines, and never suppress the next turn's cancellation or treat a completed send as acknowledgement.

An additional isolated lock-contention probe held a synthetic session-store lock in another process (150 ms timer plus Node startup), then invoked the actual synchronous `AcpSessionStore.save`. Save blocked for 240.466 ms and a zero-delay event-loop timer ran only after 243.795 ms. This demonstrates a possible responsiveness bottleneck under contention, **not evidence that the user's store is currently contended**. The pinned lock implementation retries with synchronous `Atomics.wait` in 10 ms steps up to a five-second deadline, so CPU/hash optimizations alone do not solve this class of stall.

## Recommended optimization scope

1. Prefer a bounded, value-validated **shared system/tool checkpoint**, reusing projections and canonical digests across generated containers. Keep complete selected-field checks and revalidation across asynchronous boundaries. This targets measured CPU work and requires no OMP revision API or Google protocol change.
2. Deduplicate cancellation per active turn as a correctness/traffic simplification; preserve the terminal-response requirement and deadline. Do not advertise a speedup without a real paired test.
3. Replace blocking lock waits with a serialized asynchronous persistence implementation if responsiveness under contention is a priority. Preserve durable checkpoint boundaries, shutdown flushing and cross-process merge/lock semantics; this requires an adapter-level store integration, not merely substituting an async function behind an unawaited synchronous interface. Profile realistic registry size/contention before claiming a user-visible win. Avoid blindly deferring cancellation checkpoint writes: a crash/idle teardown could lose resumable state. Only redundant snapshots can safely be coalesced.
4. Do not skip history validation, race new prompts ahead of the old terminal response, rebuild every session, or shorten the 1.5-second deadline to claim faster reuse. Those can recreate stale-turn behavior or increase cold replay and cache loss.

Local computation can be reduced by milliseconds in these fixtures. Waiting for the installed server's terminal response, cold initialization/resume and model prefill are independent costs; this research does not claim an order-of-magnitude reduction in real follow-up latency.

## Live attempt and limitation

`bun scripts/verify-graceful-cancellation-live.ts --live --text-only` was attempted with the current source adapter and Flash 3.8 Low. The first request produced no cancellable text chunk before its 90-second deadline; the assertion requiring a genuine output-triggered interruption failed, so the follow-up request was not submitted. This attempt supplies **no valid Esc acknowledgement or online speedup measurement**. The script closed its own connection and retired its own isolated session/state in `finally`. No user configuration or active user session was changed. A rerun is required before making real-server latency claims; no Argon calls were made.
