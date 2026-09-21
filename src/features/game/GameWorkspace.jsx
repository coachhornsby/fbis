import DecisionChip from "../today/DecisionChip.jsx";
import { fmtLine, fmtNum, fmtPct, fmtPrice, matchupLabel } from "../today/formatters.js";
import { venueAtmosphereClass } from "../../lib/venueAtmosphere.js";

function Section({ id, title, children, aside = null }) {
  return (
    <section className="game-ws-section" aria-labelledby={id}>
      <div className="game-ws-section-head">
        <h3 id={id}>{title}</h3>
        {aside}
      </div>
      <div className="game-ws-section-body">{children}</div>
    </section>
  );
}

function Metric({ label, value }) {
  return (
    <div className="game-ws-metric">
      <span className="game-ws-metric-label">{label}</span>
      <span className="game-ws-metric-value">{value}</span>
    </div>
  );
}

function marketByType(event, type, side = null) {
  return (event.consensusMarkets || []).find(
    (m) => m.marketType === type && (side == null || m.side === side),
  );
}

function fmtHold(v) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  const n = Number(v);
  // Domain hold is a fraction when < 1; otherwise treat as already percent-ish.
  return n > 0 && n < 1 ? fmtPct(n * 100) : fmtPct(n);
}

function fmtProb(v) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  const n = Number(v);
  return n >= 0 && n <= 1 ? fmtPct(n * 100) : fmtPct(n);
}

export function ModelPanel({ event }) {
  const model = event.model || {};
  if (model.unavailable) {
    return (
      <Section id="game-ws-model" title="Model">
        <p className="game-ws-empty">Projection unavailable for this event.</p>
      </Section>
    );
  }
  return (
    <Section
      id="game-ws-model"
      title="Model"
      aside={model.modelVersion ? <span className="muted">{model.modelVersion}</span> : null}
    >
      <div className="game-ws-metrics">
        <Metric label="Away proj" value={fmtNum(model.projAway)} />
        <Metric label="Home proj" value={fmtNum(model.projHome)} />
        <Metric label="Total" value={fmtNum(model.projTotal)} />
        <Metric label="Margin" value={fmtNum(model.projMargin)} />
        {model.showFairProbability ? (
          <Metric label="P(home)" value={fmtProb(model.pHome)} />
        ) : null}
        <Metric
          label="State"
          value={model.projectionDisplayKind || model.projectionState || model.projectionKind || "—"}
        />
      </div>
    </Section>
  );
}

export function MarketPanel({ event }) {
  const spread = marketByType(event, "spread", "home");
  const total = marketByType(event, "total", "over");
  const mlHome = marketByType(event, "moneyline", "home");
  const mlAway = marketByType(event, "moneyline", "away");
  const m = event.movement || {};
  const empty = !spread && !total && !mlHome && !mlAway;
  return (
    <Section id="game-ws-market" title="Market">
      {empty ? (
        <p className="game-ws-empty">Consensus market quotes unavailable.</p>
      ) : (
        <div className="game-ws-metrics">
          <Metric
            label="Spread (home)"
            value={`${fmtLine(spread?.line)} ${fmtPrice(spread?.price)}`}
          />
          <Metric label="Open" value={fmtLine(m.openingLine ?? spread?.openingLine)} />
          <Metric label="Current" value={fmtLine(m.currentLine ?? spread?.line)} />
          <Metric label="Total" value={`${fmtLine(total?.line)} ${fmtPrice(total?.price)}`} />
          <Metric label="ML away" value={fmtPrice(mlAway?.price)} />
          <Metric label="ML home" value={fmtPrice(mlHome?.price)} />
        </div>
      )}
      <p className="muted game-ws-note">Consensus / pin benchmark — not an execution instruction.</p>
    </Section>
  );
}

export function BestPricesPanel({ event }) {
  const m = event.movement || {};
  const hasBest = m.bestLine != null || m.bestPrice != null || m.bestBook;
  return (
    <Section id="game-ws-best" title="Best prices">
      {!hasBest ? (
        <p className="game-ws-empty">No shopped best price available for this event.</p>
      ) : (
        <div className="game-ws-metrics">
          <Metric label="Best line" value={fmtLine(m.bestLine)} />
          <Metric label="Best price" value={fmtPrice(m.bestPrice)} />
          <Metric label="Best book" value={m.bestBook || "—"} />
          <Metric label="Books" value={m.bookCount == null ? "—" : String(m.bookCount)} />
          <Metric label="Hold" value={fmtHold(m.hold)} />
          <Metric label="Freshness" value={m.freshness || "—"} />
        </div>
      )}
      <p className="muted game-ws-note">Best price is informational. FBIS does not auto-execute.</p>
    </Section>
  );
}

