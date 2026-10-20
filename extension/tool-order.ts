export function stableTools<T extends { name: string }>(tools: readonly T[]): T[] {
  // Preserve declarations and executable fields; normalize ordering only.
  return [...tools].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}
