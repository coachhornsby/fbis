/**
 * Heritage slip confirm-write UX helpers.
 * Confirm from the operator board is same-origin — HARVEST_SECRET is not pasted in the app.
 */

import { packExecutedBetRow } from "../../functions/lib/executedBets.js";

export const NO_TICKETS_TO_WRITE = "No tickets to write";
export const PASTE_CHANGED = "Paste changed — parse again before writing";
export const CLOUDFLARE_HTML_503 =
  "Cloudflare killed the import worker (HTTP 503). Retry parse/confirm — this is not a secret error.";

export function isTotalMarket(market) {
  return /TOTAL/i.test(String(market || ""));
}

export function previewIsStale(sourceText, currentText) {
  return String(sourceText ?? "") !== String(currentText ?? "");
}

export function confirmWriteGuard({ ticketCount, hasText = false }) {
  if (!ticketCount && !hasText) return { ok: false, error: NO_TICKETS_TO_WRITE };
  return { ok: true };
}

export function mergeTicketEdits(tickets, edits) {
  return (tickets || []).map((t, i) => ({ ...t, ...(edits?.[i] || {}) }));
}

/** Confirm POST body must include the pasted slip and the preview ticket objects. */
export function buildConfirmRequest({ text, tickets, edits, bookHint = "" }) {
  const payloadTickets = mergeTicketEdits(tickets, edits);
  const slip = String(text || "");
  const guard = confirmWriteGuard({
    ticketCount: payloadTickets.length,
    hasText: Boolean(slip.trim()),
  });
  if (!guard.ok) return { ok: false, error: guard.error };
  return {
    ok: true,
    headers: { "content-type": "application/json" },
    body: {
      action: "import",
      text: slip,
      bookHint,
      tickets: payloadTickets.map((t) => packExecutedBetRow(t)),
    },
  };
}

export function confirmStatusLine({ busy, error, wroteMessage, ticketCount, stale = false }) {
  if (busy) return { kind: "writing", text: "Writing…" };
  if (error) return { kind: "error", text: error };
  if (wroteMessage) return { kind: "ok", text: wroteMessage };
  if (stale) return { kind: "error", text: PASTE_CHANGED };
  if (!ticketCount) return { kind: "error", text: NO_TICKETS_TO_WRITE };
  return { kind: "ready", text: `Ready to write ${ticketCount} ticket${ticketCount === 1 ? "" : "s"}` };
}

function acceptedIds(data) {
  return (data?.accepted || []).map((a) => a.externalTicketId || a.id).filter(Boolean);
}

export function importResponseFeedback(status, data) {
  if (status === 401) {
    return { ok: false, error: "401 unauthorized — open FBIS on this site and confirm again" };
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

export function explainNonJsonHttp(status, text) {
  const t = String(text || "");
  if (/<!DOCTYPE html>/i.test(t) || /<html[\s>]/i.test(t)) {
    if (status === 503 || /1102|cpu time|overloaded/i.test(t)) return CLOUDFLARE_HTML_503;
    return `Import endpoint returned HTML instead of JSON (HTTP ${status}). Retry.`;
  }
  return `HTTP ${status}${t ? `: ${t.slice(0, 160)}` : ""}`;
}

export async function readResponseJson(res) {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(explainNonJsonHttp(res.status, text));
  }
}
