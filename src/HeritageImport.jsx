import { useEffect, useRef, useState } from "react";
import { fmtAmerican, formatMarketPeriod, formatClv } from "./lib/format.js";
import { TicketMatchup } from "./components/TeamLogo.jsx";
import {
  PASTE_CHANGED,
  buildConfirmRequest,
  confirmStatusLine,
  importResponseFeedback,
  isTotalMarket,
  previewIsStale,
  readResponseJson,
} from "./lib/heritageImport.js";

const FIXTURE_HINT =
  "Paste one or more Heritage tickets. Preview first — nothing is written until you confirm.";

export default function HeritageImport({ open, onClose, onImported }) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState(null);
  const [edits, setEdits] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [wroteMessage, setWroteMessage] = useState("");
  const feedbackRef = useRef(null);
  const modalRef = useRef(null);
  const closeBtnRef = useRef(null);
  const restoreFocusRef = useRef(null);

  const tickets = preview?.tickets || [];
  const stale = Boolean(preview) && previewIsStale(preview.sourceText, text);
  const status = confirmStatusLine({
    busy,
    error,
    wroteMessage,
    ticketCount: tickets.length,
    stale,
  });

  useEffect(() => {
    if (!open || (status.kind !== "error" && status.kind !== "ok")) return;
    feedbackRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [open, status.kind, status.text]);

  useEffect(() => {
    if (!open) return undefined;
    restoreFocusRef.current = document.activeElement;
    queueMicrotask(() => closeBtnRef.current?.focus());
    function trap(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose?.();
        return;
      }
      if (e.key !== "Tab" || !modalRef.current) return;
      const nodes = [...modalRef.current.querySelectorAll("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])")]
        .filter((el) => !el.disabled && el.offsetParent !== null);
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", trap);
    return () => {
      document.removeEventListener("keydown", trap);
      restoreFocusRef.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  async function parseSlip() {
    setBusy(true);
    setError("");
    setWroteMessage("");
    try {
      const res = await fetch("/api/bets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "parse", text }),
      });
      const data = await readResponseJson(res);
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      setPreview({ ...data, sourceText: text });
      setEdits((data.tickets || []).map(ticketEdit));
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setBusy(false);
    }
  }

  async function confirmImport() {
    if (stale) {
      setError(PASTE_CHANGED);
      setWroteMessage("");
      queueMicrotask(() => feedbackRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
      return;
    }
    const req = buildConfirmRequest({ text, tickets, edits });
    if (!req.ok) {
      setError(req.error);
      setWroteMessage("");
      queueMicrotask(() => feedbackRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
      return;
    }
    setBusy(true);
    setError("");
    setWroteMessage("");
    try {
      const res = await fetch("/api/bets", {
        method: "POST",
        headers: req.headers,
        body: JSON.stringify(req.body),
      });
      const data = await readResponseJson(res);
      const feedback = importResponseFeedback(res.status, data);
      if (!feedback.ok) throw new Error(feedback.error);
      setWroteMessage(feedback.message);
      onImported?.(data);
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setBusy(false);
    }
  }

  function patch(i, field, value) {
    setEdits((prev) => prev.map((row, idx) => (idx === i ? { ...row, [field]: coerce(field, value) } : row)));
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Import Heritage bet slip">
      <div className="modal-card" ref={modalRef}>
        <div className="panel-header">
          <h2>IMPORT HERITAGE BET SLIP</h2>
          <button ref={closeBtnRef} type="button" className="header-btn" onClick={onClose}>Close</button>
        </div>
        <div className="panel-body">
          <p className="muted">{FIXTURE_HINT} Actual Heritage wagers are not qualified tickets, CONVICTION, FBIS-HC-v1, or the 7–0 seed unless a frozen pre-execution recommendation matches.</p>
          <textarea
            className="slip-paste"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              if (error) setError("");
              if (wroteMessage) setWroteMessage("");
            }}
            placeholder="G10904318 | Aug 27 10:06&#10;Los Angeles Dodgers … vs Atlanta Braves …"
            rows={10}
          />
          <div className="today-controls" style={{ marginTop: 10 }}>
            <button type="button" className="header-btn header-btn-refresh" onClick={parseSlip} disabled={busy || !text.trim()}>
              {busy && !preview ? "Parsing…" : "1 · Parse & preview"}
            </button>
            <span className="muted">Does not write to D1</span>
          </div>
          {error && !preview && <div className="error" style={{ marginTop: 8 }} role="alert">{error}</div>}
          {preview && (
            <>
              {stale && (
                <div className="error" style={{ marginTop: 10 }} role="alert">
                  {PASTE_CHANGED}. This table is from the previous parse.
                </div>
              )}
              <div className="status-grid" style={{ marginTop: 12, opacity: stale ? 0.45 : 1 }}>
                <Stat label="Tickets" value={preview.n ?? tickets.length} />
                <Stat label="Risk" value={money(preview.totalRisk)} />
                <Stat label="To win" value={money(preview.totalToWin)} />
                <Stat label="ML" value={preview.ml ?? 0} />
                <Stat label="RL" value={preview.spread ?? 0} />
                <Stat label="Totals" value={preview.total ?? 0} />
              </div>
              <div className="preview-scroll" style={{ opacity: stale ? 0.45 : 1 }}>
                <table className="fbis-table">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Matchup</th>
                      <th>Market</th>
                      <th>Side / line / price</th>
                      <th>Risk</th>
                      <th>Match</th>
                      <th>Attribution</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tickets.map((t, i) => {
                      const e = edits[i] || ticketEdit(t);
                      const warn = (t.warnings || []).join(" · ");
                      const clvText = formatClv(t.clvPack?.clv, t.clvPack?.clvStatus);
                      return (
                        <tr key={t.externalTicketId || i} className={rowClass(t)}>
                          <td>
                            <div>{t.externalTicketId || "missing ID"}</div>
                            <div className="muted">{t.date} {t.executedAt ? new Date(t.executedAt).toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" }) : ""}</div>
                          </td>
                          <td>
                            <TicketMatchup
                              awayIdentity={t.awayIdentity}
                              homeIdentity={t.homeIdentity}
                              awayTeam={t.awayTeam}
                              homeTeam={t.homeTeam}
                              matchupText={t.matchupText}
                            />
                            {t.matchCandidates?.length > 1 && (
                              <select value={e.gameId || ""} onChange={(ev) => patch(i, "gameId", ev.target.value)}>
                                <option value="">Select game</option>
                                {t.matchCandidates.map((c) => (
                                  <option key={c.id} value={c.id}>{c.away} @ {c.home}</option>
                                ))}
                              </select>
                            )}
                          </td>
                          <td className="nowrap">{formatMarketPeriod(t.market || "unsupported", t.period)}</td>
                          <td>
                            {isTotalMarket(t.market) ? (
                              <input
                                value={e.selectedSide || ""}
                                placeholder="OVER or UNDER"
                                aria-label="Over or Under"
                                onChange={(ev) => patch(i, "selectedSide", ev.target.value.toUpperCase())}
                              />
                            ) : (
                              <input
                                value={e.selectedTeam || ""}
                                placeholder="team"
                                aria-label="Selected team"
                                onChange={(ev) => patch(i, "selectedTeam", ev.target.value)}
                              />
                            )}
                            <div className="muted">
                              line {t.market === "ML" || t.market === "F5 ML" ? "—" : e.executionLine ?? "—"} · {fmtAmerican(e.executionPrice)}
                            </div>
                          </td>
                          <td>
                            ${Number(e.riskAmount || 0).toFixed(2)}
                            <div className="muted">to win ${Number(e.toWinAmount || 0).toFixed(2)}</div>
                          </td>
                          <td>
                            <span className={`status-pill status-${t.matchStatus}`}>{t.matchStatus}</span>
                            <div className="muted">{t.duplicateStatus}</div>
                            {warn ? <div className="warn-text">{warn}</div> : null}
                          </td>
                          <td>
                            <div>{t.attribution?.label || "OPERATOR BET · NOT ATTRIBUTED TO FBIS"}</div>
                            <div className="muted">{clvText === "—" ? "CLV unavailable" : `CLV ${clvText}`}</div>
                            {t.heritageCurrentPrice != null && (
                              <div className="muted">Her current {fmtAmerican(t.heritageCurrentPrice)} (not Pin CLV)</div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="confirm-row">
                <button
                  type="button"
                  className="header-btn header-btn-refresh"
                  disabled={busy || stale}
                  onClick={confirmImport}
                >
                  {busy ? "Writing…" : "2 · Confirm D1 write"}
                </button>
                <div
                  ref={feedbackRef}
                  id="confirm-write-status"
                  className={`confirm-status confirm-status-${status.kind}`}
                  role={status.kind === "error" ? "alert" : "status"}
                  aria-live="assertive"
                >
                  {status.text}
                </div>
              </div>
              <p className="muted" style={{ marginTop: 6 }}>Confirm writes these tickets to D1 from this site.</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ticketEdit(t) {
  return {
    gameId: t.gameId || "",
    selectedTeam: t.selectedTeam || "",
    selectedSide: t.selectedSide || "",
    executionLine: t.executionLine,
    executionPrice: t.executionPrice,
    riskAmount: t.riskAmount,
    toWinAmount: t.toWinAmount,
  };
}

function coerce(field, value) {
  if (["executionLine", "executionPrice", "riskAmount", "toWinAmount"].includes(field)) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return value;
}

function rowClass(t) {
  if (t.duplicateStatus === "conflict" || (t.warnings || []).some((w) => /conflict/i.test(w))) return "lost-row";
  if (t.matchStatus === "unmatched" || t.matchStatus === "ambiguous" || !(t.externalTicketId)) return "warn-row";
  if ((t.warnings || []).length) return "warn-row";
  return "";
}

function money(n) {
  if (n == null) return "—";
  return `$${Number(n).toFixed(2)}`;
}

function Stat({ label, value }) {
  return (
    <div className="status-cell">
      <small>{label}</small>
      <b>{value}</b>
    </div>
  );
}
