export class InMemoryKeyedLock {
  private readonly tails = new Map<string, Promise<void>>();

  async withKeys<T>(
    keys: readonly string[],
    operation: () => Promise<T>,
  ): Promise<T> {
    const orderedKeys = [...new Set(keys)].sort();
    const predecessors = orderedKeys.map(
      (key) => this.tails.get(key) ?? Promise.resolve(),
    );
    const predecessor = Promise.all(predecessors);

    let release: Function | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = predecessor.then(() => gate);

    for (const key of orderedKeys) {
      this.tails.set(key, tail);
    }

    await predecessor;
    try {
      return await operation();
    } finally {
      release?.();
      for (const key of orderedKeys) {
        if (this.tails.get(key) === tail) {
          this.tails.delete(key);
        }
      }
    }
  }
}
