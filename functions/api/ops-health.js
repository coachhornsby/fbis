import { loadOpsControlPlane } from "../lib/opsHealthLedger.js";

export async function onRequestGet(context) {
  try {
    const controlPlane = await loadOpsControlPlane(context.env);
    return json({ ok: true, generatedAt: new Date().toISOString(), ...controlPlane }, 200);
  } catch (err) {
    return json({ ok: false, generatedAt: new Date().toISOString(), error: String(err?.message || err) }, 500);
  }
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=30",
      "access-control-allow-origin": "*",
    },
  });
}
