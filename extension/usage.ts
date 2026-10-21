import { usageFromPrompt as upstreamUsage } from "pi-antigravity-acp-provider/src/stream/usage.ts";

export function usageFromPrompt(response: Parameters<typeof upstreamUsage>[0] & { _meta?: { ompContextTokens?: unknown } }) {
  const usage: ReturnType<typeof upstreamUsage> & { contextTokens?: number } = upstreamUsage(response);
  const context = response._meta?.ompContextTokens;
  // OMP accepts contextTokens independently from aggregate billable tokens.
  if (typeof context === "number" && Number.isSafeInteger(context) && context >= 0) usage.contextTokens = context;
  return usage;
}
