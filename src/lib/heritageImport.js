/**
 * Heritage slip confirm-write UX helpers.
 * Secret is never bundled — the operator pastes HARVEST_SECRET at confirm time.
 */

export const OPERATOR_SECRET_REQUIRED = "Operator secret required";
export const OPERATOR_SECRET_HINT =
  "Paste HARVEST_SECRET (same as collect). Not stored in the app bundle.";

export function confirmWriteGuard({ secret, ticketCount }) {
  if (!ticketCount) return { ok: false, error: "No tickets to import — parse first" };
  if (!String(secret || "").trim()) return { ok: false, error: OPERATOR_SECRET_REQUIRED };
  return { ok: true };
}

export function importResponseFeedback(status, data) {
  if (status === 401) {
    return { ok: false, error: "401 unauthorized — paste HARVEST_SECRET into Operator secret" };
  }
  const err = data?.error ? String(data.error) : "";
  if (status === 503 || /D1 unbound/i.test(err)) {
    return { ok: false, error: err || "D1 unbound" };
  }
  if (err && !(data?.accepted || []).length) {
    return { ok: false, error: err };
  }
  if (status >= 400 && !(data?.accepted || []).length) {
    return { ok: false, error: err || `HTTP ${status}` };
  }
  const n = (data?.accepted || []).length;
  return {
    ok: true,
    message: `Wrote ${n} ticket${n === 1 ? "" : "s"} · skipped ${(data?.skipped || []).length} · conflicts ${(data?.conflicts || []).length}`,
  };
}

export async function readResponseJson(res) {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`HTTP ${res.status}${text ? `: ${text.slice(0, 160)}` : ""}`);
  }
}
