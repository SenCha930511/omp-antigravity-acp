interface PendingTurn {
  turnCompletion?: Promise<void>;
  session: { sessionId: string };
  connection: { cancel: (sessionId: string) => Promise<void> };
}

// The caller decides whether the accepted transcript still matches. This only
// drains the old turn, never resolves an old tool result into a new writer.
export async function drainCancelledTurn(
  binding: PendingTurn,
  abort: () => void,
  signal?: AbortSignal,
  timeoutMs = 1500,
): Promise<boolean> {
  const completion = binding.turnCompletion;
  if (!completion || signal?.aborted) return false;
  const deadline = Promise.withResolvers<boolean>();
  const cancelled = () => deadline.resolve(false);
  const timer = setTimeout(cancelled, timeoutMs);
  signal?.addEventListener("abort", cancelled, { once: true });
  try {
    abort();
    // A blocked cancel transport must not block the fallback deadline.
    try { void binding.connection.cancel(binding.session.sessionId).catch(() => deadline.resolve(false)); }
    catch { return false; }
    return await Promise.race([completion.then(() => true, () => false), deadline.promise]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancelled);
  }
}
