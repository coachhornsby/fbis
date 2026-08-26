/** Shared memory + Cloudflare Cache API, keyed so stale odds die on version bumps. */

const mem = new Map();

export async function readCache(key, cfCache, ttlMs) {
  const hit = mem.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.data;
  if (cfCache) {
    try {
      const res = await cfCache.match(new Request(`https://fbis.internal/${key}`));
      if (res) {
        const data = await res.json();
        mem.set(key, { at: Date.now(), data });
        return data;
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

export async function writeCache(key, data, cfCache, ttlMs) {
  mem.set(key, { at: Date.now(), data });
  if (cfCache) {
    try {
      await cfCache.put(
        new Request(`https://fbis.internal/${key}`),
        new Response(JSON.stringify(data), {
          headers: {
            "content-type": "application/json",
            "cache-control": `max-age=${Math.max(1, Math.floor(ttlMs / 1000))}`,
          },
        })
      );
    } catch {
      /* ignore */
    }
  }
}
