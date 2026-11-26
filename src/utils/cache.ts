const CANONICAL_CACHE_ORIGIN = "https://dns-worker.internal";

export const cacheUtils = {
  /**
   * Retained for API compatibility; cache keys always use a fixed canonical origin
   * so untrusted Host headers or concurrent requests cannot partition or race cache buckets.
   */
  setOrigin(_origin: string): void {
    // Intentionally a no-op to prevent Host-header partitioning and async race conditions.
  },

  /**
   * Generates a canonical cache URL using the fixed internal origin.
   *
   * @param key - Cache key identifier.
   * @returns Formatted cache URL under the canonical origin.
   */
  generateCacheUrl(key: string): string {
    return `${CANONICAL_CACHE_ORIGIN}/__cache__/${encodeURIComponent(key)}`;
  },

  async get<T>(cache: Cache | null | undefined, key: string): Promise<T | null> {
    if (!cache) return null;
    const url = this.generateCacheUrl(key);
    const response = await cache.match(url);
    if (!response) return null;
    return response.json();
  },

  async set(cache: Cache | null | undefined, key: string, data: any, ttlSeconds: number, tags: string[] = []): Promise<void> {
    if (!cache) return;
    const url = this.generateCacheUrl(key);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Cache-Control": `public, max-age=${ttlSeconds}`
    };
    if (tags && tags.length > 0) {
      headers["Cache-Tag"] = tags.join(",");
    }
    const response = new Response(JSON.stringify(data), {
      headers
    });
    return cache.put(url, response);
  },

  async delete(cache: Cache | null | undefined, key: string): Promise<boolean> {
    if (!cache) return false;
    const url = this.generateCacheUrl(key);
    return cache.delete(url);
  },

  /**
   * 速率限制检查 (滑动窗口)
   */
  async isRateLimited(cache: Cache | null | undefined, key: string, limit: number, windowSec: number): Promise<boolean> {
    if (!cache) return false;
    const cacheKey = `ratelimit:${key}`;
    const current = await this.get<{ count: number, reset: number }>(cache, cacheKey);
    
    const now = Math.floor(Date.now() / 1000);
    if (!current || now > current.reset) {
      await this.set(cache, cacheKey, { count: 1, reset: now + windowSec }, windowSec);
      return false;
    }

    if (current.count >= limit) return true;

    await this.set(cache, cacheKey, { count: current.count + 1, reset: current.reset }, Math.max(1, current.reset - now));
    return false;
  }
};
