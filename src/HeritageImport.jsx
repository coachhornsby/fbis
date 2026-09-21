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
  "Upload a bet-slip photo from your phone, or paste ticket text. Heritage / Novig / PrizePicks / FanDuel. Preview first — nothing is written until you confirm.";

const MAX_OCR_EDGE = 1800;

export default function HeritageImport({ open, onClose, onImported }) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState(null);
  const [edits, setEdits] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [wroteMessage, setWroteMessage] = useState("");
  const [ocrMessage, setOcrMessage] = useState("");
  const [bookHint, setBookHint] = useState("");
  const [photoPreview, setPhotoPreview] = useState("");
  const [photoName, setPhotoName] = useState("");
  const feedbackRef = useRef(null);
  const modalRef = useRef(null);
  const closeBtnRef = useRef(null);
  const restoreFocusRef = useRef(null);
  const libraryInputRef = useRef(null);
  const cameraInputRef = useRef(null);

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
        body: JSON.stringify({ action: "parse", text, bookHint }),
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

  async function readScreenshot(file, inputEl) {
    if (!file) return;
    if (!String(file.type || "").startsWith("image/") && !/\.(jpe?g|png|webp|heic|heif|gif)$/i.test(file.name || "")) {
      setError("Choose a photo or screenshot of the bet slip (JPG, PNG, or HEIC).");
      if (inputEl) inputEl.value = "";
      return;
    }
    setBusy(true);
    setError("");
    setPreview(null);
    setWroteMessage("");
    setPhotoName(file.name || "phone-photo");
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    const objectUrl = URL.createObjectURL(file);
    setPhotoPreview(objectUrl);
    setOcrMessage("Reading photo on this device — it is not uploaded to the server…");
    try {
      const ocrSource = await prepareImageForOcr(file);
      const { createWorker, PSM } = await import("tesseract.js");
      const worker = await createWorker("eng");
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
      const result = await worker.recognize(ocrSource);
      await worker.terminate();
      const extracted = String(result?.data?.text || "").trim();
      if (!extracted) {
        throw new Error("No readable ticket text was found. Try a sharper photo of the slip, or paste the text.");
      }
      setText(extracted);
      if (/prize\s*picks|power\s*play|\bMore\b|\bLess\b|↑|↓/i.test(extracted) && /\$\s*\d+.*win|pick/i.test(extracted)) {
        setBookHint("PrizePicks");
      } else if (/novig|to\s*pay|strikeouts?\s+thrown/i.test(extracted)) {
        setBookHint("NoVig");
      } else if (/fan\s*duel|same game parlay|potential payout|bet id/i.test(extracted)) {
        setBookHint("FanDuel");
      } else {
        setBookHint("");
      }
      setOcrMessage("Photo read on this device. Review the text, then parse and confirm.");
    } catch (err) {
      setError(String(err.message || err));
      setOcrMessage("");
    } finally {
      if (inputEl) inputEl.value = "";
      setBusy(false);
    }
  }

  function clearPhoto() {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoPreview("");
    setPhotoName("");
    setOcrMessage("");
  }

  async function confirmImport() {
    if (stale) {
      setError(PASTE_CHANGED);
      setWroteMessage("");
      queueMicrotask(() => feedbackRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
      return;
    }
    const req = buildConfirmRequest({ text, tickets, edits, bookHint });
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
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Import bet slip">
      <div className="modal-card" ref={modalRef}>
        <div className="panel-header">
          <h2>IMPORT BET SLIP</h2>
          <button ref={closeBtnRef} type="button" className="header-btn" onClick={onClose}>Close</button>
        </div>
        <div className="panel-body">
          <p className="muted">{FIXTURE_HINT} Actual wagers are separate from CONVICTION and FBIS-HC-v1 unless a frozen pre-execution recommendation matches.</p>
          <div className="slip-photo-actions" role="group" aria-label="Import bet slip photo">
            <label className="header-btn header-btn-refresh slip-upload slip-upload-primary">
              {busy && ocrMessage ? "Reading photo…" : "Upload photo from phone"}
              <input
                ref={libraryInputRef}
                type="file"
                accept="image/*,.heic,.heif"
                disabled={busy}
                onChange={(e) => readScreenshot(e.target.files?.[0], e.target)}
              />
            </label>
            <label className="header-btn slip-upload">
              {busy && ocrMessage ? "Reading…" : "Take photo"}
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                disabled={busy}
                onChange={(e) => readScreenshot(e.target.files?.[0], e.target)}
              />
            </label>
          </div>
          <p className="muted slip-photo-hint">
            On your phone: tap <b>Upload photo from phone</b>, then choose the PrizePicks screenshot from Photos. OCR runs on-device — the image is not sent to the server.
          </p>
          {photoPreview && (
            <div className="slip-photo-preview">
              <img src={photoPreview} alt="Selected bet slip photo" />
              <div className="slip-photo-meta">
                <span className="muted">{photoName}</span>
                <button type="button" className="header-btn" disabled={busy} onClick={clearPhoto}>
                  Clear photo
                </button>
              </div>
            </div>
          )}
          {ocrMessage && <p className="muted" role="status">{ocrMessage}</p>}
          <textarea
            className="slip-paste"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              if (error) setError("");
              if (wroteMessage) setWroteMessage("");
            }}
            placeholder="Or paste Heritage / Novig / PrizePicks / FanDuel text here after uploading a photo."
            rows={10}
          />
          <div className="today-controls" style={{ marginTop: 10 }}>
            <label className="muted" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              Book
              <select
                aria-label="Book hint"
                value={bookHint}
                disabled={busy}
                onChange={(e) => setBookHint(e.target.value)}
              >
                <option value="">Auto-detect</option>
                <option value="Heritage">Heritage</option>
                <option value="NoVig">NoVig</option>
                <option value="PrizePicks">PrizePicks</option>
                <option value="FanDuel">FanDuel</option>
              </select>
            </label>
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
                {(preview.props > 0 || preview.entryType) && (
                  <Stat label="Props" value={preview.props ?? 0} />
                )}
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
                            <div className="muted">{t.date}</div>
                            <input
                              type="datetime-local"
                              aria-label="Bet placement time"
                              value={localDateTimeValue(e.executedAt)}
                              onChange={(ev) => patch(i, "executedAt", localDateTimeIso(ev.target.value))}
                            />
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
                            {t.market === "PLAYER_PROP" ? (
                              <>
                                <input
                                  value={e.selectedTeam || ""}
                                  placeholder="player"
                                  aria-label="Player name"
                                  onChange={(ev) => patch(i, "selectedTeam", ev.target.value)}
                                />
                                <input
                                  value={e.selectedSide || ""}
                                  placeholder="OVER or UNDER"
                                  aria-label="Over or Under"
                                  onChange={(ev) => patch(i, "selectedSide", ev.target.value.toUpperCase())}
                                />
                                <div className="muted">{t.propType || t.propLabel || "prop"}</div>
                              </>
                            ) : isTotalMarket(t.market) ? (
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
    executedAt: t.executedAt || "",
  };
}

function localDateTimeValue(value) {
  if (!value) return "";
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

function localDateTimeIso(value) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : "";
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

/** Downscale phone photos before OCR so Tesseract stays responsive on mobile. */
async function prepareImageForOcr(file) {
  if (typeof createImageBitmap !== "function" && typeof Image === "undefined") return file;
  try {
    let bitmap = null;
    if (typeof createImageBitmap === "function") {
      try {
        bitmap = await createImageBitmap(file);
      } catch {
        bitmap = null;
      }
    }
    if (!bitmap) {
      bitmap = await loadImageElement(file);
    }
    const w = bitmap.width || bitmap.naturalWidth || 0;
    const h = bitmap.height || bitmap.naturalHeight || 0;
    if (!(w > 0 && h > 0)) return file;
    const scale = Math.min(1, MAX_OCR_EDGE / Math.max(w, h));
    const tw = Math.max(1, Math.round(w * scale));
    const th = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement("canvas");
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return file;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, tw, th);
    ctx.drawImage(bitmap, 0, 0, tw, th);
    if (typeof bitmap.close === "function") bitmap.close();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
    return blob || file;
  } catch {
    return file;
  }
}

function loadImageElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not decode photo"));
    };
    img.src = url;
  });
}
