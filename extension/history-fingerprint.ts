// Cache only large, simple payloads. Identity locates an entry; the live values
// must still match an independent snapshot before its digest can be reused.
import { types } from "node:util";

const UNSUPPORTED = Symbol("unsupported snapshot");
const MIN_STRING = 2048;
const MAX_NODES = 128;
type Snapshot = { value: unknown; digest: string };

function worthCaching(content: unknown): boolean {
  if (typeof content === "string") return content.length >= MIN_STRING;
  if (!Array.isArray(content) || types.isProxy(content)) return false;
  for (let i = 0; i < Math.min(content.length, 32); i++) {
    const block = Object.getOwnPropertyDescriptor(content, String(i))?.value;
    if (!block || typeof block !== "object" || types.isProxy(block)) continue;
    for (const key of ["text", "data", "thinking"]) {
      const value = Object.getOwnPropertyDescriptor(block, key)?.value;
      if (typeof value === "string" && value.length >= MIN_STRING) return true;
    }
  }
  return false;
}

// Snapshot construction never retains a live mutable container or invokes an
// accessor. Reject exotic prototypes, aliases/cycles and sparse/custom arrays.
function snapshot(value: any, budget = { nodes: 0 }, seen = new Set<object>()): any {
  if (++budget.nodes > MAX_NODES) return UNSUPPORTED;
  if (value === null || typeof value !== "object") {
    return ["function", "symbol", "bigint"].includes(typeof value) ? UNSUPPORTED : value;
  }
  const array = Array.isArray(value);
  if (types.isProxy(value) || seen.has(value) || Object.getPrototypeOf(value) !== (array ? Array.prototype : Object.prototype)) return UNSUPPORTED;
  seen.add(value);
  const keys = Object.keys(value);
  if (keys.length > MAX_NODES || (array && (keys.length !== value.length ||
      Object.getOwnPropertyNames(value).length !== keys.length + 1))) return UNSUPPORTED;
  const result = array ? [] : Object.create(null);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (array && key !== String(i)) return UNSUPPORTED;
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!Object.hasOwn(descriptor, "value")) return UNSUPPORTED;
    const child = snapshot(descriptor.value, budget, seen);
    if (child === UNSUPPORTED) return UNSUPPORTED;
    result[key] = child;
  }
  return result;
}

function matches(value: any, saved: any, budget = { nodes: 0 }): boolean {
  if (++budget.nodes > MAX_NODES) return false;
  if (value === null || typeof value !== "object") return Object.is(value, saved);
  const array = Array.isArray(value);
  if (types.isProxy(value) || !saved || typeof saved !== "object" || array !== Array.isArray(saved) ||
      Object.getPrototypeOf(value) !== (array ? Array.prototype : Object.prototype)) return false;
  const keys = Object.keys(value);
  if (keys.length > MAX_NODES || keys.length !== Object.keys(saved).length ||
      (array && (value.length !== saved.length || Object.getOwnPropertyNames(value).length !== keys.length + 1))) return false;
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!Object.hasOwn(descriptor, "value") || !Object.hasOwn(saved, key) ||
        !matches(descriptor.value, saved[key], budget)) return false;
  }
  return true;
}

export function createHistoryFingerprintMemo() {
  const entries = new WeakMap<object, Snapshot>();
  return (message: object, value: any, compute: () => string): string => {
    const previous = entries.get(message);
    if (previous && matches(value, previous.value)) return previous.digest;
    // Drop stale strings even if canonical serialization subsequently throws.
    if (previous) entries.delete(message);
    if (!worthCaching(value.content)) return compute();
    const saved = snapshot(value);
    const digest = compute();
    if (saved !== UNSUPPORTED) entries.set(message, { value: saved, digest });
    return digest;
  };
}
