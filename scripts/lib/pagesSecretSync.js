/**
 * Pure helpers for Cloudflare Pages secret sync from GitHub Actions.
 * Empty values must never invoke `wrangler pages secret put`.
 */

export function shouldPutPagesSecret(value) {
  if (value == null) return false;
  return String(value).trim().length > 0;
}

/**
 * @param {Record<string, string|undefined|null>} secrets
 * @param {(name: string, value: string) => Promise<void>|void} putFn
 */
export async function syncPagesSecretsSkipEmpty(secrets, putFn) {
  const report = { written: [], skipped: [] };
  for (const [name, value] of Object.entries(secrets || {})) {
    if (!shouldPutPagesSecret(value)) {
      report.skipped.push(name);
      continue;
    }
    await putFn(name, String(value));
    report.written.push(name);
  }
  return report;
}
