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
          </div>
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
