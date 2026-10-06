import { useEffect, useState } from "react";

/**
 * Model Lab — champion/challenger registry + governance.
 * Does not auto-promote. Coefficients stay frozen for locked champions.
 */
export default function ModelLabView({ sportFilter = "all" }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [nflResearch, setNflResearch] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const sport = sportFilter === "all" ? "all" : sportFilter;
        const [res,nflRes] = await Promise.all([
          fetch(`/api/model-lab?sport=${encodeURIComponent(sport)}&registryOnly=true`, {credentials:"same-origin"}),
          (sport==="all"||sport==="nfl")
            ? fetch("/api/nfl-research-status",{credentials:"same-origin"})
            : Promise.resolve(null),
        ]);
        const json = await res.json();
        const nflJson = nflRes ? await nflRes.json().catch(()=>null) : null;
        if (!cancelled) {
          if (!res.ok || json?.ok === false) {
            setError(json?.error || `Model lab unavailable (${res.status})`);
            setData(null);
          } else {
            setData(json);
            setNflResearch(nflJson?.ok?nflJson:null);
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
          {(sportFilter==="all"||sportFilter==="nfl") && nflResearch ? (
            <section className="canonical-card" style={{marginBottom:16}}>
              <h3>NFL Research Status</h3>
              <p className="canonical-meta">
                Champion {nflResearch.nfl?.champion} · QB overlay {nflResearch.nfl?.lifecycle}
              </p>
              <div className="canonical-chip-row">
                <span className="canonical-chip">Frozen games: {nflResearch.qbShadow?.frozenGames ?? 0}</span>
                <span className="canonical-chip">Gate-fired: {nflResearch.qbShadow?.gateFiredGames ?? 0}</span>
                <span className="canonical-chip">Graded: {nflResearch.qbShadow?.gradedGames ?? 0}</span>
                <span className="canonical-chip">Gate: ≥ {Number(nflResearch.qbShadow?.gateThreshold ?? .30).toFixed(2)}</span>
              </div>
              <p className="muted small">
                Prospective gate: {String(nflResearch.qbShadow?.promotionGate?.decision||"ACCUMULATING").replaceAll("_"," ")}.
                Auto-promotion is disabled; totals and wager authority remain unchanged.
              </p>
              <div className="canonical-card-grid">
                {(nflResearch.props?.markets||[]).map((m)=>(
                  <article key={m.market} className="canonical-card">
                    <h4>{m.market.replaceAll("_"," ").toUpperCase()}</h4>
                    <p className="canonical-maturity">{m.status.replaceAll("_"," ")}</p>
                    <ul className="canonical-flags">
                      <li>Historical / WF: {m.historicalN} / {m.walkForwardN}</li>
                      <li>Prospective state: {m.prospectiveStateCompleteSnapshots}/{m.prospectiveLineSnapshots}</li>
                      <li>Prospective graded: {m.gradedProspectiveProps}</li>
                      <li>Monotonic: {m.monotonic?"yes":"no"}</li>
                      <li>Brier: {m.brier==null?"—":Number(m.brier).toFixed(3)}</li>
                      <li>ECE: {m.ece==null?"—":Number(m.ece).toFixed(3)}</li>
                      <li>Premium stars: {m.premiumStarEligible?"eligible":"blocked (max 3★)"}</li>
                    </ul>
                  </article>
                ))}
              </div>
            </section>
          ) : null}
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
