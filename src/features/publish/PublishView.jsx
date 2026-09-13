/**
 * Internal Publish surface — generate X-ready copy from live board projections.
 * Manual copy/post only. No auto-post. Research labeled honestly.
 */

import { useMemo, useState } from "react";
import {
  buildXGameCopy,
  buildXSlateCopy,
  buildTopDisagreementsCopy,
  publicationEligibilityForGame,
  PUBLICATION_STATES,
} from "../../../functions/lib/xPublication.js";
import { safeDisplayString, teamCardTitle } from "../../lib/boardDecision.js";

function CopyButton({ text }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-small"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text || "");
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* ignore */
        }
      }}
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}

export default function PublishView({ board, sportFilter = "all", date, loading, error }) {
  const [mode, setMode] = useState("games");
  const games = useMemo(() => {
    const all = board?.games || board?.slate?.games || [];
    return all.filter((g) => {
      if (sportFilter && sportFilter !== "all" && g.sport !== sportFilter) return false;
      return publicationEligibilityForGame(g).eligible;
    });
  }, [board, sportFilter]);

  const slateCopy = useMemo(
    () => buildXSlateCopy(games, sportFilter === "all" ? null : sportFilter, { dateLabel: date }),
    [games, sportFilter, date]
  );
  const topCopy = useMemo(() => buildTopDisagreementsCopy(games, { limit: 8 }), [games]);

  if (loading) return <div className="panel">Loading publishable projections…</div>;
  if (error) return <div className="panel error">{safeDisplayString(error, "Publish feed unavailable")}</div>;

  return (
    <div className="publish-view">
      <header className="panel">
        <h2>Publish</h2>
        <p className="muted">
          Manual X posting workflow. Research projections are labeled Research and are not wager-authorized.
          Copy text, then post from the FBIS account.
        </p>
        <div className="toolbar-row">
          <button type="button" className={mode === "games" ? "btn active" : "btn"} onClick={() => setMode("games")}>
            Games ({games.length})
          </button>
          <button type="button" className={mode === "slate" ? "btn active" : "btn"} onClick={() => setMode("slate")}>
            Slate
          </button>
          <button type="button" className={mode === "disagreements" ? "btn active" : "btn"} onClick={() => setMode("disagreements")}>
            Top Disagreements
          </button>
        </div>
      </header>

      {mode === "slate" ? (
        <section className="panel">
          <div className="toolbar-row">
            <strong>Daily slate copy</strong>
            <CopyButton text={slateCopy.text} />
          </div>
          <pre className="publish-copy">{slateCopy.text}</pre>
        </section>
      ) : null}

      {mode === "disagreements" ? (
        <section className="panel">
          <div className="toolbar-row">
            <strong>Top model disagreements</strong>
            <CopyButton text={topCopy.text} />
          </div>
          <pre className="publish-copy">{topCopy.text}</pre>
        </section>
      ) : null}

      {mode === "games" ? (
        <div className="publish-list">
          {games.length === 0 ? (
            <div className="panel muted">No publishable independent FBIS projections on this slate.</div>
          ) : (
            games.map((g) => {
              const built = buildXGameCopy(g, g.sport);
              const elig = publicationEligibilityForGame(g);
              return (
                <article key={g.id} className="panel publish-card">
                  <header className="toolbar-row">
                    <div>
                      <strong>
                        {String(g.sport || "").toUpperCase()} · {teamCardTitle(g.away)} @ {teamCardTitle(g.home)}
                      </strong>
                      <div className="muted">
                        {elig.status} · {safeDisplayString(g.projectionMaturity || g.model?.maturity, "—")} ·{" "}
                        {safeDisplayString(g.researchProjection?.modelId || g.projectionEngine || g.modelVersion, "model")}
                      </div>
                    </div>
                    <CopyButton text={built.text} />
                  </header>
                  <pre className="publish-copy">{built.text}</pre>
                  {elig.status === PUBLICATION_STATES.RESEARCH_PUBLISHABLE ? (
                    <p className="muted">Research projection — not wager-authorized. EV / fair odds withheld.</p>
                  ) : null}
                </article>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}
