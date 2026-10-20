# Context settings, OMP compaction and usage-query timing — 0.1.8

Verified on 2026-10-20 with macOS, OMP 18.12.3 and official ACP 1.4.1. Live generation used only Gemini 3.8 Flash with Low thinking. No tools accessed real files or executed workspace commands.

## Corrected budgets

0.1.7 incorrectly compared the model's numeric token window with a byte limit. 0.1.8 removes that coupling. The independent defaults are a 16 MiB wire payload ceiling, an 8 MiB decoded image ceiling, and an estimated input-token budget derived from the model window less output and agent headroom. The estimate is a lightweight heuristic, not a Gemini tokenizer. It requires no tokenizer download or background worker.

`context.json` persists default and per-model overrides. Commands inspect/change them without shell startup-file edits. Byte settings may be raised to 128 MiB; image settings and token budgets have separate validation. Larger limits remain bounded and do not expand the official server's context window. Client `maxTokens` is an output reservation/metadata value, not an ACP generation parameter enforced by Google.

An example client window of 524,288 tokens, output reservation of 32,000 and agent headroom of 16,384 yields an estimated input budget of 475,904. OMP's provider-specific 85% compaction trigger is 445,644, leaving room before transfer validation. OMP's separate compaction reserve and retained-tail settings are not the adapter's agent-headroom field. Supplemental usage queries can be disabled without losing `usage.contextTokens`.

## Flash usage-query benchmark

`OMP_ACP_USAGE=auto bun scripts/benchmark-usage-live.ts --live` creates two independent official ACP sessions and alternates three identical tiny prompts per mode in the order auto/off/off/auto/auto/off. Startup/selector negotiation is excluded. Each prompt requests exactly `OK` with native tools disabled. Sessions are closed afterward. The first request per session is not a warmed inference sample; backend scheduling and cache state are uncontrolled.

| Mode | Text complete | Whole turn complete | Tail after text | Supplemental query |
| --- | ---: | ---: | ---: | ---: |
| auto 1 | 3179 ms | 3461 ms | 282 ms | 260 ms |
| off 1 | 2919 ms | 2942 ms | 23 ms | 0 ms |
| off 2 | 2095 ms | 2116 ms | 21 ms | 0 ms |
| auto 2 | 2442 ms | 3039 ms | 597 ms | 580 ms |
| auto 3 | 2748 ms | 3014 ms | 266 ms | 241 ms |
| off 3 | 1830 ms | 1851 ms | 21 ms | 0 ms |

Median post-text tail: **282 ms auto vs 21 ms off**, a difference of **261 ms**. The enabled mode issued one supplemental query per turn, taking 241–580 ms. Median whole-turn times were 3039 ms and 2116 ms, but the difference includes inference variability and cannot all be attributed to the switch. Three samples per mode do not establish a universal speedup. The older report's 1330 ms value was the sum of two queries around a restored turn, not a per-answer constant.

Default automatic statistics remain enabled for compatibility. Users can select `/antigravity-acp usage off` for lower terminal-event latency and `/antigravity-acp usage auto` for token/cost estimates. The optional `OMP_ACP_USAGE=off` environment variable overrides the saved setting. No edit to `.zshrc` is required. Missing usage/cache remains unavailable, not proof of free execution or absent backend caching.

Re-enabling automatic statistics after a disabled period discards the old baseline. The first subsequent turn may need a baseline query before generation and another query afterward; tokens generated while disabled are not assigned to that turn.

## Actual OMP automatic-compaction check

`bun scripts/verify-auto-compaction-live.ts --live` launches the real installed OMP in an isolated profile with only this source adapter, Flash Low, no workspace tools, no rules/skills and no title generation. A clearly marked **synthetic 50,000-token occupancy** on the first terminal event crosses a temporary 25,000-token threshold. This avoids spending 445,000 actual model tokens simply to exercise the control flow.

Observed sequence: `turn_end → auto_compaction_start(reason=threshold, action=context-full) → auto_compaction_end(aborted=false) → agent_end`. Flash generated a real summary retaining `COMPACT_KEEP_73D2`. The test disables automatic continuation to keep inference bounded; production continuation remains enabled in the user's existing OMP settings. This verifies the compaction route and summary generation, not a live 445,644-token saturation run. The temporary profile, state and child processes are cleaned afterward.

The first two harness attempts waited for piped stdin before model startup. The harness now closes stdin explicitly. Those attempts did not start ACP or model inference.

## Remaining limits

- Google still controls its own internal checkpoints and compression; there is no client guarantee of retaining a full 1M-token raw history.
- Token estimates can differ from Google tokenization, particularly code, unusual Unicode and images. Local overflow messages are explicit and use OMP-recognizable context/payload wording for recovery. A single oversized user message or attachment may still require reducing that content.
- Automatic compaction must be enabled and have an available method. Changing the adapter budget alone does not enable OMP compaction.
- Direct file edits and changes made in another OMP process require restart. The same context policy is used for model registration and runtime transfer.
- The 16 MiB default is a payload ceiling, not a permanent memory allocation. Input is already resident in OMP, and cold serialization creates additional temporary strings. Idle runtime reclamation from 0.1.7 remains enabled.

References: [OMP 18.12.3 model compaction thresholds](https://github.com/can1357/oh-my-pi/blob/v18.12.3/packages/coding-agent/src/config/compaction-threshold.ts), [OMP context accounting and trigger calculation](https://github.com/can1357/oh-my-pi/blob/v18.12.3/packages/agent/src/compaction/compaction.ts), [ACP session updates](https://agentclientprotocol.com/protocol/v1/prompt-turn).
