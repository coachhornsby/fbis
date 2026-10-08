import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, mkdtemp, mkdir, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { classifyRelease, collectReleaseResult } from '../scripts/release-result.mjs';

const sha = 'a'.repeat(40);
const good = { validation: 'success', deployment: 'success', intendedSha: sha, productionSha: sha, checks: { cloudflare: true, runtimeSha: true, d1: true, migrations: true, ui: true } };
test('release requires every gate and exact SHA', () => {
  assert.equal(classifyRelease(good).state, 'VERIFIED_PRODUCTION');
  for (const change of [{ validation: 'failure' }, { deployment: 'failure' }, { deployment: 'skipped' }, { productionSha: 'b'.repeat(40) }, { checks: { migrations: false } }, { checks: { d1: false } }, { checks: { runtimeSha: false } }, { failedSteps: ['Apply additive D1 migrations'] }, { errors: ['READ_FAILED'] }]) {
    assert.equal(classifyRelease({ ...good, ...change }).state, 'BLOCKED');
  }
});

test('main advancing never changes the validated release SHA', async () => {
  const migrationNames = (await readdir(new URL('../migrations/', import.meta.url))).filter((f) => f.endsWith('.sql'));
  const result = await collectReleaseResult({ GITHUB_SHA: sha, GITHUB_REPOSITORY: 'owner/repo', GITHUB_RUN_ID: '123', VALIDATION_RESULT: 'success', DEPLOYMENT_RESULT: 'success', CLOUDFLARE_ACCOUNT_ID: 'account' }, async (url, options) => {
    let body = {};
    if (url.includes('/commits/main')) body = { sha: 'b'.repeat(40) };
    else if (url.includes('/jobs?')) body = { jobs: [] };
    else if (url.includes('/pages/projects/')) body = { success: true, result: { canonical_deployment: { id: 'deployment', latest_stage: { status: 'success' }, deployment_trigger: { metadata: { commit_hash: sha } } }, deployment_configs: { production: { d1_databases: { DB: { id: 'database' } } } } } };
    else if (url.includes('/query')) {
      assert.match(JSON.parse(options.body).sql, /schema_migrations.*d1_migrations/);
      body = { success: true, result: [{ success: true, results: [{ ledgerNames: JSON.stringify(migrationNames), tipRegistered: 1 }] }] };
    } else if (url.includes('/api/health')) body = { deploymentCommit: sha, d1: { bound: true, readOk: true }, state: 'HEALTHY' };
    return { ok: true, json: async () => body, text: async () => '<div id="root"></div>' };
  });
  assert.equal(result.state, 'VERIFIED_PRODUCTION');
  assert.equal(result.mainAdvanced, true);
  assert.equal(result.ciSha, sha);
});

test('PR, main and manual triggers use one isolated production authority', async () => {
  const ci = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const manual = await readFile(new URL('../.github/workflows/deploy-pages.yml', import.meta.url), 'utf8');
  const triggers = ci.slice(ci.indexOf('\non:'), ci.indexOf('\npermissions:'));
  assert.match(triggers, /pull_request:/);
  assert.match(triggers, /push:\s+branches: \[main\]/);
  assert.match(triggers, /workflow_dispatch:/);
  assert.doesNotMatch(triggers, /paths|schedule:/);
  assert.match(ci, /needs: test-build/);
  assert.match(ci, /ref: \$\{\{ env.DEPLOY_SHA \}\}/);
  assert.match(ci, /--commit-hash "\$\{DEPLOY_SHA\}"/);
  assert.match(ci, /group: deploy-pages-production\s+cancel-in-progress: false/);
  assert.match(ci, /group: ci-\$\{\{ github.workflow \}\}-\$\{\{ github.ref \}\}/);
  assert.match(ci, /needs: \[test-build, deploy-production\]/);
  assert.match(manual, /gh workflow run ci.yml --ref main/);
  assert.doesNotMatch(manual, /wrangler|pages deploy/);
});

test('migration gate rejects invalid ledger columns before deployment', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fbis-ledger-'));
  try {
    await mkdir(join(root, 'scripts'));
    await mkdir(join(root, 'migrations'));
    await mkdir(join(root, 'functions/lib'), { recursive: true });
    await copyFile(new URL('../scripts/verify-migrations.mjs', import.meta.url), join(root, 'scripts/verify-migrations.mjs'));
    // Tip declaration must accompany the verifier (CI drift guard import).
    await writeFile(
      join(root, 'functions/lib/migrationTip.js'),
      [
        'export const EXPECTED_MIGRATION_FILE = "0001_fixture.sql";',
        'export const EXPECTED_MIGRATION_ID = "0001_fixture";',
        '',
      ].join('\n')
    );
    await writeFile(join(root, 'schema.sql'), 'CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT, applied_at TEXT);');
    for (const column of ['version', 'id']) {
      await writeFile(join(root, 'migrations/0001_fixture.sql'), `INSERT OR IGNORE INTO schema_migrations(${column}, applied_at) VALUES ('0001_fixture', datetime('now'));`);
      const r = spawnSync(process.execPath, [join(root, 'scripts/verify-migrations.mjs')], { encoding: 'utf8' });
      assert.equal(r.status, column === 'id' ? 0 : 1, r.stderr || r.stdout);
      if (column === 'version') assert.match(r.stderr, /ledger columns/);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
