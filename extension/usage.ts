import { usageFromPrompt as upstreamUsage } from "pi-antigravity-acp-provider/src/stream/usage.ts";

export function usageFromPrompt(response: any) {
  const usage: any = upstreamUsage(response);
  const context = response._meta?.ompContextTokens;
  // OMP accepts contextTokens independently from aggregate billable tokens.
  if (Number.isSafeInteger(context) && context >= 0) usage.contextTokens = context;
  return usage;
}
