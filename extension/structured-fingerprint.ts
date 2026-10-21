import { types } from "node:util";

const OBJECT = Symbol("object"), NULL_OBJECT = Symbol("null object"), ARRAY = Symbol("array"), FUNCTION = Symbol("function");
const MAX_NODES = 32768, MAX_TOKENS = 131072, MAX_CHARS = 2 * 1024 * 1024;
const FUNCTION_PROTOTYPES = new Set([Function.prototype, Object.getPrototypeOf(async () => {}),
  Object.getPrototypeOf(function* () {}), Object.getPrototypeOf(async function* () {})]);

// One entry per cache, owned by one runtime. Primitive tokens are independent
// of host container identity. Never retain executable tool closures.
export function createStructuredFingerprintMemo() {
  let tokens: unknown[] | undefined, digest: string | undefined;
  function visit(value: any, put: (token: unknown) => void, budget: { nodes: number; chars: number }, seen: Set<object>): void {
    if (++budget.nodes > MAX_NODES) throw new Error("snapshot node budget");
    if (typeof value === "function") {
      if (types.isProxy(value) || !FUNCTION_PROTOTYPES.has(Object.getPrototypeOf(value)) || "toJSON" in value) throw new Error("exotic function");
      put(FUNCTION); return; // Canonical JSON emits null for ordinary functions.
    }
    if (value === null || typeof value !== "object") {
      if (typeof value === "symbol" || typeof value === "bigint") throw new Error("unsupported primitive");
      if (typeof value === "string" && (budget.chars += value.length) > MAX_CHARS) throw new Error("snapshot string budget");
      put(value); return;
    }
    if (types.isProxy(value)) throw new Error("proxy");
    const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
    if (seen.has(value) || (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) ||
        Object.getOwnPropertySymbols(value).length) throw new Error("unsupported container");
    seen.add(value);
    // Schema projection examines non-enumerable properties too. Capture both
    // names and enumerable flags, not just JSON-visible object fields.
    const keys = Object.getOwnPropertyNames(value);
    if (keys.length > MAX_NODES) throw new Error("snapshot key budget");
    if (array && (keys.length !== value.length + 1 || keys.at(-1) !== "length")) throw new Error("custom/sparse array");
    put(array ? ARRAY : prototype === null ? NULL_OBJECT : OBJECT); put(keys.length);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (array && i < keys.length - 1 && key !== String(i)) throw new Error("sparse array");
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!("value" in descriptor)) throw new Error("accessor");
      if ((budget.chars += key.length) > MAX_CHARS) throw new Error("snapshot string budget");
      put(key); put(descriptor.enumerable); visit(descriptor.value, put, budget, seen);
    }
  }
  const clear = () => { tokens = undefined; digest = undefined; };
  const memo = (value: unknown, compute: () => string): string => {
    if (tokens) {
      let index = 0;
      try {
        visit(value, token => { if (!Object.is(token, tokens![index++])) throw new Error("changed"); }, { nodes: 0, chars: 0 }, new Set());
        if (index === tokens.length) return digest!;
      } catch { /* Revalidate/recompute every changed or unsupported payload. */ }
    }
    clear();
    let next: unknown[] | undefined = [];
    try {
      visit(value, token => { if (next!.length >= MAX_TOKENS) throw new Error("snapshot token budget"); next!.push(token); },
        { nodes: 0, chars: 0 }, new Set());
    } catch { next = undefined; }
    const result = compute();
    tokens = next; digest = next ? result : undefined;
    return result;
  };
  return Object.assign(memo, { clear });
}
