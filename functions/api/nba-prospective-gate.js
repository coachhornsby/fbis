import { resolveNbaProspectiveGate } from "../lib/nbaProspectiveGate.js";

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
  if (!env?.DB?.prepare) {
    return json({ ok: false, error: "database unavailable", gate: null }, 503);
  }
  try {
    const gate = await resolveNbaProspectiveGate(env.DB);
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
          ? "Criteria met — set nba_prospective_gate.can_authorize=1 / status after operator approval."
          : `Frozen — ${gate.gaps?.length || 0} criteria remaining (see gaps).`,
    });
  } catch (err) {
    return json({ ok: false, error: String(err?.message || err), gate: null }, 500);
  }
}