export function MovementPanel({ event }) {
  const m = event.movement || {};
  const hasMove =
    m.openingLine != null ||
    m.currentLine != null ||
    (m.movementMagnitude != null && Number(m.movementMagnitude) > 0);
  return (
    <Section id="game-ws-move" title="Movement">
      {!hasMove ? (
        <p className="game-ws-empty">No measured movement summary for this event.</p>
      ) : (
        <div className="game-ws-metrics">
          <Metric label="Open" value={fmtLine(m.openingLine)} />
          <Metric label="Current" value={fmtLine(m.currentLine)} />
          <Metric label="Magnitude" value={fmtLine(m.movementMagnitude)} />
          <Metric label="Direction" value={m.movementDirection || "—"} />
          <Metric label="Ticks" value={m.movementCount == null ? "—" : String(m.movementCount)} />
          <Metric label="Last move" value={m.lastMovementAt || "—"} />
        </div>
      )}
    </Section>
  );
}

export function PublicSplitsPanel({ event }) {
  const splits = event.publicSplits || {};
  const m = event.movement || {};
  // Domain ticketPct/moneyPct are HOME-side percentages. Display both sides so
  // an operator never has to infer which team a bare percentage refers to.
  const ticketHome = splits.ticketPct ?? m.ticketPct;
  const moneyHome = splits.moneyPct ?? m.moneyPct;
  const ticketAway = ticketHome == null ? null : 100 - Number(ticketHome);
  const moneyAway = moneyHome == null ? null : 100 - Number(moneyHome);
  const gap = m.moneyTicketGap;
  const away = event?.teams?.away?.abbr || event?.teams?.away?.name || "AWAY";
  const home = event?.teams?.home?.abbr || event?.teams?.home?.name || "HOME";
  const empty = ticketHome == null && moneyHome == null;
  return (
    <Section id="game-ws-public" title="Public splits">
      {empty ? (
        <p className="game-ws-empty">Ticket / money splits unavailable.</p>
      ) : (
        <div className="game-ws-metrics">
          <Metric
            label="Tickets"
            value={
              ticketHome == null
                ? "—"
                : `${away} ${fmtPct(ticketAway)} · ${home} ${fmtPct(ticketHome)}`
            }
          />
          <Metric
            label="Money"
            value={
              moneyHome == null
                ? "—"
                : `${away} ${fmtPct(moneyAway)} · ${home} ${fmtPct(moneyHome)}`
            }
          />
          <Metric label="Home money − tickets" value={gap == null ? "—" : fmtPct(gap)} />
        </div>
      )}
      <p className="muted game-ws-note">Public positioning — not labeled sharp unless upstream says so.</p>
    </Section>
  );
}

export function DecisionPanel({ event }) {
  const d = event.decision || {};
  const reasons = d.reasonCodes || [];
  return (
    <Section
      id="game-ws-decision"
      title="Decision"
      aside={<DecisionChip state={d.state} reasonCodes={reasons} />}
    >
      <div className="game-ws-metrics">
        <Metric label="Qualified" value={d.qualified ? "YES" : "NO"} />
        <Metric label="Authorized" value={d.authorized ? "YES" : "NO"} />
        <Metric
          label="Betting allowed"
          value={d.bettingAllowed == null ? "—" : d.bettingAllowed ? "YES" : "NO"}
        />
        <Metric label="Block" value={d.blockReason || "—"} />
      </div>
      {reasons.length ? (
        <ul className="game-ws-reasons">
          {reasons.map((r) => (
            <li key={r}>{String(r).replace(/_/g, " ")}</li>
          ))}
        </ul>
      ) : (
        <p className="muted game-ws-note">No reason codes attached.</p>
      )}
      {d.rec?.pick ? (
        <p className="muted game-ws-note">
          Board rec: {d.rec.pick}
          {d.rec.market ? ` · ${d.rec.market}` : ""}
          {d.qualified ? "" : " (not qualified)"}
        </p>
      ) : null}
      {d.lean?.pick ? (
        <p className="muted game-ws-note">
          Lean: {d.lean.pick}
          {d.lean.reason ? ` · ${String(d.lean.reason).replace(/_/g, " ")}` : ""}
        </p>
      ) : null}
    </Section>
  );
}

