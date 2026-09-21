import { useEffect, useState } from "react";

/** Data Health — commercial status + provider freshness. */
export default function DataHealthView() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/data-health", { credentials: "same-origin" });
        const json = await res.json();
        if (!cancelled) {
          if (!res.ok || json?.ok === false) setError(json?.error || `HTTP ${res.status}`);
          else setData(json);
        }
      } catch (err) {
        if (!cancelled) setError(String(err?.message || err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const sources = data?.sources?.sources || [];

  return (
    <section className="panel canonical-health" aria-label="Data Health">
      <header className="panel-header">
        <div>
          <h2 className="panel-title">Data Health</h2>
          <p className="muted">
            Provider registry with commercial-use gates. Unresolved rights stay review-required.
          </p>
        </div>
      </header>
      {loading ? <p className="muted">Loading…</p> : null}
      {error ? <p className="error-text">{error}</p> : null}
      {data ? (
        <>
          <div className="canonical-chip-row">
            <span className="canonical-chip">
              Auto-promote: {data.autoPromoteAllowed ? "ON" : "OFF"}
            </span>
            <span className="canonical-chip">ACTION shadow only</span>
            <span className="canonical-chip">
              Review required: {(data.commercialReviewRequired || []).length}
            </span>
            {data.ops?.productionSha ? (
              <span className="canonical-chip">SHA {String(data.ops.productionSha).slice(0, 8)}</span>
            ) : null}
            {data.ops?.nflFormRows != null ? (
              <span className="canonical-chip">NFL form rows: {data.ops.nflFormRows}</span>
            ) : null}
          </div>
          {data.ops?.bySport ? (
            <div className="canonical-card-grid" style={{ marginBottom: "1rem" }}>
              {Object.values(data.ops.bySport).map((s) => (
                <article key={s.sport} className="canonical-card">
                  <h3>{String(s.sport || "").toUpperCase()} live ops</h3>
                  <p className="canonical-maturity">{s.liveOperational || "NOT_WIRED"}</p>
                  <p className="canonical-meta">
                    {s.currentModelId || "—"} {s.currentModelVersion || ""}
                  </p>
                  <p className="muted small">
                    frozen {s.frozenCount || 0} · published {s.publishedCount || 0} · graded{" "}
                    {s.gradedCount || 0}
                  </p>
                </article>
              ))}
            </div>
          ) : null}
          {data.runtimeConfig ? (
            <>
              <h3 style={{ marginTop: "1rem" }}>Runtime ingestion</h3>
              <div className="canonical-card-grid" style={{ marginBottom: "1rem" }}>
                {Object.entries(data.runtimeConfig).map(([providerId, r]) => (
                  <article key={providerId} className="canonical-card">
                    <h3>{providerId.replaceAll("_", " ")}</h3>
                    <p className="canonical-maturity">
                      {!r.implemented ? "NOT WIRED" : r.configured ? "CONFIGURED" : "MISSING CREDENTIAL"}
                    </p>
                    <p className="canonical-meta">
                      {r.lastSuccessAt || r.observation?.last_success_at || r.usage?.last_success_at || "No persisted success timestamp"}
                    </p>
                    <p className="muted small">
                      {r.recordsReturned != null ? `returned ${r.recordsReturned} · ` : ""}
                      {r.persisted != null ? `persisted ${r.persisted} · ` : ""}
                      {r.observation?.max_record_count != null ? `observed ${r.observation.max_record_count} · ` : ""}
                      {r.usage?.records_returned != null ? `API rows ${r.usage.records_returned} · ` : ""}
                      {r.error || r.reason || r.auth || "runtime evidence available"}
                    </p>
                  </article>
                ))}
              </div>
            </>
          ) : null}
          <div className="canonical-card-grid">
            {sources.map((s) => (
              <article key={s.providerId} className="canonical-card">
                <h3>{s.name}</h3>
                <p className="canonical-meta">
                  {s.domain} · {(s.sports || []).join(", ").toUpperCase()}
                </p>
                <p className="canonical-maturity">{s.commercialStatus.replaceAll("_", " ")}</p>
                <p className="muted small">{s.notes}</p>
                <p className="muted small">
                  Pure: {s.inPureModel ? "yes" : "no"} · Market: {s.inMarketLayer ? "yes" : "no"}
                </p>
              </article>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}
