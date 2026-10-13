import test from 'node:test';
import assert from 'node:assert/strict';
import {createGitHubOidcProvider} from '../scripts/github-oidc.mjs';

test('OIDC token refreshes across a long capture without reusing the workflow-step token', async () => {
  let clock = 1_000_000, calls = 0;
  const get = createGitHubOidcProvider({
    env: {
      ACTIONS_ID_TOKEN_REQUEST_URL: 'https://token.actions.example/token?existing=1',
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'github-request-credential',
      OIDC_TOKEN: 'stale-workflow-token',
    },
    now: () => clock,
    fetchImpl: async (url, options) => {
      assert.equal(new URL(url).searchParams.get('audience'), 'sports-projection-orchestrator');
      assert.equal(new URL(url).searchParams.get('existing'), '1');
      assert.equal(options.headers.authorization, 'bearer github-request-credential');
      calls++;
      return new Response(JSON.stringify({value: `fresh-token-${calls}`}));
    },
  });
  assert.equal(await get(), 'fresh-token-1');
  clock += 89_000;
  assert.equal(await get(), 'fresh-token-1');
  clock += 2_000;
  assert.equal(await get(), 'fresh-token-2');
  clock += 20 * 60_000;
  assert.equal(await get(), 'fresh-token-3');
  assert.equal(calls, 3);
});

test('missing OIDC refresh credentials fail closed before collector requests', async () => {
  let calls = 0;
  const get = createGitHubOidcProvider({
    env: {OIDC_TOKEN: 'expired-token'},
    fetchImpl: async () => {calls++; throw new Error('unexpected fetch');},
  });
  await assert.rejects(get(), /GITHUB_OIDC_REFRESH_UNAVAILABLE/);
  assert.equal(calls, 0);
});

test('OIDC service failure and empty tokens fail closed', async () => {
  const env = {ACTIONS_ID_TOKEN_REQUEST_URL: 'https://token.actions.example', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'credential'};
  await assert.rejects(createGitHubOidcProvider({env, fetchImpl: async () => new Response('{}', {status: 401})})(), /GITHUB_OIDC_REFRESH_HTTP_401/);
  await assert.rejects(createGitHubOidcProvider({env, fetchImpl: async () => new Response('{}')})(), /GITHUB_OIDC_REFRESH_EMPTY/);
});
