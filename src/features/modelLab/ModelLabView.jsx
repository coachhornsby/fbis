import { useEffect, useState } from "react";

/**
 * Model Lab — champion/challenger registry + governance.
 * Does not auto-promote. Coefficients stay frozen for locked champions.
 */
export default function ModelLabView({ sportFilter = "all" }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const sport = sportFilter === "all" ? "all" : sportFilter;
        const res = await fetch(`/api/model-lab?sport=${encodeURIComponent(sport)}&registryOnly=true`, {
          credentials: "same-origin",
        });
        const json = await res.json();
        if (!cancelled) {
          if (!res.ok || json?.ok === false) {
            setError(json?.error || `Model lab unavailable (${res.status})`);
            setData(null);
          } else {
            setData(json);
          }
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
  }, [sportFilter]);

  const models = data?.governance?.registeredModels || [];
  const champions = data?.governance?.registrySummary?.champions || [];

  return (
    <section className="panel canonical-lab" aria-label="Model Lab">
      <header className="panel-header">
        <div>
          <h2 className="panel-title">Model Lab</h2>
          <p className="muted">
            Champion / challenger registry. Auto-promote:{" "}
            <strong>{data?.governance?.autoPromoteAllowed ? "ON" : "OFF"}</strong>
            . ACTION shadow only.
          </p>
        </div>
      </header>

      {loading ? <p className="muted">Loading registry…</p> : null}
      {error ? (
        <p className="error-text">
          {error}. If unauthorized, open SYSTEM while signed in as operator, or use registry docs under
          docs/canonical.
        </p>
      ) : null}

      {!loading && !error ? (
        <>
          <div className="canonical-chip-row">
            <span className="canonical-chip">Frozen champions: {champions.join(", ") || "—"}</span>
            <span className="canonical-chip">Models: {models.length}</span>
          </div>
          <div className="canonical-card-grid">
            {models.map((m) => (
              <article key={m.modelId} className="canonical-card" data-maturity={m.maturity}>
                <h3>{m.displayName}</h3>
                <p className="canonical-meta">
                  {m.sport.toUpperCase()} · {m.family} · {m.role}
                </p>
                <p className="canonical-maturity">{m.maturity.replaceAll("_", " ")}</p>
                <ul className="canonical-flags">
                  <li>Coefficients locked: {m.coefficientsLocked ? "yes" : "no"}</li>
                  <li>Calibration locked: {m.calibrationLocked ? "yes" : "no"}</li>
                  <li>Can qualify: {m.canQualify ? "yes" : "no"}</li>
                  <li>Can authorize wager: {m.canAuthorizeWager ? "yes" : "no"}</li>
                  <li>Market-informed: {m.marketInformed ? "yes" : "no"}</li>
                </ul>
                <p className="muted small">{m.notes}</p>
              </article>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}
