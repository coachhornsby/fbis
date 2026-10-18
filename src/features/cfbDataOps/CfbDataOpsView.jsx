import { useEffect, useMemo, useState } from "react";
import "./cfbDataOps.css";

const STATUS_CLASS = {
  complete_and_verified: "ok",
  partial_coverage: "warn",
  failed: "err",
  stale: "err",
  blocked_by_provider_allowance: "err",
  collecting: "warn",
  waiting_for_source_publication: "muted",
  not_yet_due: "muted",
};

function StatusPill({ status }) {
  const cls = STATUS_CLASS[status] || "muted";
  return <span className={`cfb-ops-pill ${cls}`}>{String(status || "—").replaceAll("_", " ")}</span>;
}

function DatasetTable({ rows, emptyLabel }) {
  if (!rows?.length) return <p className="muted">{emptyLabel || "No datasets"}</p>;
  return (
    <div className="cfb-ops-table-wrap">
      <table className="cfb-ops-table">
        <thead>
          <tr>
            <th>Dataset</th>
            <th>Collected</th>
            <th>Champion</th>
            <th>Research / UI</th>
            <th>Storage</th>
            <th>Gaps</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id || r.endpoint || r.name}>
              <td>
                <strong>{r.name || r.id}</strong>
                <div className="muted small">{r.endpoint || r.endpointOrFeed || r.id}</div>
              </td>
              <td>{r.collectedCurrently ? "yes" : "no"}</td>
              <td>{r.championConsumes ? "yes" : "no"}</td>
              <td>
                {r.researchConsumes || r.projectionConsumption
                  ? r.projectionConsumption || (r.researchConsumes ? "research" : "—")
                  : r.uiConsumes
                    ? "ui"
                    : "—"}
              </td>
              <td className="small">{r.storage || "—"}</td>
              <td className="small">{(r.gaps || []).slice(0, 2).join("; ") || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ManifestTable({ datasets }) {
  if (!datasets?.length) return <p className="muted">No manifest rows</p>;
  return (
    <div className="cfb-ops-table-wrap">
      <table className="cfb-ops-table">
        <thead>
          <tr>
            <th>Dataset</th>
            <th>Required</th>
            <th>Status</th>
            <th>Rows</th>
            <th>Teams</th>
            <th>Collected</th>
          </tr>
        </thead>
        <tbody>
          {datasets.map((d) => (
            <tr key={`${d.scheduleId}-${d.datasetId}`}>
              <td>
                <strong>{d.datasetId}</strong>
                <div className="muted small">{d.chicagoWindow}</div>
              </td>
              <td>{d.required ? "yes" : "no"}</td>
              <td>
                <StatusPill status={d.status} />
              </td>
              <td>{d.evidence?.rowCount ?? "—"}</td>
              <td>{d.evidence?.teamCoverage ?? "—"}</td>
              <td className="small">{d.evidence?.collectedAt || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** FBIS Data Operations — SDV / CFBD / Pipeline Health. */
export default function CfbDataOpsView() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [section, setSection] = useState("overview");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (query.trim()) params.set("q", query.trim());
        const res = await fetch(`/api/cfb-data-ops?${params}`, { credentials: "same-origin" });
        const json = await res.json();
        if (!cancelled) {
          if (!res.ok || json?.ok === false) setError(json?.error || `HTTP ${res.status}`);
          else {
            setError(null);
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
  }, [query]);

  const matrixChampion = useMemo(
    () => (data?.utilizationMatrix?.rows || []).filter((r) => r.consumedByCfbFbisV2),
    [data]
  );

  return (
    <section className="panel cfb-data-ops" aria-label="CFB Data Operations">
      <header className="panel-header">
        <div>
          <h2 className="panel-title">CFB Data Operations</h2>
          <p className="muted">
            SDV and CFBD inventories, weekly collection health, and proof of model consumption.
            Page-visible fields are not assumed available to the prediction engine.
          </p>
        </div>
        <div className="cfb-ops-toolbar">
          <input
            type="search"
            className="cfb-ops-search"
            placeholder="Search registries…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search data registries"
          />
          <div className="cfb-ops-tabs" role="tablist">
            {[
              ["overview", "Overview"],
              ["sdv", "SDV Data"],
              ["cfbd", "CFBD Data"],
              ["tier3", "Tier 3"],
              ["pipeline", "Pipeline Health"],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                className={section === id ? "active" : ""}
                aria-selected={section === id}
                onClick={() => setSection(id)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {loading ? <p className="muted">Loading…</p> : null}
      {error ? <p className="error-text">{error}</p> : null}

      {data ? (
        <>
          <div className="cfb-ops-chip-row">
            <span className="cfb-ops-chip">
              Season {data.season} · Week {data.week}
            </span>
            <span className="cfb-ops-chip">
              SDV datasets {data.sdv?.summary?.nDatasets ?? 0}
            </span>
            <span className="cfb-ops-chip">
              CFBD endpoints {data.cfbd?.summary?.nEndpoints ?? 0}
            </span>
            <span className="cfb-ops-chip">
              Manifest verified {data.collection?.manifest?.verifiedRequired ?? 0}/
              {data.collection?.manifest?.requiredCount ?? 0}
            </span>
            <span className="cfb-ops-chip">
              CORE archive {data.core?.archiveTeamCount ?? 0} teams · research-only
            </span>
            {data.collection?.allowanceBlocked ? (
              <span className="cfb-ops-chip err">Quota blocked</span>
            ) : null}
          </div>

          {(section === "overview" || section === "sdv") && (
            <div className="cfb-ops-section">
              <h3>SDV Data</h3>
              <p className="muted small">{data.sdv?.note}</p>
              <DatasetTable rows={data.sdv?.datasets} />
            </div>
          )}

          {(section === "overview" || section === "cfbd") && (
            <div className="cfb-ops-section">
              <h3>CFBD Data</h3>
              <p className="muted small">{data.cfbd?.sharedQuotaNote}</p>
              <p className="muted small">{data.cfbd?.summary?.championContract}</p>
              <DatasetTable rows={data.cfbd?.endpoints} />
            </div>
          )}

          {(section === "overview" || section === "tier3") && data.tier3 ? (
            <div className="cfb-ops-section">
              <h3>CFBD Tier 3 utilization</h3>
              <p className="muted small">{data.tier3.summary?.directive}</p>
              <div className="cfb-ops-chip-row">
                <span className="cfb-ops-chip">
                  REST integrated {data.tier3.summary?.rest?.integrated ?? 0} · underutilized{" "}
                  {data.tier3.summary?.rest?.underutilized ?? 0}
                </span>
                <span className="cfb-ops-chip">
                  GraphQL ops {data.tier3.summary?.graphql?.n ?? 0} · production queries{" "}
                  {data.tier3.summary?.graphql?.productionQueryDocuments ?? 0}
                </span>
                <span className="cfb-ops-chip">
                  L1 {data.tier3.summary?.featureLevels?.L1 ?? 0} · L2{" "}
                  {data.tier3.summary?.featureLevels?.L2 ?? 0} · L3{" "}
                  {data.tier3.summary?.featureLevels?.L3 ?? 0}
                </span>
                <span className="cfb-ops-chip">
                  Fitted nonzero {data.tier3.summary?.featureLevels?.fittedChampionNonzero ?? 0}
                </span>
              </div>
              <p className="muted small">
                Readiness + per-game source→model audit:{" "}
                <code>{data.readinessApi || "/api/cfb-tuesday-readiness"}</code>
              </p>
              <p className="muted small">
                End-to-end validation (acquisition → accuracy):{" "}
                <code>/api/cfb-e2e-validation</code>
              </p>
              <p className="muted small">
                GraphQL: {data.tier3.graphqlShadow?.status} — shadow beside REST before any
                replacement. Live subscriptions are not a Tuesday prerequisite.
              </p>
            </div>
          ) : null}

          {(section === "overview" || section === "pipeline") && (
            <>
              <div className="cfb-ops-section">
                <h3>Weekly collection</h3>
                <ManifestTable datasets={data.collection?.manifest?.datasets} />
                {(data.collection?.manifest?.alerts || []).length ? (
                  <ul className="cfb-ops-alerts">
                    {data.collection.manifest.alerts.map((a, i) => (
                      <li key={`${a.code}-${i}`} className={a.severity}>
                        [{a.severity}] {a.datasetId}: {a.message}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted small">No collection alerts for this week (or no evidence yet).</p>
                )}
              </div>

              <div className="cfb-ops-section">
                <h3>Model input coverage (champion)</h3>
                <p className="muted small">
                  Fitted CFB-FBIS-v2 consumes only these fields — not the full page intelligence set.
                </p>
                <ul className="cfb-ops-matrix-list">
                  {matrixChampion.map((r) => (
                    <li key={r.canonicalFeature}>
                      <strong>{r.canonicalFeature}</strong>
                      <span className="muted"> · {r.provider} · {r.unit}</span>
                      {r.championEffect ? (
                        <div className="small muted">{r.championEffect}</div>
                      ) : null}
                    </li>
                  ))}
                </ul>
                <p className="muted small">
                  Matrix: {data.utilizationMatrix?.counts?.championConsumed ?? 0} champion ·{" "}
                  {data.utilizationMatrix?.counts?.uiOrResearchOnly ?? 0} UI/research-only · SDV
                  champion hits {data.utilizationMatrix?.counts?.sdvChampionConsumed ?? 0} (must be
                  0)
                </p>
              </div>

              <div className="cfb-ops-section">
                <h3>Pipeline Health</h3>
                <p className="muted small">
                  Upcoming matchups with frozen pregame vectors:{" "}
                  {data.pipelineHealth?.supportedCount ?? 0}/{data.pipelineHealth?.total ?? 0}
                </p>
                {(data.pipelineHealth?.matchups || []).length ? (
                  <div className="cfb-ops-table-wrap">
                    <table className="cfb-ops-table">
                      <thead>
                        <tr>
                          <th>Matchup</th>
                          <th>Kickoff</th>
                          <th>Supported</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.pipelineHealth.matchups.slice(0, 20).map((m) => (
                          <tr key={m.gameId}>
                            <td>
                              {m.away} @ {m.home}
                            </td>
                            <td className="small">{m.kickoff || "—"}</td>
                            <td>
                              <StatusPill
                                status={m.sufficientData ? "complete_and_verified" : "failed"}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="muted">No pregame vectors loaded for this window.</p>
                )}
              </div>

              <div className="cfb-ops-section">
                <h3>CORE research readiness</h3>
                <p className="muted small">
                  Archive teams: {data.core?.archiveTeamCount ?? 0} · Ready:{" "}
                  {data.core?.researchReadiness?.researchReady ? "yes" : "no"} · Champion eligible:{" "}
                  {data.core?.researchReadiness?.championEligible ? "yes" : "no"}
                </p>
                <ul className="cfb-ops-alerts">
                  {(data.core?.researchReadiness?.blockers || []).map((b) => (
                    <li key={b} className="warn">
                      {b}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="cfb-ops-section">
                <h3>Storage & retention</h3>
                <p className="muted small">{data.retention?.architecture?.flow?.join(" → ")}</p>
                <p className="muted small">
                  Permanent classes: {data.retention?.permanentCount ?? 0} · Expireable:{" "}
                  {data.retention?.expireableCount ?? 0} · Gate: {data.retention?.gateContract}
                </p>
              </div>
            </>
          )}
        </>
      ) : null}
    </section>
  );
}
