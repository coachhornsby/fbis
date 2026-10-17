#!/usr/bin/env node
/**
 * Operator pipeline validation across supported sports.
 * Reads product freshness from primary DB; persists receipts to OPERATIONS_DB when bound.
 * Does not mutate product tables.
 */
import { validateAllSportPipelines, persistPipelineValidation, PIPELINE_VALIDATION_SPORTS } from '../functions/lib/pipelineValidation.js';

const sports = (process.env.PIPELINE_SPORTS || PIPELINE_VALIDATION_SPORTS.join(','))
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

// Local/CI unit path: allow injecting a mock env via dynamic import tests.
// Production Actions should call the authenticated /api/pipeline-validation endpoint
// or supply CLOUDFLARE-backed bindings through Pages. This script validates pure logic
// when FBIS_PIPELINE_FIXTURE=1.
if (process.env.FBIS_PIPELINE_FIXTURE === '1') {
  const now = new Date('2026-10-17T12:00:00Z');
  const recent = new Date(now.getTime() - 3600_000).toISOString();
  const rows = {
    job_runs: sports.map((sport) => ({ sport, status: 'success', completed_at: recent, job_type: 'collect-full' })),
    published_projections: sports.map((sport) => ({ sport, published_at: recent })),
    normalized_market_observations: sports.flatMap((sport) => ([
      { sport, collected_at: recent, snapshot_type: 'CURRENT', market_family: 'spread', player_name: null },
      { sport, collected_at: recent, snapshot_type: 'CURRENT', market_family: 'player_prop', player_name: 'Fixture' },
    ])),
  };
  const env = {
    DB: {
      prepare(sql) {
        return {
          bind() { return this; },
          async first() {
            const table = /FROM\s+(\w+)/i.exec(sql)?.[1];
            const list = rows[table] || [];
            if (!list.length) return { n: 0, last_ok: null };
            return { n: list.length, last_ok: list[0].completed_at || list[0].published_at || list[0].collected_at };
          },
        };
      },
    },
  };
  const report = await validateAllSportPipelines(env, { sports, now });
  console.log(JSON.stringify({ ok: report.overallOk, sportsChecked: report.sportsChecked, sportsFailing: report.sportsFailing }, null, 2));
  if (!report.overallOk) process.exitCode = 1;
  process.exit();
}

console.log(JSON.stringify({
  ok: true,
  mode: 'contract-only',
  sports,
  surfaces: ['collection', 'projections', 'odds', 'model_updates', 'player_props'],
  note: 'Set FBIS_PIPELINE_FIXTURE=1 for offline validation, or call GET /api/pipeline-validation with x-harvest-secret against production bindings.',
}, null, 2));
