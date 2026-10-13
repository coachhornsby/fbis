/**
 * Refresh GitHub Actions OIDC credentials during long-running governed harvests.
 * The one-time workflow-step token can expire before later provider slots run.
 * Fail closed before a chargeable upstream request if refresh is unavailable.
 */
export function createGitHubOidcProvider({
  env = process.env,
  fetchImpl = fetch,
  now = () => Date.now(),
  reuseMs = 90_000,
} = {}) {
  let cachedToken = null;
  let issuedAt = Number.NEGATIVE_INFINITY;
  return async function getOidcToken() {
    if (cachedToken && now() >= issuedAt && now() - issuedAt < reuseMs) return cachedToken;
    const requestUrl = env.ACTIONS_ID_TOKEN_REQUEST_URL;
    const requestToken = env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
    if (!requestUrl || !requestToken) throw new Error('GITHUB_OIDC_REFRESH_UNAVAILABLE');
    const url = new URL(requestUrl);
    url.searchParams.set('audience', 'sports-projection-orchestrator');
    const response = await fetchImpl(url.toString(), {
      headers: { authorization: `bearer ${requestToken}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`GITHUB_OIDC_REFRESH_HTTP_${response.status}`);
    const payload = await response.json();
    if (typeof payload?.value !== 'string' || !payload.value.trim()) {
      throw new Error('GITHUB_OIDC_REFRESH_EMPTY');
    }
    cachedToken = payload.value;
    issuedAt = now();
    return cachedToken;
  };
}
