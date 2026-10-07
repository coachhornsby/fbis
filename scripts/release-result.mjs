import { readdir, mkdir, writeFile, appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export function classifyRelease({ validation, deployment, intendedSha, productionSha, checks, failedSteps = [], errors = [] }) {
  const reasons = [];
  if (!/^[a-f0-9]{40}$/i.test(String(intendedSha || ''))) reasons.push('INVALID_RELEASE_SHA');
  if (validation !== 'success') reasons.push(`VALIDATION_${String(validation).toUpperCase()}`);
  if (deployment !== 'success') reasons.push(`DEPLOYMENT_${String(deployment).toUpperCase()}`);
  if (productionSha !== intendedSha) reasons.push('PRODUCTION_SHA_MISMATCH');
  for (const [name, passed] of Object.entries(checks)) if (passed !== true) reasons.push(`CHECK_FAILED:${name}`);
  reasons.push(...failedSteps.map((s) => `FAILED_STEP:${s}`), ...errors);
  return { state: reasons.length ? 'BLOCKED' : 'VERIFIED_PRODUCTION', reasons };
}

export async function collectReleaseResult(env = process.env, fetcher = fetch) {
  const errors = [];
  async function json(url, options = {}) {
    try {
      const r = await fetcher(url, { ...options, signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error(`HTTP_${r.status}`);
      return await r.json();
    } catch (e) { errors.push(`READ_FAILED:${new URL(url).pathname}:${e.name || 'Error'}`); return null; }
  }
  const gh = { headers: { authorization: `Bearer ${env.GH_TOKEN}`, accept: 'application/vnd.github+json' } };
  const api = `https://api.github.com/repos/${env.GITHUB_REPOSITORY}`;
  const cf = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}`;
  const cfOptions = { headers: { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` } };
  const base = 'https://fbis-myz.pages.dev';
  const [main, jobs, project, health, ui, mlb, published] = await Promise.all([
    json(`${api}/commits/main`, gh),
    json(`${api}/actions/runs/${env.GITHUB_RUN_ID}/jobs?per_page=100`, gh),
    json(`${cf}/pages/projects/fbis`, cfOptions),
    json(`${base}/api/health?_t=${Date.now()}`),
    (async () => { try { const r = await fetcher(base, { signal: AbortSignal.timeout(30000) }); return r.ok && (await r.text()).includes('<div id="root"'); } catch { return false; } })(),
    json(`${base}/api/projections?sport=mlb&_t=${Date.now()}`),
    json(`${base}/api/published-projections?_t=${Date.now()}`),
  ]);
  const canonical = project?.result?.canonical_deployment;
  const productionSha = canonical?.deployment_trigger?.metadata?.commit_hash || null;
  const migrationFiles = (await readdir(new URL('../migrations/', import.meta.url))).filter((f) => f.endsWith('.sql')).sort();
  const latestMigration = migrationFiles.at(-1);
  const databaseId = project?.result?.deployment_configs?.production?.d1_databases?.DB?.id;
  let migration = null;
  if (databaseId) {
    migration = await json(`${cf}/d1/database/${databaseId}/query`, {
      ...cfOptions, method: 'POST', headers: { ...cfOptions.headers, 'content-type': 'application/json' },
      body: JSON.stringify({ sql: 'SELECT json_group_array(name) AS ledgerNames, EXISTS (SELECT 1 FROM schema_migrations WHERE id = ?) AS tipRegistered FROM d1_migrations;', params: [latestMigration.replace(/\.sql$/, '')] }),
    });
  }
  const failedSteps = (jobs?.jobs || []).flatMap((j) => (j.steps || []).filter((s) => s.conclusion === 'failure').map((s) => `${j.name}/${s.name}`));
  const ledger = migration?.result?.[0]?.results?.[0];
  let appliedNames = [];
  try { appliedNames = JSON.parse(ledger?.ledgerNames || '[]'); } catch { errors.push('INVALID_MIGRATION_LEDGER'); }
  const missingMigrations = migrationFiles.filter((name) => !appliedNames.includes(name));
  const checks = {
    cloudflare: project?.success === true && canonical?.latest_stage?.status === 'success',
    runtimeSha: health?.deploymentCommit === env.GITHUB_SHA,
    d1: health?.d1?.bound === true && health?.d1?.readOk === true,
    migrations: migration?.success === true && migration.result?.[0]?.success === true && missingMigrations.length === 0 && ledger?.tipRegistered === 1,
    healthState: health?.state === 'HEALTHY',
    ui: ui === true, mlbApi: mlb !== null, publishedApi: published !== null,
  };
  const classified = classifyRelease({ validation: env.VALIDATION_RESULT, deployment: env.DEPLOYMENT_RESULT, intendedSha: env.GITHUB_SHA, productionSha, checks, failedSteps, errors });
  return {
    recordedAt: new Date().toISOString(), mainSha: main?.sha || null, ciSha: env.GITHUB_SHA,
    ciStatus: env.VALIDATION_RESULT, deploymentSha: productionSha,
    deploymentStatus: canonical?.latest_stage?.status || null, deploymentJobStatus: env.DEPLOYMENT_RESULT,
    deploymentId: canonical?.id || null, productionSha, runtimeSha: health?.deploymentCommit || null,
    productionHealthState: health?.state || null, healthFailures: (health?.failures || []).map((f) => f.name), latestMigration, missingMigrations, checks,
    runUrl: `https://github.com/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`,
    mainAdvanced: Boolean(main?.sha && main.sha !== env.GITHUB_SHA), ...classified,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await collectReleaseResult();
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/release-result.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `## Release result\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\`\n`);
}
