# Faster history comparison research — 2026-10-21

The initial research below used a prototype. The production integration and its separate measurements are recorded at the end. The installed 0.1.19 package remains unchanged until a new release/install. No inference, Google quota, user-history reads or user-configuration edits are involved.

## Current cost and alternatives

The pinned runtime selects relevant fields for each message, recursively sorts object keys for canonical JSON, hashes each message with SHA-256 and hashes the newline-separated message digests. Comparisons read the content again so in-place edits cannot silently reuse a stale fingerprint. Several phases of a turn perform comparisons/capture across async boundaries; blindly reusing a previous phase's result is unsafe if the live transcript changed while awaiting cancellation or model setup.

`scripts/benchmark-history-fingerprints.ts` extracts the baseline functions from the pinned source and compares:

- Range iteration instead of array slice/map/join.
- Direct canonical JSON streaming into SHA-256.
- Buffered canonical streaming.
- A **validated per-message memo prototype**, with a separate value snapshot and complete structural checks of live fields before reusing a digest. This is not a WeakMap identity-only cache. Large immutable string values are retained by value without explicitly cloning their byte content; the prototype still checks nested values, field deletion, array order, tool IDs/errors and in-place text changes. SHA-256 output stays byte-for-byte compatible with the baseline on the fixtures.

The prototype caches only simple message payloads with a direct large text/image/thinking string (at least 2048 characters), limits eligibility to 128 value nodes and falls back for accessors, cycles and unsupported types. It uses weak keys, so it does not keep dead message objects alive. It still adds snapshot metadata and can retain the previous string value until a changed entry is refreshed or the message is collected. This is an exploratory implementation, not a production memory profile or exhaustive safety audit.

## Measured synthetic results

Run with `bun scripts/benchmark-history-fingerprints.ts` and `node scripts/benchmark-history-fingerprints.ts`. Per dataset/candidate: ten warmups, nine measured samples, three calls per sample, rotated candidate order. The table shows median time per full prefix comparison on this Mac with Bun 1.4.2. Dataset sizes are serialized JSON bytes, **not tokens**.

| Dataset | Current | Range only | Buffered streaming | Validated memo, warm |
| --- | ---: | ---: | ---: | ---: |
| 129,836 bytes / 101 messages | 0.330 ms | 0.384 ms | 0.301 ms | 0.419 ms |
| 958,736 bytes / 101 messages | 1.482 ms | 1.337 ms | 1.130 ms | 0.119 ms |
| 7,564,736 bytes / 101 messages | 8.573 ms | 8.685 ms | 7.622 ms | 0.120 ms |
| 1,391,456 bytes / 401 messages, nested tool arguments | 5.238 ms | 5.338 ms | 5.480 ms | 5.523 ms |

For new/cloned message objects, the memo prototype has no reusable entry: the 958,736-byte case measured 1.381 ms baseline vs 1.513 ms memo, and the 7,564,736-byte case 8.763 vs 8.819 ms. Smaller and structurally complex workloads have no stable benefit and can regress. Node 26.11.1 showed the same qualitative pattern: long-text warm comparisons became much cheaper; cold/complex comparisons did not.

The potential 12x–71x improvements apply only to the warm long-text comparison operation, not whole OMP turns, cancellation time, ACP startup or cache-hit rate. Nine synthetic samples on one machine do not establish universal production latency. The existing comparison is already usually measured in milliseconds rather than seconds.

## Real OMP host object reuse

`node scripts/probe-host-history-identity.mjs` starts the real OMP RPC process with an isolated temporary profile and a synthetic offline provider. Three prompts yielded:

| Turn | Messages | Prior message objects compared | Same objects |
| --- | ---: | ---: | ---: |
| 1 | 1 | 0 | 0 |
| 2 | 3 | 1 | 1 |
| 3 | 5 | 3 | 3 |

This confirms that the installed OMP host can preserve message identity across normal turns, which makes weak-key memoization relevant. It does not prove every frontend, compaction, restoration, steering path or transcript transformation preserves those objects. The probe removes its temporary profile/workspace and has no actual model/API calls.

## Recommendation

Prefer a guarded per-message digest cache for large simple payloads, with value-snapshot validation on every read and the original algorithm as fallback. Preserve all post-await revalidation and the current SHA-256 digest format so saved ACP mappings remain compatible. Do not replace validation with object identity, timestamps or a last-message-only check: those can miss historical/in-place edits and revive the stale-turn bug.

The integration should benchmark bundled fingerprint functions, verify gains when host objects are cloned or mutated, bound snapshot complexity, measure retained memory over long sessions and compaction, and run all cancellation/continuity regressions.

## Production integration

`extension/history-fingerprint.ts` is injected through a guarded build seam into the pinned runtime's message-fingerprint function. Field selection, canonical JSON, aggregate hashing, saved digest format and all verification points remain unchanged. Each lookup compares an independent snapshot against live values; only messages with a direct string of at least 2,048 characters and at most 128 value nodes qualify. Accessors, proxies, exotic prototypes, cycles/aliases and sparse/custom arrays fall back. A stale entry is removed before recomputation. WeakMap entries retain no mutable host containers or compute callbacks. No user setting is needed because correctness checks are mandatory and unchanged.

`bun --expose-gc scripts/benchmark-runtime-history.ts` extracts the actual bundled fingerprint functions, compares the original hash path with the integrated memo, and performs two full checks (prefix plus pending-context capture). It uses 15 warmups, 15 alternating samples and five repetitions per warm sample. Cold samples clone the transcript outside timing; the first check populates entries and the second can reuse them. These are **local comparison timings, not end-to-end OMP/ACP request timings**. Sizes below are serialized JSON bytes, not tokens or model context capacity.

On this Mac, Bun 1.4.2, sequential benchmark run:

| Synthetic transcript | Original two checks | Integrated warm | Integrated cold |
| --- | ---: | ---: | ---: |
| 99,785 bytes / 100 messages | 0.596 ms | 0.660 ms | 0.590 ms |
| 1,395,785 bytes / 100 messages | 3.597 ms | 0.077 ms | 1.996 ms |
| 11,086,985 bytes / 100 messages | 24.515 ms | 0.081 ms | 12.654 ms |
| 319,185 bytes / 100 complex messages | 6.915 ms | 6.938 ms | 6.939 ms |

Small messages added approximately 0.064 ms in this run; complex messages gained little. Long unchanged text benefited most. A memory probe using 2,000 messages and 16 million generated characters measured about 674 KB of additional live snapshot heap in Bun. After dropping the transcript to simulate compaction, the old message weak reference cleared and heap settled about 12 KB above the pre-fixture reading. GC timing and allocator readings vary; these are retained-heap observations, not a hard bound on process RSS or peak memory. No disk cache or canonical-JSON copy is retained.

Validation includes built-runtime digest equivalence across roles, nested edits, reorderings, field deletion, model changes, cloned objects and unsupported shapes; real runtime cancellation with large shared message objects; the full offline checks; and a clean packed installation loaded by actual OMP without starting ACP. No live inference or user installation change is part of this integration.
