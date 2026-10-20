// Presentation only: the SDK watchdog still sees all notifications, and OMP
// tool invocations/results travel through the separate MCP bridge.
export function showAcpUpdate(notification: any, debugToolUpdates: boolean): boolean {
  const kind = notification.update?.sessionUpdate;
  return debugToolUpdates || (kind !== "tool_call" && kind !== "tool_call_update");
}
