export type NativeToolMode = "prefer" | "disabled";

export const TOOL_ROUTING = `
OMP tool routing:
The supplied OMP tools are exposed by the authenticated pi-bridge MCP server with pi_ prefixes. When eagerly registered, call these tools directly using their advertised names.
For workspace reads, searches, edits, command execution, and other user tasks, choose an appropriate supplied pi_ MCP tool before considering an Antigravity-native tool. Their results return through the OMP tool loop.
You may use Antigravity's normal MCP discovery mechanism to inspect the pi-bridge tool manifests if required. Do not search unrelated directories or configuration files to locate MCP tools.
If an OMP tool fails, inspect the error and correct its arguments when appropriate. Do not switch to a native tool merely because the OMP call failed.
If no suitable OMP tool is available, explain the missing capability. Before substituting an Antigravity-native tool for a user task, state the proposed tool and reason and obtain the user's explicit approval. Without approval, stop that operation and report the limitation.
This exception does not require approval for normal pi-bridge MCP manifest discovery; it applies to performing the user's task with native tools.
`;

export function systemRouting(mode: NativeToolMode): string {
  return TOOL_ROUTING + (mode === "disabled"
    ? "\nNative built-in tools are disabled for this session. Use the supplied OMP MCP tools and report missing capabilities instead of substituting a native tool."
    : "");
}

export function parseNativeToolMode(value: unknown): NativeToolMode {
  if (value === "prefer" || value === "disabled") return value;
  throw new Error("nativeTools must be prefer or disabled");
}

export interface InitializeMetadata {
  agentInfo?: { name?: string; version?: string };
  agentCapabilities?: {
    _meta?: {
      antigravity?: {
        systemPrompt?: { append?: boolean };
      };
    };
  };
}

export interface SessionRpcRequest {
  mcpServers?: Array<{ name?: string }>;
  _meta?: {
    antigravity?: {
      systemPrompt?: { append?: string };
      eagerMcpServers?: string[];
      enabledTools?: string[];
      disabledTools?: string[];
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export function supportsSessionRouting(initialize: InitializeMetadata | undefined): boolean {
  const version = initialize?.agentInfo?.version?.match(/^(\d+)\.(\d+)\.(\d+)$/);
  return initialize?.agentInfo?.name === "antigravity-acp" &&
    initialize.agentCapabilities?._meta?.antigravity?.systemPrompt?.append === true &&
    !!version && Number(version[1]) === 1 &&
    (Number(version[2]) > 4 || (Number(version[2]) === 4 && Number(version[3]) >= 1));
}

export function sessionRoutingRequest<T extends SessionRpcRequest>(request: T, initialize: InitializeMetadata | undefined, mode: NativeToolMode): T {
  if (!supportsSessionRouting(initialize)) {
    if (mode === "disabled") {
      throw new Error("Native tool filtering requires official Antigravity ACP 1.4.1+ (1.x) with system-append support; refusing to weaken disabled mode");
    }
    return request;
  }
  const previous = request._meta?.antigravity ?? {};
  const inherited = typeof previous.systemPrompt?.append === "string" ? previous.systemPrompt.append : "";
  const eager = new Set(Array.isArray(previous.eagerMcpServers) ? previous.eagerMcpServers : []);
  if (request.mcpServers?.some(server => server.name === "pi-bridge")) eager.add("pi-bridge");
  return { ...request, _meta: { ...request._meta, antigravity: {
    ...previous,
    systemPrompt: { append: [inherited, systemRouting(mode)].filter(Boolean).join("\n\n") },
    eagerMcpServers: [...eager],
    // Explicitly clear a persisted disabled filter when loading in prefer mode.
    ...(mode === "disabled" ? { enabledTools: [] } : { enabledTools: undefined, disabledTools: [] }),
  } } };
}

// The pinned upstream connection exposes session methods but not their _meta
// extension slot. Decorate its SDK RPC seam without modifying upstream files.
export function installSessionRouting(
  rpc: Record<string, (request: SessionRpcRequest) => Promise<unknown>>,
  initialized: Promise<InitializeMetadata>,
  mode: NativeToolMode,
  onApplied: (advanced: boolean) => void = () => {},
) {
  for (const name of ["newSession", "loadSession", "resumeSession"]) {
    const original = rpc[name]!.bind(rpc);
    rpc[name] = async (request: SessionRpcRequest) => {
      const initialize = await initialized;
      const routed = sessionRoutingRequest(request, initialize, mode);
      const response = await original(routed);
      onApplied(routed !== request);
      return response;
    };
  }
}
