// OMP can dispose a temporary planning session while its provider stays registered.
// A disposed upstream runtime is terminal, so never return it to a later request.
export class SessionRuntimePool<T> {
  private readonly entries = new Map<string | undefined, T>();

  constructor(
    private readonly create: () => T,
    private readonly dispose: (entry: T) => Promise<void>,
  ) {}

  get(sessionId?: string): T {
    let entry = this.entries.get(sessionId);
    if (!entry) {
      entry = this.create();
      this.entries.set(sessionId, entry);
    }
    return entry;
  }

  values(): T[] {
    return [...this.entries.values()];
  }

  async close(sessionId?: string): Promise<void> {
    const entry = this.entries.get(sessionId);
    // Detach before awaiting teardown so a new turn cannot reuse a closed runtime.
    this.entries.delete(sessionId);
    if (entry) await this.dispose(entry);
  }

  async closeAll(): Promise<void> {
    const entries = this.values();
    this.entries.clear();
    await Promise.allSettled(entries.map(entry => this.dispose(entry)));
  }
}
