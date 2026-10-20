# ACP thoughts and OMP tool-priority verification

Verified on 2026-10-20 with the installed npm adapter 0.1.3, OMP 18.12.3 and the official Antigravity ACP server 1.4.1. Live tests consumed account quota and created diagnostic ACP sessions. No real workspace reads or edits were requested by the test tool.

## Results

| Request | Real ACP message chunks | Real ACP thought chunks | Tool result |
| --- | ---: | ---: | --- |
| Argon High, arithmetic and instruction recognition | 15 | 0 | No tools requested |
| Flash High, arithmetic and instruction recognition | 16 | 0 | No tools requested |
| Argon Medium, read a synthetic fixture | 1 | 0 | `pi_read` called through OMP; returned `OMP_TOOL_PROBE_OK` |

Each final outgoing `session/prompt` request contained the OMP tool-priority rule, the rule requiring explicit approval before native fallback, and the diagnostic system instruction. Both no-tool requests used an existing system message as well as the legacy `systemPrompt` field. Both models correctly described the tool-priority rule in their answers. The tool request also contained the `pi_read` tool list.

Incoming ACP notifications were counted before the upstream event mapper. None contained `agent_thought_chunk`, including the request involving a tool call. Text responses were received and displayed normally.

A separate, explicitly synthetic `agent_thought_chunk` was injected into the client event handler during the Argon High request. Its marker reached the adapter's `thinking_delta` stream. It was excluded from the real-server event counters and was not sent to Google as a prompt. This confirms that the installed client pipeline can display a text thought event when it receives one.

The server exposed model, thinking-level (`low`, `medium`, `high`) and permission-mode selectors. No separate thought-summary output switch was advertised. These observations establish the missing output at the ACP notification boundary; they do not establish Google's internal reason for not exposing summaries or prove that every future request/version will behave identically.

## Original-session inspection

The affected session's Google-managed local transcript also contained the tool-priority rule, native-fallback approval rule and `pi_read` tool list in its input records. Native `view_file` results nevertheless included project files, beyond the allowed MCP-manifest discovery exception. This establishes that native workspace reads can occur despite the prompt and that the original problem is not explained by an absent tool-priority instruction.

The instruction is a model-facing preference, not a server-side tool allowlist. Successful synthetic-fixture use proves the OMP bridge is functional; it does not guarantee adherence throughout a longer session. Session contents, account identifiers and raw private transcripts are intentionally omitted here.

## Corrected diagnosis

An isolated call to upstream `currentSystemInstructions()` appeared to drop the separately appended prompt whenever transcript system messages existed. That reproduction omitted upstream `AntigravityRuntime.stream()` preprocessing. The actual path first calls `normalizeContext()` and `collapseSystemMessages()`, preserving the appended rule. Testing the complete path and the installed adapter's final ACP request disproved the suspected prompt-loss bug. No production prompt-routing fix is justified by that isolated reproduction.

## Reproduce

With Bun and the official runtime/authentication already configured:

```sh
# Current checkout, after npm run build:
bun scripts/diagnose-observability.ts --live

# Currently installed OMP marketplace adapter:
bun scripts/diagnose-observability.ts --live --installed
```

These are explicit live diagnostics, separate from `npm test`. The script prints only its synthetic prompts' results, event counts and routing checks; it never prints credentials or full outgoing user context. Server-generated history remains in Antigravity's own storage.
