import { useEffect, useMemo, useState } from "react";

const WINDOWS = [
  ["7", "7d"],
  ["14", "14d"],
  ["30", "30d"],
  ["60", "60d"],
  ["season", "Season"],
];

function pct(value) {
  return Number.isFinite(Number(value)) ? `${(Number(value) * 100).toFixed(1)}%` : "—";
}

function num(value, digits = 2) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : "—";
}

function record(block) {
  if (!block || !Number(block.n)) return "N=0";
  return `${block.record || `${block.wins || 0}-${block.losses || 0}`} · ${pct(block.hitRate)}`;
}

export default function MlbValidationPanel() {
  const [window, setWindow] = useState("30");
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    fetch(`/api/mlb-validation?days=${encodeURIComponent(window)}&checkpoint=LATEST&_=${reloadKey}`, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok || body?.ok !== true) throw new Error(body?.error || `HTTP ${res.status}`);
        return body;
      })
      .then((body) => {
        if (active) setReport(body);
      })
      .catch((err) => {
        if (active && err?.name !== "AbortError") setError(String(err?.message || err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [window, reloadKey]);

  const sideBuckets = useMemo(() => report?.side?.buckets || [], [report]);
  const totalBuckets = useMemo(() => report?.total?.buckets || [], [report]);

  return (
    <div
      style={{
        marginTop: 12,
        border: "1px solid var(--border)",
        borderRadius: 8,
        background: "rgba(0,0,0,.16)",
        overflow: "hidden",
      }}
    >
      <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)", display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
        <div>
          <strong style={{ color: "#fff" }}>MLB market-disagreement validation</strong>
          <div className="muted" style={{ marginTop: 2, fontSize: 12 }}>
            Frozen FBIS scores vs frozen market lines, graded automatically after finals. Validation only — not a profitability claim.
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          {WINDOWS.map(([value, label]) => (
            <button key={value} type="button" className={window === value ? "chip active" : "chip"} onClick={() => setWindow(value)}>
              {label}
            </button>
          ))}
          <button type="button" className="header-btn" onClick={() => setReloadKey((v) => v + 1)} disabled={loading}>
            {loading ? "Loading…" : "Reload"}
          </button>
        </div>
      </div>

      <div style={{ padding: 12 }}>
        {error ? <div className="error">MLB validation unavailable: {error}</div> : null}
        {!error && !report && loading ? <div className="muted">Loading MLB validation…</div> : null}
        {report ? (
          <>
            <div className="status-grid" style={{ marginBottom: 12 }}>
              <Metric label="Games" value={report.population?.games ?? 0} />
              <Metric label="Outright winner" value={`${report.projection?.winnerCorrect ?? 0}/${report.projection?.winnerN ?? 0} · ${pct(report.projection?.winnerHitRate)}`} />
              <Metric label="Margin MAE" value={num(report.projection?.marginMae)} />
              <Metric label="Team-score MAE" value={num(report.projection?.teamScoreMae)} />
              <Metric label="Total MAE" value={num(report.projection?.totalMae)} />
              <Metric label="Market total MAE" value={num(report.projection?.marketTotalMae)} />
              <Metric label="Total bias" value={report.projection?.totalBias == null ? "—" : `${Number(report.projection.totalBias) >= 0 ? "+" : ""}${num(report.projection.totalBias)}`} />
              <Metric label="Side ATS" value={record(report.side)} />
              <Metric label="Side edge ≥1.0" value={record(report.side?.atLeast10)} />
              <Metric label="Total direction" value={record(report.total)} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 10 }}>
              <BucketTable title="Run-line edge buckets" rows={sideBuckets} />
              <BucketTable title="Total edge buckets" rows={totalBuckets} />
            </div>

            <div className="muted" style={{ marginTop: 10, fontSize: 12 }}>
              Population {report.since || "—"} through current graded finals · latest pregame frozen snapshot per game · pushes excluded from hit-rate denominator.
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}

function BucketTable({ title, rows }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>
      <div style={{ padding: "8px 10px", fontWeight: 800, color: "#fff", borderBottom: "1px solid var(--border)" }}>{title}</div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr>
              <th style={th}>Edge</th>
              <th style={th}>N</th>
              <th style={th}>Record</th>
              <th style={th}>Hit</th>
            </tr>
          </thead>
          <tbody>
            {(rows || []).map((row) => (
              <tr key={row.key}>
                <td style={td}>{row.label}</td>
                <td style={td}>{row.n}</td>
                <td style={td}>{row.record}</td>
                <td style={td}>{pct(row.hitRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const th = { textAlign: "left", padding: "7px 9px", color: "var(--muted)", borderBottom: "1px solid var(--border)" };
const td = { padding: "7px 9px", color: "var(--text)", borderBottom: "1px solid rgba(255,255,255,.05)" };
