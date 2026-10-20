# Continuity, usage and local resources — 0.1.7

Verified on 2026-10-20 with macOS, OMP 18.12.3, Bun 1.4.2, pinned upstream 0.1.15 and official ACP 1.4.1. Live inference used only Gemini 3.8 Flash, Low thinking. No reverse proxy or direct model OAuth transport was used. Synthetic tools did not access workspace files or execute commands.

## Implementation decisions

- Keep the installed upstream package unmodified. Scope build-time resolution overrides to the pinned runtime's context and usage imports; guard the two runtime call-site adaptations so an upstream change fails the build for review.
- Transfer full structured history and historical image blocks within an explicit memory/prompt budget. Overflow is an error with an OMP compaction suggestion; no silent tail truncation. Cold imports still do not recreate model-private thinking or thought signatures from another agent.
- Preserve delta-only warm continuation and official session resume/load. Use stable resource identifiers and tool-name ordering, without claiming backend cache affinity.
- Read official `/usage` only when the server advertises that command. Hide its report from assistant output. Compute monotonic per-turn deltas; establish a fresh baseline on restore, re-anchor after resets and discard the baseline after failed reads. Standard ACP usage takes priority.
- Keep actual context occupancy separate from aggregate billable tokens. OMP 18.12.3's `calculateContextTokens` honors `usage.contextTokens`; aggregate usage remains available for cost accounting.
- Reclaim idle processes after five minutes by default using unreferenced one-shot timers. Leases protect streams; outstanding ACP prompts protect tool and permission continuations. Reclamation removes the runtime from the pool before asynchronous disposal. Server session data is preserved for restoration.

## Flash live results

One fixture contained an early marker followed by over 42,000 characters of historical text. The current request required the marker plus a new synthetic read-tool result. Both the initial request and the request after idle reclamation returned the correct marker and fresh tool result. Both used the same server ACP session.

| Observation | Initial turn | Turn after idle reclamation |
| --- | ---: | ---: |
| Reported main-agent input tokens | 36,554 | 24,766 |
| Reported completion + thinking tokens | 613 | 182 |
| Last reported context occupancy | 12,695 | 12,553 |
| ACP process-tree RSS after turn | 459.84 MiB | 454.72 MiB |
| ACP process-tree RSS after reclamation | 0 MiB | 0 MiB |
| Supplemental usage queries | 1 | 2 (restore baseline + completed turn) |
| Total usage-query time | 250 ms | 1,330 ms |

No cached-token count was returned, so cache status was unknown. The second turn's usage was a delta rather than the full old session total. Google quota percentages were not interpreted as monetary charges. RSS is a snapshot summed across this probe's own supervisor/server/harness tree, not total application memory, peak memory, or a comparison with direct OAuth. The idle timeout was shortened to one second for this isolated test.

A subsequent short Flash request verified the final OMP event carried `contextTokens: 5056`, `input: 4993`, `output: 63`, and the expected answer. Supplemental `/usage` text did not leak into the answer.

## Local context assembly

An isolated Bun microbenchmark built a cold prompt containing 400,000 bytes of synthetic history 100 times: median 0.416 ms, p95 0.746 ms; process RSS was 42.52 MiB. These are local synthetic measurements, not end-to-end latency, OMP memory attribution, a peak-memory bound, or evidence of improvement over direct OAuth. No tokenizer runtime or model was downloaded.

## Limits and remaining work

- This is not a paired direct-OAuth speed benchmark. Google scheduling, hidden agent steps, prompt contents and reasoning differ, so no percentage speedup is claimed.
- Official `/usage` incurs an extra control request and may query quota internally. Set `OMP_ACP_USAGE=off` to skip it. It currently reports main-agent usage rather than complete subagent billing.
- Cache metadata absence remains unknown, not zero. Stable client serialization cannot guarantee Google cache hits, TTLs or subscription quota discounts.
- The configurable transfer budget is a byte heuristic capped by model metadata, not a true tokenizer or a promise to transfer a full million-token history. Historical images have a separate 8 MiB payload cap and their token allowance is approximate.
- Budget overflow requires OMP compaction or smaller content; Google may independently compact its agent history. Successful server resume retains its original native state, but rebuilding from OMP history cannot reproduce private reasoning state.
- Idle reclamation trades a future process/restore startup for lower idle memory. Set `OMP_ACP_IDLE_TIMEOUT_MS=0` when uninterrupted warm residency matters more than memory.
- Official transport is not an account-safety guarantee or individual Google authorization for this adapter.

Primary references: [ACP usage updates](https://agentclientprotocol.com/protocol/v1/prompt-turn), [OMP 18.12.3 context accounting](https://github.com/can1357/oh-my-pi/blob/v18.12.3/packages/agent/src/compaction/compaction.ts), [Gemini API caching](https://ai.google.dev/gemini-api/docs/caching). Gemini API caching documentation does not establish the Antigravity subscription backend's cache policy.
