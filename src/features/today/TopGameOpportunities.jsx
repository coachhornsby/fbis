import { useMemo } from "react";
import TeamLogo from "../../components/TeamLogo.jsx";
import { venueAtmosphereClass, venueAtmosphereStyle } from "../../lib/venueAtmosphere.js";
import { fmtLine, fmtNum } from "./formatters.js";

const SPORT_PILLS = [
  { id: "mlb", label: "MLB" }, { id: "nfl", label: "NFL" }, { id: "cfb", label: "CFB" },
  { id: "nba", label: "NBA" }, { id: "cbb", label: "CBB" }, { id: "nhl", label: "NHL" },
];
const SECONDARY_TONES = ["cyan", "coral", "teal", "cyan"];

function formatKickoff(startCt) {
  if (!startCt) return "TBD";
  try {
    const d = new Date(startCt);
    if (Number.isNaN(d.getTime())) return String(startCt);
    return d.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  } catch { return String(startCt); }
}
function diffUnit(sport) {
  const s = String(sport || "").toUpperCase();
  if (s === "MLB") return "RUNS";
  if (s === "NHL") return "GOALS";
  return "PTS";
}
function fbisProjectionLabel(proj, awayAbbr, homeAbbr) {
  if (!Number.isFinite(proj)) return "—";
  if (proj === 0) return "PICK";
  return proj > 0 ? `${homeAbbr} ${fmtLine(-proj)}` : `${awayAbbr} ${fmtLine(proj)}`;
}
function marketLineLabel(line, homeAbbr) {
  if (!Number.isFinite(line)) return "—";
  return `${homeAbbr} ${fmtLine(line)}`;
}
function moneyInsight(moneyPct, awayAbbr, homeAbbr) {
  if (!Number.isFinite(moneyPct)) return "Money lean unavailable";
  if (moneyPct >= 65) return `Heavy money lean on ${homeAbbr}`;
  if (moneyPct <= 35) return `Heavy money lean on ${awayAbbr}`;
  if (moneyPct >= 55) return `Moderate money lean on ${homeAbbr}`;
  if (moneyPct <= 45) return `Moderate money lean on ${awayAbbr}`;
  return "Balanced money";
}
function whyItRanks(rank, event) {
  const codes = event?.decision?.reasonCodes || [];
  if (codes.includes("BOARD_REC_QUALIFIED")) return "Qualified by the canonical FBIS decision record using the current comparable market.";
  if (codes.includes("PUBLIC_FADE_SETUP")) return "Public fade setup with model edge and money confirmation.";
  if (codes.includes("LINE_MOVED_TOWARD_MODEL")) return "Line moved toward the FBIS projection with actionable edge.";
  if (rank === 1) return "Highest-ranked board opportunity on the current slate.";
  return "Current FBIS watchlist opportunity.";
}
function lineMoveCopy(movement) {
  const mag = Number(movement?.movementMagnitude);
  const dir = movement?.movementDirection;
  if (!Number.isFinite(mag) || mag < 0.5) return "No significant move";
  const dirLabel = dir ? String(dir).replace(/_/g, " ").toLowerCase() : "moved";
  return `Line ${dirLabel} ${fmtNum(mag)}`;
}
function sampleSizeCopy(movement) {
  const books = Number(movement?.bookCount);
  return Number.isFinite(books) && books >= 3 ? `${Math.round(books)} books` : "Insufficient data";
}
function openGameOnBoard(gameId) {
  if (!gameId || typeof document === "undefined") return;
  const el = document.querySelector(`[data-game-id="${CSS.escape(String(gameId))}"]`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("top-opp-target-flash");
  window.setTimeout(() => el.classList.remove("top-opp-target-flash"), 1600);
}
function MetricBox({ label, value, tone }) {
  return <div className={`top-metric top-metric--${tone}`}><span className="top-metric-label">{label}</span><strong className="top-metric-value">{value}</strong></div>;
}
function SplitBars({ ticketPct, moneyPct, awayAbbr, homeAbbr, compact = false }) {
  const tHome = Number.isFinite(ticketPct) ? Math.max(0, Math.min(100, Math.round(ticketPct))) : null;
  const tAway = tHome != null ? 100 - tHome : null;
  const mHome = Number.isFinite(moneyPct) ? Math.max(0, Math.min(100, Math.round(moneyPct))) : null;
  const mAway = mHome != null ? 100 - mHome : null;
  return (
    <div className={`top-splits${compact ? " top-splits--compact" : ""}`}>
      <div className="top-split-row"><span className="top-split-label">TICKETS</span>{tAway != null ? <><div className="top-split-track" aria-hidden="true"><span className="top-split-fill top-split-fill--away" style={{ width: `${tAway}%` }} /><span className="top-split-fill top-split-fill--home" style={{ width: `${tHome}%` }} /></div><span className="top-split-pct">{tAway}% {awayAbbr} · {tHome}% {homeAbbr}</span></> : <span className="top-split-empty">Unavailable</span>}</div>
      <div className="top-split-row"><span className="top-split-label top-split-label--money">MONEY</span>{mAway != null ? <><div className="top-split-track" aria-hidden="true"><span className="top-split-fill top-split-fill--away" style={{ width: `${mAway}%` }} /><span className="top-split-fill top-split-fill--home" style={{ width: `${mHome}%` }} /></div><span className="top-split-pct top-split-pct--money">{mAway}% {awayAbbr} · {mHome}% {homeAbbr}</span></> : <span className="top-split-empty top-split-empty--money">Unavailable</span>}</div>
    </div>
  );
}
function StatusPill({ state }) {
  const isQualified = state === "QUALIFIED";
  return <span className={`top-status-pill${isQualified ? " top-status-pill--ok" : " top-status-pill--watch"}`}>{isQualified ? "✓ QUALIFIED" : "WATCHLIST"}</span>;
}
function TeamBlock({ team, size = 48, align = "left" }) {
  const name = team?.fullName || team?.name || team?.abbr || "—";
  const record = team?.record || null;
  return <div className={`top-team top-team--${align}`}><TeamLogo team={team} size={size} /><div className="top-team-text"><strong>{name}</strong>{record ? <span>({record})</span> : null}</div></div>;
}

function buildView(event, rank) {
  const away = event?.teams?.away || {};
  const home = event?.teams?.home || {};
  const model = event?.model || {};
  const movement = event?.movement || {};
  const decision = event?.decision || {};
  const comparison = event?.modelVsMarket || {};
  const sport = String(event?.sport || "").toLowerCase();
  const proj = Number.isFinite(Number(model.projMargin)) ? Number(model.projMargin) : null;
  const marketRaw = Number.isFinite(Number(comparison.spread)) ? Number(comparison.spread) : null;
  const diff = Number.isFinite(Number(comparison.sideDifference)) ? Number(comparison.sideDifference) : null;
  const splitsAvailable = event?.publicSplits?.available !== false;
  const ticketPct = splitsAvailable && Number.isFinite(Number(event?.publicSplits?.ticketPct)) ? Number(event.publicSplits.ticketPct) : null;
  const moneyPct = splitsAvailable && Number.isFinite(Number(event?.publicSplits?.moneyPct)) ? Number(event.publicSplits.moneyPct) : null;
  const awayAbbr = away.abbr || "AWAY";
  const homeAbbr = home.abbr || "HOME";
  return {
    id: event.id, rank, sport, state: decision.state || "WATCHLIST", away, home, awayAbbr, homeAbbr,
    kickoff: formatKickoff(event.startCt), venue: event.venue || "Venue TBD",
    fbisValue: model.unavailable ? "—" : fbisProjectionLabel(proj, awayAbbr, homeAbbr),
    marketValue: marketLineLabel(marketRaw, homeAbbr),
    diffValue: diff != null ? `${fmtNum(diff)} ${diffUnit(sport)}` : "—",
    ticketPct, moneyPct, insight: moneyInsight(moneyPct, awayAbbr, homeAbbr), why: whyItRanks(rank, event),
    lineMove: lineMoveCopy(movement), sampleSize: sampleSizeCopy(movement), venueClass: venueAtmosphereClass(sport), venueStyle: venueAtmosphereStyle(event),
  };
}

function HeroCard({ view, onOpenGame }) {
  return <article className={`top-hero ${view.venueClass || ""}`.trim()} style={view.venueStyle}>
    <div className="top-hero-body"><div className="top-hero-left"><div className="top-hero-rank-row"><span className="top-hero-rank-badge">#{view.rank}</span><span className="top-hero-rank-label">TOP OPPORTUNITY</span></div><div className="top-hero-teams"><TeamBlock team={view.away} size={56} align="left" /><span className="top-hero-at">@</span><TeamBlock team={view.home} size={56} align="right" /></div><div className="top-hero-meta"><span>{view.kickoff}</span><span aria-hidden="true">·</span><span>{view.venue}</span></div></div>
    <div className="top-hero-right"><div className="top-hero-head"><StatusPill state={view.state} /></div><div className="top-metric-row"><MetricBox label="FBIS PROJECTION" value={view.fbisValue} tone="proj" /><MetricBox label="MARKET LINE" value={view.marketValue} tone="market" /><MetricBox label="DIFFERENCE" value={view.diffValue} tone="diff" /></div><div className="top-hero-intel"><div className="top-hero-intel-title">ACTION INTEL</div><SplitBars ticketPct={view.ticketPct} moneyPct={view.moneyPct} awayAbbr={view.awayAbbr} homeAbbr={view.homeAbbr} /><div className="top-hero-facts"><div className="top-fact"><span className="top-fact-label">LINE MOVE</span><strong>{view.lineMove}</strong></div><div className="top-fact"><span className="top-fact-label">SAMPLE SIZE</span><strong>{view.sampleSize}</strong></div></div></div></div></div>
    <div className="top-hero-foot"><div className="top-hero-why"><span className="top-hero-why-icon" aria-hidden="true">⌖</span><div><strong>WHY IT RANKS #{view.rank}</strong><p>{view.why}</p></div></div><button type="button" className="top-view-btn" onClick={() => onOpenGame?.(view.id)}>View Game →</button></div>
  </article>;
}
function SecondaryCard({ view, onOpenGame, tone }) {
  return <article className={`top-secondary top-secondary--${tone}`}><div className="top-secondary-top"><div className="top-secondary-match"><span className="top-secondary-rank">#{view.rank}</span><TeamLogo team={view.away} size={34} /><div className="top-secondary-names"><strong>{view.awayAbbr} @ {view.homeAbbr}</strong><span>{(view.away.fullName || view.away.name || view.awayAbbr) + " @ " + (view.home.fullName || view.home.name || view.homeAbbr)}</span><span>{view.kickoff} · {view.venue}</span></div><TeamLogo team={view.home} size={34} /></div><StatusPill state={view.state} /></div><div className="top-metric-row top-metric-row--compact"><MetricBox label="FBIS PROJ" value={view.fbisValue} tone="proj" /><MetricBox label="MARKET" value={view.marketValue} tone="market" /><MetricBox label="DIFF" value={view.diffValue} tone="diff" /></div><div className="top-secondary-bottom"><SplitBars ticketPct={view.ticketPct} moneyPct={view.moneyPct} awayAbbr={view.awayAbbr} homeAbbr={view.homeAbbr} compact /><div className="top-secondary-actions"><p className="top-secondary-insight">{view.insight}</p><button type="button" className="top-view-btn top-view-btn--ghost" onClick={() => onOpenGame?.(view.id)}>View Game →</button></div></div></article>;
}

export default function TopGameOpportunities({ events = [], sportFilter = "mlb", onSportFilter, totalGames = 0, onOpenGame }) {
  const ranked = useMemo(() => (Array.isArray(events) ? events.slice(0, 5) : []).map((event, idx) => buildView(event, idx + 1)), [events]);
  const qualifiedCount = useMemo(() => (Array.isArray(events) ? events.filter((e) => e?.decision?.state === "QUALIFIED").length : 0), [events]);
  const hero = ranked[0] || null;
  const rest = ranked.slice(1);
  const activeSport = String(sportFilter || "").toLowerCase();
  const handleOpen = (id) => { if (typeof onOpenGame === "function") onOpenGame(id); else openGameOnBoard(id); };
  return <section className="top-opps" aria-label="Top opportunities"><header className="top-opps-head"><div className="top-opps-title-block"><h2 className="top-opps-title"><span className="top-opps-fire" aria-hidden="true">🔥</span>TOP OPPORTUNITIES</h2><p className="top-opps-sub">Highest-ranked qualified and near-qualified games from the canonical board state.</p></div><div className="top-opps-controls"><div className="top-opps-pills" role="tablist" aria-label="Sport filter">{SPORT_PILLS.map((sport) => <button key={sport.id} type="button" role="tab" aria-selected={activeSport === sport.id} className={`top-opps-pill${activeSport === sport.id ? " is-active" : ""}`} onClick={() => onSportFilter?.(sport.id)}>{sport.label}</button>)}</div><div className="top-opps-count"><strong>{qualifiedCount} QUALIFIED</strong><span> of {totalGames || events.length} games</span></div></div></header>{!hero ? <div className="top-opps-empty">No qualified or watchlist games right now. FBIS will not invent a top five.</div> : <div className="top-opps-stack"><HeroCard view={hero} onOpenGame={handleOpen} />{rest.length > 0 ? <div className="top-opps-secondary">{rest.map((view, idx) => <SecondaryCard key={view.id || view.rank} view={view} tone={SECONDARY_TONES[idx] || "cyan"} onOpenGame={handleOpen} />)}</div> : null}</div>}</section>;
}
