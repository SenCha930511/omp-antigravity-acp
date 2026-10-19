import { parseThoughtRoute, validId, type AdvertisedModel } from "./model-catalog.ts";

export function selector(state: any, category: "model" | "thought_level"): any {
  return state.configOptions?.find((option: any) => option.type === "select" &&
    (option.category === category || option.id === category ||
      (category === "thought_level" && ["thinking_level", "reasoning_effort"].includes(option.id))));
}

export function choices(option: any): { value: string; name: string }[] {
  return (option?.options ?? []).flatMap((entry: any) => Array.isArray(entry.options) ? entry.options : [entry])
    .filter((entry: any) => validId(entry.value) && typeof entry.name === "string");
}

export function advertisedRecord(state: any, modelId: string, name: string): AdvertisedModel {
  const thought = selector(state, "thought_level");
  return {
    modelId, name, selector: true,
    ...(thought ? { thoughtLevels: choices(thought).map(option => option.value), defaultThoughtLevel: thought.currentValue } : {}),
  };
}

export function resolveSelection(state: any, requested: string): { modelId: string; effort?: string } {
  const values = choices(selector(state, "model")).map(option => option.value);
  // An exact server ID takes precedence over any local suffix interpretation.
  if (values.includes(requested)) return { modelId: requested };
  const local = parseThoughtRoute(requested);
  if (local) {
    if (!values.includes(local.modelId)) throw new Error(`ACP no longer advertises model ${local.modelId}`);
    return local;
  }
  const legacy = requested.match(/^(.+)-(off|minimal|low|medium|high|xhigh|max)$/);
  if (legacy && values.includes(legacy[1]!)) return { modelId: legacy[1]!, effort: legacy[2]! };
  return { modelId: requested };
}