export function PlayerMarketsPanel({ event }) {
  const rows = event.playerMarkets || [];
  return (
    <Section id="game-ws-props" title="Player markets">
      {!rows.length ? (
        <p className="game-ws-empty">
          No normalized player markets on this event. Research-only when present.
        </p>
      ) : (
        <div className="table-scroll">
          <table className="fbis-table game-ws-table">
            <thead>
              <tr>
                <th>Player</th>
                <th>Market</th>
                <th>Line</th>
                <th>Price</th>
                <th>Book</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={`${row.playerName}-${row.marketCanonical || row.market}-${i}`}>
                  <td>
                    <strong>{row.playerName || "—"}</strong>
                    <div className="muted">
                      {[row.team, row.position].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </td>
                  <td>{row.marketCanonical || row.market || "—"}</td>
                  <td>{fmtLine(row.line)}</td>
                  <td>{fmtPrice(row.overOdds ?? row.price)}</td>
                  <td className="muted">{row.book || "—"}</td>
                  <td>
                    <DecisionChip
                      state={row.decisionEligible ? "WATCHLIST" : "RESEARCH"}
                      reasonCodes={row.reasonCodes}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

export function VenuePanel({ event, weather = null }) {
  const w = weather || event.weather || null;
  return (
    <Section id="game-ws-venue" title="Venue / weather">
      <div className="game-ws-metrics">
        <Metric label="Venue" value={event.venue || "—"} />
        <Metric label="Neutral" value={event.neutral ? "YES" : "NO"} />
        <Metric label="Conditions" value={w?.description || "—"} />
        <Metric
          label="Temp / wind"
          value={
            w?.temperature == null && w?.windSpeed == null
              ? "—"
              : `${w?.temperature == null ? "—" : `${w.temperature}°F`}${
                  w?.windSpeed == null ? "" : ` · ${w.windSpeed} mph`
                }`
          }
        />
      </div>
      {w?.note ? <p className="muted game-ws-note">{w.note}</p> : null}
      {w?.attribution ? <p className="muted game-ws-note">{w.attribution}</p> : null}
    </Section>
  );
}

export function ProvenancePanel({ event }) {
  const p = event.provenance || {};
  const mq = event.marketQuality || {};
  return (
    <Section id="game-ws-prov" title="Provenance / quality">
      <div className="game-ws-metrics">
        <Metric label="Source" value={p.source || "—"} />
        <Metric label="Collected" value={p.collectedAt || "—"} />
        <Metric label="Schema" value={p.schemaVersion || "—"} />
        <Metric
          label="Market quality"
          value={mq.quality?.score ?? (mq.unavailable ? "UNAVAILABLE" : "—")}
        />
      </div>
    </Section>
  );
}

export default function GameWorkspace({ event, weather = null, footer = null }) {
  const venueClass = venueAtmosphereClass(event?.sport || event?.league);
  if (!event) {
    return (
      <div className="game-workspace">
        <p className="game-ws-empty">Game workspace unavailable — no domain event.</p>
      </div>
    );
  }
  return (
    <div
      className={`game-workspace${venueClass ? ` ${venueClass}` : ""}`}
      data-game-id={event.id || undefined}
      data-sport={event.sport || event.league || undefined}
    >
      <header className="game-ws-header">
        <div>
          <h2 className="game-ws-title">{matchupLabel(event)}</h2>
          <p className="muted">
            {(event.league || event.sport || "").toString().toUpperCase()}
            {event.startCt ? ` · ${event.startCt} CT` : ""}
            {event.status ? ` · ${typeof event.status === "object" ? (event.status.state || event.status.detail || "") : event.status}` : ""}
          </p>
        </div>
        <DecisionChip state={event.decision?.state} reasonCodes={event.decision?.reasonCodes} />
      </header>
      <div className="game-ws-grid">
        <ModelPanel event={event} />
        <MarketPanel event={event} />
        <BestPricesPanel event={event} />
        <MovementPanel event={event} />
        <PublicSplitsPanel event={event} />
        <DecisionPanel event={event} />
        <PlayerMarketsPanel event={event} />
        <VenuePanel event={event} weather={weather} />
        <ProvenancePanel event={event} />
      </div>
      {footer}
    </div>
  );
}
