# Faster history comparison research — 2026-10-21

Research/prototype only; the installed 0.1.19 runtime and production comparison code are unchanged. No inference, Google quota, user-history reads or user-configuration edits are involved.

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

Before production integration: benchmark the exact runtime call path (not just the helper), verify gains when host objects are cloned or mutated, choose thresholds without slowing small/complex workloads, measure retained/peak memory over long sessions and compaction, and run all cancellation/continuity regressions. This research intentionally does not change, publish or reinstall the user's plugin.
