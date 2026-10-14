import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
import { buildTennisIntelligenceBank } from "../lib/tennisIntelligenceBank.js";
export { buildTennisIntelligenceBank } from "../lib/tennisIntelligenceBank.js";
const json = (body, status = 200) => new Response(JSON.stringify(body), { status,
  headers: { "content-type": "application/json", "cache-control": "no-store" } });
export async function onRequestGet({ request, env }) {
  const auth = authorizeHarvest(request, env);
  if (!auth.ok) return json(unauthorizedBody(auth.reason), 403);
  if (!env?.DB) return json({ ok: false, error: "DB_REQUIRED" }, 503);
  try { return json(await buildTennisIntelligenceBank(env.DB, { limit: new URL(request.url).searchParams.get("limit") })); }
  catch (error) { return json({ ok: false, error: String(error?.message || error).slice(0, 160) }, 503); }
}
