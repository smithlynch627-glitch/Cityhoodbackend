/**
 * In-memory TTL cache with LRU eviction and single-flight loading.
 *
 * Single-flight matters under load: when 2,000 browsers ask for the same thing in the same second (sale stats,
 * a land image, the gate status), the first request starts the work and every other request waits for that same
 * promise instead of hitting the chain, the database or the image renderer again.
 */
export class TtlCache<T> {
  private map = new Map<string, { at: number; value: Promise<T> }>();
  constructor(private readonly max: number) {}

  get(key: string, ttlMs: number, load: () => Promise<T> | T): Promise<T> {
    const hit = this.map.get(key);
    if (hit && Date.now() - hit.at < ttlMs) {
      // refresh its place so the most used entries stay
      this.map.delete(key);
      this.map.set(key, hit);
      return hit.value;
    }
    const value = Promise.resolve().then(load);
    const entry = { at: Date.now(), value };
    this.map.set(key, entry);
    // failures are never cached: the next request tries again
    value.catch(() => {
      if (this.map.get(key) === entry) this.map.delete(key);
    });
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value!);
    return value;
  }

  delete(key: string) {
    this.map.delete(key);
  }

  deletePrefix(prefix: string) {
    for (const k of [...this.map.keys()]) if (k.startsWith(prefix)) this.map.delete(k);
  }

  clear() {
    this.map.clear();
  }

  get size() {
    return this.map.size;
  }
}
