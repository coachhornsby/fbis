/**
 * Heritage slip confirm-write UX helpers.
 * Secret is never bundled — the operator pastes HARVEST_SECRET at confirm time.
 */

export const OPERATOR_SECRET_REQUIRED = "Operator secret required";
export const NO_TICKETS_TO_WRITE = "No tickets to write";
export const HARVEST_SECRET_PLACEHOLDER = "not stored in the app bundle";
export const OPERATOR_SECRET_HINT =
  "Paste HARVEST_SECRET (same as collect). Not stored in the app bundle.";
export const PLACEHOLDER_AS_SECRET =
  "That text is a hint, not the secret. Paste HARVEST_SECRET from Cloudflare Pages (same as collect).";

export function isHintSecret(secret) {
  const s = String(secret || "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!s) return false;
  const placeholder = HARVEST_SECRET_PLACEHOLDER.toLowerCase();
  const hint = OPERATOR_SECRET_HINT.toLowerCase();
  return s === placeholder || s === `${placeholder}.` || s === hint;
}

/** Placeholder/hint paste is treated as empty — never sent as the write key. */
export function normalizePastedSecret(secret) {
  const s = String(secret || "").trim();
  if (!s || isHintSecret(s)) return "";
  return s;
}

export function confirmWriteGuard({ secret, ticketCount, hasText = false }) {
  if (!ticketCount && !hasText) return { ok: false, error: NO_TICKETS_TO_WRITE };
  if (isHintSecret(secret)) return { ok: false, error: PLACEHOLDER_AS_SECRET };
  if (!normalizePastedSecret(secret)) return { ok: false, error: OPERATOR_SECRET_REQUIRED };
  return { ok: true };
}

export function mergeTicketEdits(tickets, edits) {
  return (tickets || []).map((t, i) => ({ ...t, ...(edits?.[i] || {}) }));
}

/** Confirm POST body must include the pasted slip and the preview ticket objects. */
export function buildConfirmRequest({ secret, text, tickets, edits }) {
  const payloadTickets = mergeTicketEdits(tickets, edits);
  const slip = String(text || "");
  const guard = confirmWriteGuard({
    secret,
    ticketCount: payloadTickets.length,
    hasText: Boolean(slip.trim()),
  });
  if (!guard.ok) return { ok: false, error: guard.error };
  const token = normalizePastedSecret(secret);
  return {
    ok: true,
    headers: {
      "content-type": "application/json",
      "x-strategy-secret": token,
      "x-harvest-secret": token,
    },
    body: {
      action: "import",
      text: slip,
      tickets: payloadTickets,
    },
  };
}

export function confirmStatusLine({ busy, error, wroteMessage, secret, ticketCount }) {
  if (busy) return { kind: "writing", text: "Writing…" };
  if (error) return { kind: "error", text: error };
  if (wroteMessage) return { kind: "ok", text: wroteMessage };
  if (!ticketCount) return { kind: "error", text: NO_TICKETS_TO_WRITE };
  if (isHintSecret(secret)) return { kind: "error", text: PLACEHOLDER_AS_SECRET };
  if (!normalizePastedSecret(secret)) return { kind: "error", text: OPERATOR_SECRET_REQUIRED };
  return { kind: "ready", text: `Ready to write ${ticketCount} ticket${ticketCount === 1 ? "" : "s"}` };
}

function acceptedIds(data) {
  return (data?.accepted || []).map((a) => a.externalTicketId || a.id).filter(Boolean);
}

export function importResponseFeedback(status, data) {
  if (status === 401) {
    return { ok: false, error: "401 unauthorized — paste HARVEST_SECRET from Cloudflare Pages (same as collect)" };
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
  const ids = acceptedIds(data);
  const n = ids.length || (data?.accepted || []).length;
  const idPart = ids.length ? `: ${ids.join(", ")}` : "";
  return {
    ok: true,
    message: `Wrote ${n} ticket${n === 1 ? "" : "s"}${idPart} · skipped ${(data?.skipped || []).length} · conflicts ${(data?.conflicts || []).length}`,
    ticketIds: ids,
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
