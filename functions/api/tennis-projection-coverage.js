import { authorizeHarvest, unauthorizedBody } from '../lib/auth.js';
import { inspectTennisProjectionCoverage, publicTennisCoverage, runTennisProjectionPipeline } from '../lib/tennisProjectionPipeline.js';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
export async function onRequestGet({ env }) {
  if (!env.DB) return json({ ok: false, reason: 'DB_REQUIRED' }, 503);
  try { return json({ ok: true, ...publicTennisCoverage(await inspectTennisProjectionCoverage(env.DB)) }); }
  catch { return json({ ok: false, reason: 'COVERAGE_EVIDENCE_UNAVAILABLE' }, 503); }
}
export async function onRequestPost({ request, env }) {
  const auth = authorizeHarvest(request, env);
  if (!auth.ok) return json(unauthorizedBody(auth.reason), 403);
  if (!env.DB) return json({ ok: false, reason: 'DB_REQUIRED' }, 503);
  try { return json({ ok: true, ...await runTennisProjectionPipeline(env.DB) }); }
  catch { return json({ ok: false, reason: 'INFERENCE_PIPELINE_FAILED' }, 503); }
}
