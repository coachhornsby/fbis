import { formatSpreadLabel } from "../../lib/boardDecision.js";
import { fmtNum } from "../../lib/format.js";

/** Lightweight CSS rail — no chart library. */
export default function DeltaRail({ label, market, fbis, delta, kind = "spread" }) {
  if (market == null || fbis == null || delta == null) return null;
  const m = Number(market);
  const f = Number(fbis);
  const d = Number(delta);
  const lo = Math.min(m, f);
  const hi = Math.max(m, f);
  const span = hi - lo || 1;
  const mPct = ((m - lo) / span) * 100;
  const fPct = ((f - lo) / span) * 100;
  const fmt = (n) => (kind === "spread" ? formatSpreadLabel(n) : fmtNum(n, 1));
  return (
    <div className="delta-rail" aria-label={`${label} delta ${d >= 0 ? "+" : ""}${fmtNum(d, 1)}`}>
      <div className="delta-rail-head">
        <span>{label}</span>
        <strong className={d >= 0 ? "text-green" : "text-red"}>
          {d >= 0 ? "+" : ""}
          {fmtNum(d, 1)}
          {kind === "spread" ? " pts" : ""}
        </strong>
      </div>
      <div className="delta-rail-track">
        <span className="delta-rail-end muted">MKT {fmt(m)}</span>
        <div className="delta-rail-bar" aria-hidden="true">
          <i className="delta-rail-dot mkt" style={{ left: `${mPct}%` }} />
          <i className="delta-rail-dot fbis" style={{ left: `${fPct}%` }} />
        </div>
        <span className="delta-rail-end">FBIS {fmt(f)}</span>
      </div>
    </div>
  );
}
