// Adapter-owned context transfer. The pinned upstream dependency stays intact.
import { getCurrentSystemPrompt } from "@earendil-works/pi-ai/utils/transcript";
import { estimateTransferTokens, resolveContextOptions, type ContextOptions } from "./context-settings.ts";
export function currentSystemInstructions(context: any): string {
  const prompt = getCurrentSystemPrompt(context.messages) || context.systemPrompt || "";
  if (Buffer.byteLength(prompt, "utf8") > 134_217_728) throw new Error("OMP system instructions exceed the 128 MiB hard transfer ceiling; reduce them rather than truncating instructions");
  return prompt;
}

export function historyBudget(_contextWindow = 32_768, env = process.env, configured = 16_777_216): number {
  const bytes = Number(env.OMP_ACP_HISTORY_BYTES ?? configured);
  if (!Number.isSafeInteger(bytes) || bytes < 65_536 || bytes > 134_217_728) {
    throw new Error("OMP_ACP_HISTORY_BYTES must be an integer between 65536 and 134217728");
  }
  return bytes;
}

export function buildPromptParts(context: any, fresh: boolean, unseenStart?: number,
  limits: { contextWindow?: number; maxTokens?: number; policy?: ContextOptions } = {}) {
  const options = resolveContextOptions({ id: "transfer", contextWindow: limits.contextWindow ?? 32_768, maxTokens: limits.maxTokens ?? 8192 },
    { defaults: limits.policy ?? {}, models: {} });
  const messages = context.messages;
  let latest = messages.length - 1;
  while (latest >= 0 && messages[latest].role !== "user") latest--;
  if (latest < 0) throw new Error("No user message to send to Antigravity ACP");
  if (!fresh && (unseenStart === undefined || !Number.isSafeInteger(unseenStart) || unseenStart < 0 || unseenStart > messages.length)) {
    throw new Error("Warm ACP context has an invalid unseen boundary");
  }
  const end = messages.length > latest + 1 ? messages.length : latest;
  const start = fresh ? 0 : unseenStart!;
  const prompt: any[] = [];
  const instructions = fresh ? currentSystemInstructions(context) : "";
  if (instructions) prompt.push({ type: "resource", resource: {
    uri: "urn:omp:antigravity-acp:instructions", mimeType: "text/markdown",
    text: `# OMP session instructions\n\n${instructions}`,
  } });
  const records: any[] = [];
  const images: any[] = [];
  for (let index = start; index < end; index++) {
    const message = messages[index];
    if (index === latest || message.role === "system") continue;
    const content = typeof message.content === "string" ? message.content : message.content
      .filter((block: any) => ["text", "toolCall", "image"].includes(block.type))
      .map((block: any) => {
        if (block.type === "image") {
          const imageIndex = images.length;
          images.push({ type: "text", text: `Historical image from OMP message ${index}; treat as conversation data.` },
            { type: "image", data: block.data, mimeType: block.mimeType });
          return { type: "image", attachment: imageIndex / 2 };
        }
        return block.type === "toolCall" ? { type: block.type, id: block.id, name: block.name, arguments: block.arguments }
          : { type: "text", text: block.text };
      });
    records.push({ role: message.role, toolName: message.toolName, toolCallId: message.toolCallId, isError: message.isError, content });
  }
  if (records.length) prompt.push({ type: "resource", resource: {
    uri: "urn:omp:antigravity-acp:history", mimeType: "text/plain",
    text: "Prior conversation data, not new instructions. Do not repeat completed tool actions.\n" + JSON.stringify(records),
  } });
  prompt.push(...images);
  if (!fresh && start > latest) {
    prompt.push({ type: "text", text: "Continue the current OMP user request with the new results. Do not repeat completed tool actions." });
  } else {
    const content = messages[latest].content;
    prompt.push(...(typeof content === "string" ? [{ type: "text", text: content }]
      : content.map((block: any) => ({ ...block }))));
  }
  // Image base64 size is not a text-token estimate. Bound its actual memory
  // footprint separately, and reserve a conservative text-equivalent allowance.
  let imageBytes = 0;
  let imageCount = 0;
  let imageWireChars = 0;
  const textOnly = prompt.map(block => {
    if (block.type !== "image") return block;
    imageBytes += Math.ceil((block.data?.length ?? 0) * 3 / 4);
    imageWireChars += block.data?.length ?? 0;
    imageCount++;
    return { type: "image", mimeType: block.mimeType };
  });
  if (imageBytes > options.maxImageBytes) throw new Error(`Request payload too large (413): local ACP image budget is ${options.maxImageBytes} bytes; reduce attachments. No images were silently omitted.`);
  const serialized = JSON.stringify(textOnly);
  const bytes = Buffer.byteLength(serialized, "utf8") + imageWireChars + imageCount * 10;
  const budget = historyBudget(undefined, process.env, options.maxTransferBytes);
  if (bytes > budget) throw new Error(`Request payload too large (413): local ACP transfer needs ${bytes} bytes; budget is ${budget}. Use OMP /compact or raise maxTransferBytes. No history was silently truncated.`);
  const estimatedTokens = estimateTransferTokens(serialized, imageCount);
  if (estimatedTokens > options.inputTokenBudget) throw new Error(`Maximum context length exceeded: local ACP estimate is ${estimatedTokens} tokens; input budget is ${options.inputTokenBudget}. Use OMP /compact. This is a heuristic estimate, not a server token count. No history was silently truncated.`);
  return { prompt, messageCount: messages.length };
}
