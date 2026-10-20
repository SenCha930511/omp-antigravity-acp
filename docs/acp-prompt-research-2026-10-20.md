# Why native file reads compete with OMP tools

Inspected on 2026-10-20: installed adapter 0.1.3 and Google's official ACP runtime 1.4.1. Production configuration and runtime binaries were not changed. One isolated live metadata probe consumed quota and created a diagnostic ACP session.

## Findings and evidence limits

1. **The OMP preference reaches the model, but travels as conversation content.** The current upstream adapter serializes the resolved OMP system instructions into a `session/prompt` content block headed `Pi session instructions`. This heading does not turn the content into Google's own system prompt. The original affected session and the earlier live probes confirm that the routing rule is present and usable.
2. **The shipped local harness contains native-tool guidance.** Its embedded prompt text names `view_file`, native search/edit tools and specific-tool preference. It also contains instructions to read lazy MCP manifests with `view_file`. These are concrete strings in the installed executable; they are not a capture of the complete, rendered prompt for the affected model call. Their presence supports an explanation of competing guidance, but cannot establish exactly which template/version branch applied on every turn.
3. **Lazy MCP tools require more discovery than directly registered tools.** The default adapter sends the `pi-bridge` MCP server without enabling the official eager-loading extension. The harness contains distinct instructions for lazy MCP schema reading and direct invocation of eagerly loaded tools. This is a structural difference between OMP bridge tools and readily visible native tools, rather than evidence of a model's psychological preference.
4. **A stronger, supported-by-this-runtime session channel exists.** The shipped ACP server accepts `_meta.antigravity.systemPrompt.append` on new/load/resume, maps it to the SDK's `system_instructions`, and appends those instructions to the harness's defaults. The current adapter does not use that channel for its routing rule.
5. **Built-in tool filtering also exists.** The same session extension accepts `enabledTools` and `disabledTools`. The filter controls Google's native built-ins; it does not filter MCP/custom tools. An empty `enabledTools` list disables all built-ins. The server explicitly applies the filter to its safe `view_file` substitute as well. Client-filesystem callbacks are controlled separately by ACP client capabilities, which this adapter currently advertises as false.

The original session used native `view_file` for project files even though the OMP rule and `pi_read` were present. That proves incomplete adherence in that session. It does not by itself identify one internal model decision or prove a universal preference across models.

## Evidence locations in the installed runtime

The unmodified server executable contains stored Python source entries. They were read in memory using their local archive headers and verified CRCs; no Google source or executable was copied into this repository.

Relevant entries:

- `acp_server/system_prompt.py`: extracts only `systemPrompt: {append: string}` from the session's Antigravity metadata.
- `acp_server/request_meta.py`: reads session extension settings from `_meta.antigravity`.
- `acp_server/server.py`: new/load/resume preserve the system addition and pass it into agent configuration; tool-filter resolution also governs the safe `view_file` replacement.
- `acp_server/tool_filter.py`: documents and implements the built-in allowlist/denylist semantics.
- `acp_server/mcp_servers.py`: turns `eagerMcpServers` names into eager MCP configuration for ACP v1 clients.
- `google/antigravity/connections/local/local_connection.py`: maps string instructions to appended default-system instruction sections.
- `localharness_external`: contains native-tool preference, lazy MCP manifest-reading and eager-tool direct-call prompt strings.

These findings concern this installed runtime. Extension availability and behavior must be negotiated or verified before relying on them with other versions.

## Isolated live probe

The probe sent these fields only on its own new session:

```json
{
  "_meta": {
    "antigravity": {
      "systemPrompt": {"append": "Diagnostic instructions and a system-only confirmation marker"},
      "eagerMcpServers": ["pi-bridge"],
      "enabledTools": []
    }
  }
}
```

The user prompt requested a synthetic in-memory fixture and did not contain the confirmation marker. The model called `pi_read` through the normal OMP MCP bridge, received `METADATA_MCP_PROBE_OK`, and returned both that result and the system-only marker `SYSTEM_APPEND_ONLY_6D49`.

Observed ACP updates: one available-commands update, one tool call, one tool-call update, two usage updates and one message chunk. The only tool title was `Running pi_read`; there were no native file-read calls. The fixture tool did not access the filesystem.

This verifies a functioning system-append channel and a successful OMP tool round trip with the native built-in allowlist empty and MCP tools eagerly loaded. It is a combined smoke test, not an A/B benchmark isolating the effect of each setting or a guarantee of every real tool/schema/session.

Reproduce from this source checkout, with Bun and the marketplace adapter already installed:

```sh
bun scripts/probe-session-metadata.ts --live
```

## Recommended adapter direction

- Put the provider-specific OMP routing rule in the official session system-append extension, while preserving OMP's normal conversation reconstruction.
- Eagerly register the `pi-bridge` tools to remove lazy schema-discovery overhead.
- If strict OMP tool usage is desired, expose an explicit native-tool filtering setting. Prompt preference alone cannot enforce a tool allowlist. Filtering built-ins does not remove any separately configured global MCP servers.
- Apply supported metadata consistently to new/load/resume and model rebuilds, and test real reads, edits, commands and long-session continuations before changing the production default.

No production adapter behavior was changed as part of this research.
