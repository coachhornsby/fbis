import { resolveNbaProspectiveGate } from "../lib/nbaProspectiveGate.js";
import { resolveNbaResearchOwnerDb } from "../lib/nbaResearchOwnerDb.js";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    },
  });
}

/** GET /api/nba-prospective-gate — unfreeze criteria progress (read-only). */
export async function onRequestGet({ env }) {
  const owner = await resolveNbaResearchOwnerDb(env);
  if (!owner.ok) {
    return json({ ok: false, error: owner.reason, gate: null }, 503);
  }
  try {
    const gate = await resolveNbaProspectiveGate(owner.db);
    return json({
      ok: true,
      gate,
      unfreezeChecklist: (gate.criteria || []).map((c) => ({
        id: c.id,
        label: c.label,
        passed: c.passed,
        current: c.current,
        required: c.required,
      })),
      nextStep: gate.canAuthorize
        ? "Gate authorized — board may set canAuthorizeWager when projection rows allow."
        : gate.criteriaReady
          ? "Criteria met with prospective evidence — operator may set can_authorize=1. Flag alone never launches."
          : `Frozen — ${gate.gaps?.length || 0} criteria remaining. Displaying research projections/injuries/props does not require unfreeze.`,
    });
  } catch (err) {
    return json({ ok: false, error: String(err?.message || err), gate: null }, 500);
  }
}
