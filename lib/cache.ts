// In-memory TTL cache. On Vercel this persists per warm lambda instance,
// which is enough to avoid hammering the BrickLink quota within a session.
// If you later want durable caching, swap these two functions for Upstash Redis.

type Entry = { value: unknown; expires: number };

const globalStore = globalThis as unknown as { __brickscanCache?: Map<string, Entry> };
const store: Map<string, Entry> = globalStore.__brickscanCache ?? new Map();
globalStore.__brickscanCache = store;

export function cacheGet<T>(key: string): T | null {
  const e = store.get(key);
  if (!e) return null;
  if (Date.now() > e.expires) {
    store.delete(key);
    return null;
  }
  return e.value as T;
}

export function cacheSet(key: string, value: unknown, ttlMs: number) {
  if (store.size > 5000) {
    // crude eviction: drop oldest half
    const keys = Array.from(store.keys()).slice(0, 2500);
    keys.forEach((k) => store.delete(k));
  }
  store.set(key, { value, expires: Date.now() + ttlMs });
}
