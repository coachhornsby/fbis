import AlternateLines from './AlternateLines.jsx';
import {buildMoneylinePriceComparison} from "../../lib/marketPriceComparison.js";
import VenueConditions from "./VenueConditions.jsx";
import SoccerPinnOdds from "./SoccerPinnOdds.jsx";
import MatchupSignals from "./MatchupSignals.jsx";
import NflDirectionalMatchups from "./NflDirectionalMatchups.jsx";
import CfbDirectionalMatchups from "./CfbDirectionalMatchups.jsx";
import CfbSeasonStatStrip from "./CfbSeasonStatStrip.jsx";
import CfbProjectionReliability from "./CfbProjectionReliability.jsx";
import PinnoddsCardMarkets from "./PinnoddsCardMarkets.jsx";
import {pinnoddsReferenceDifference} from "../../lib/pinnoddsReferenceDifference.js";
import MoneylinePriceComparison from "./MoneylinePriceComparison.jsx";
import EventPlayerProps from "./EventPlayerProps.jsx";
import EventMarkets from "./EventMarkets.jsx";
import TeamLogo from "../TeamLogo.jsx";
import NhlBettingIntelligence from "./NhlBettingIntelligence.jsx";
import NhlMatchupSignals from "./NhlMatchupSignals.jsx";
import MlbPitchHitMatchups from "./MlbPitchHitMatchups.jsx";
import NflInjuryIntegrityStrip from "./NflInjuryIntegrityStrip.jsx";

import { buildGameCardViewModel } from "../../lib/gameCardViewModel.js";
import { confidenceStarPresentation } from "../../lib/confidenceStars.js";
import { bestEdge } from "../../lib/boardEvidence.js";
import { gapBrandColor, gapDirection } from "../../lib/marketGapBrand.js";
import AdvancedGameDetail from "./AdvancedGameDetail.jsx";
import TennisMatchCard from "./TennisMatchCard.jsx";
import "./premiumGameCard.css";
import "./universalPremiumCard.css";

function num(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  const x = Math.round(n * 10) / 10;
  return Number.isInteger(x) ? String(x) : x.toFixed(1);
}

function signed(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  const x = Math.round(n * 10) / 10;
  return `${x > 0 ? "+" : ""}${Number.isInteger(x) ? x : x.toFixed(1)}`;
}

function fmtOdds(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  if (n > 1 && n < 10) {
    const american = n >= 2 ? Math.round((n - 1) * 100) : Math.round(-100 / (n - 1));
    return american > 0 ? `+${american}` : String(american);
  }
  const rounded = Math.round(n);
  return rounded > 0 ? `+${rounded}` : String(rounded);
}

function fairAmerican(prob) {
  const p = Number(prob);
  if (!Number.isFinite(p) || p <= 0 || p >= 1) return "—";
  const american = p >= 0.5 ? -100 * p / (1 - p) : 100 * (1 - p) / p;
  const rounded = Math.round(american);
  return rounded > 0 ? `+${rounded}` : String(rounded);
}

function tennisPlayerMeta(team, tour) {
  const rank = Number(team?.rank);
  const pts = Number(team?.rankingPoints);
  const rankLabel = Number.isFinite(rank) ? `${tour || "ATP/WTA"} #${Math.round(rank)}` : `${tour || "ATP/WTA"} UNRANKED`;
  const pointsLabel = Number.isFinite(pts) ? ` · ${Math.round(pts).toLocaleString()} pts` : "";
  return rankLabel + pointsLabel;
}

function modelEdge(vm) {
  const cmp = vm.comparison || {};
  const spread = cmp.sideDiff == null ? NaN : Number(cmp.sideDiff);
  const total = cmp.totalDiff == null ? NaN : Number(cmp.totalDiff);
  if (Number.isFinite(spread) && (!Number.isFinite(total) || Math.abs(spread) >= Math.abs(total))) {
    return {
      value: cmp.fbisSide?.label || signed(spread),
      delta: `+${num(Math.abs(spread))}`,
      type: "SPREAD",
    };
  }
  if (Number.isFinite(total)) {
    return {
      value: `${total > 0 ? "OVER" : total < 0 ? "UNDER" : "TOTAL"} ${vm.market?.total ?? "—"}`,
      delta: signed(total),
      type: "TOTAL",
    };
  }
  return { value: "—", delta: "—", type: "EDGE" };
}

function SharpStars({ value = 1, max = 5 }) {
  const ceiling = Math.max(1, Math.min(5, Number(max) || 5));
  const safe = Math.max(1, Math.min(ceiling, Number(value) || 1));
  return <span className="pgc-sharp-stars" aria-label={`${safe} of ${ceiling} confidence stars`}>
    {Array.from({ length: ceiling }, (_, i) => <svg key={i} className={i < safe ? "filled" : "empty"} viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.2l2.95 5.98 6.6.96-4.78 4.66 1.13 6.58L12 17.28l-5.9 3.1 1.13-6.58-4.78-4.66 6.6-.96L12 2.2z" /></svg>)}
  </span>;
}
function splitLabel(split, away, home) {
  if (!split) return "—";
  const a=Number(split.awayPct), h=Number(split.homePct);
  if(!Number.isFinite(a)||!Number.isFinite(h)) return "—";
  return `${away.abbr} ${Math.round(a)}% · ${home.abbr} ${Math.round(h)}%`;
}
function mlbStarterInfo(game, side) {
  const persistent = game?.mlbPersistentState?.[side === "home" ? "homeStarter" : "awayStarter"] || null;
  const raw = game?.[side === "home" ? "homeSp" : "awaySp"] || {};
  const era = persistent?.era ?? game?.savant?.[side === "home" ? "homeSpEra" : "awaySpEra"] ?? null;
  const id = raw?.id ?? persistent?.id ?? null;
  return {
    id,
    name: raw?.name || persistent?.name || null,
    wins: persistent?.wins ?? null,
    losses: persistent?.losses ?? null,
    era,
  };
}
function MlbStarterMini({ game, side }) {
  const sp = mlbStarterInfo(game, side);
  if (!sp.name && sp.era == null) return null;
  const record = sp.wins != null && sp.losses != null ? `${sp.wins}-${sp.losses}` : null;
  const era = Number.isFinite(Number(sp.era)) ? `${Number(sp.era).toFixed(2)} ERA` : null;
  const image = sp.id
    ? `https://img.mlbstatic.com/mlb-photos/image/upload/w_180,q_auto:best/v1/people/${sp.id}/headshot/67/current`
    : null;
  return (
    <div className="pgc-mlb-starter">
      <span className="pgc-mlb-starter-shot" aria-hidden="true">
        {image
          ? <img src={image} alt="" loading="lazy" referrerPolicy="no-referrer" />
          : <em>{(sp.name || "?").slice(0, 1)}</em>}
      </span>
      <div>
        <small>SP</small>
        <strong>{sp.name || "TBD"}</strong>
        <span>{[record, era].filter(Boolean).join(" · ") || "Starter"}</span>
      </div>
    </div>
  );
}

function MarketCell({ title, value, model, market, edge }) {
  return (
    <div className="pgc-market-cell">
      <span className="pgc-market-label">{title}</span>
      <strong>{value}</strong>
      <div className="pgc-market-lines">
        <span>Model: {model}</span>
        <span>Market: {market}</span>
      </div>
      {edge ? <em>{edge}</em> : null}
    </div>
  );
}

export default function PremiumGameCard({ game, open = false, onToggle, renderDetail = null }) {
  const vm = buildGameCardViewModel(game);
  if (!vm?.id && !game?.id) return null;
  const stored=game?.durableFallback?.statusUnverified===true;

  const away = vm.away || {};
  const home = vm.home || {};
  const proj = vm.projection || {};
  const winProbabilities = buildMoneylinePriceComparison(game).rows;
  const cmp = vm.comparison || {};
  const action = vm.action || {};
  const ctx = vm.context || {};
  const market = vm.market || {};
  const edge = modelEdge(vm);
  const rating = stored ? null : confidenceStarPresentation(game);
  const stars = rating?.stars ?? null;
  const teamColor = team => { const v=String(team?.color||team?.primaryColor||team?.primary_color||"").trim();return /^#?[a-f0-9]{3}(?:[a-f0-9]{3})?$/i.test(v)?(v.startsWith("#")?v:`#${v}`):null; };
  const soccerPick = String(vm.sport || game?.sport || "").toLowerCase() === "soccer"
    ? (game?.soccerConfidence || game?.confidencePick || game?.soccerFbis?.confidencePick || null)
    : null;
  const cardKey = `${vm.sport || ""}:${vm.id || game?.id}`;
  const sportId = String(vm.sport || game?.sport || "").toLowerCase();
  const isNfl = sportId === "nfl";
  const referenceGap = pinnoddsReferenceDifference(game,proj);
  const referenceLead = referenceGap.leading;
  const showReferenceGap = !stored && !vm.decision?.evAvailable && referenceGap.available;
  const referenceTeam = showReferenceGap && referenceLead?.kind==="spread"
    ? referenceLead.side==="home" ? home : referenceLead.side==="away" ? away : null : null;
  const comparison = bestEdge(vm);
  const soccerPickTeam = soccerPick?.side==="HOME" ? home : soccerPick?.side==="AWAY" ? away : null;
  const gapTeam = soccerPick ? soccerPickTeam : showReferenceGap ? referenceTeam : comparison.total ? null : comparison.team;
  const gapRawTeam = gapTeam === home ? game?.home : gapTeam === away ? game?.away : null;
  const gapColor = gapBrandColor(gapTeam, gapRawTeam, sportId);
  const gapTotal = !soccerPick && (showReferenceGap ? referenceLead?.kind==="total" : comparison.total);
  const gapSide = gapDirection(showReferenceGap ? referenceLead?.side : comparison.detail);
  const gapKind = gapTotal ? `is-total is-${gapSide}` : gapTeam ? `is-team${gapColor?" is-branded":""}` : "is-neutral";
  const gapUnit = ["mlb","npb","kbo"].includes(sportId) ? "RUNS" : sportId === "nhl" ? "GOALS" : "PTS";
  const gapValue = stored ? "—" : soccerPick ? soccerPick.pick || "—" : showReferenceGap
    ? `${referenceLead.absDelta} ${gapUnit} DIFFERENCE` : edge.delta;
  const gapLabel = stored ? "MARKET UNAVAILABLE" : soccerPick ? "CONFIDENCE PICK"
    : showReferenceGap ? "FBIS / PINNODDS GAP" : vm.decision?.evAvailable ? "CALIBRATED EDGE" : "MODEL / MARKET GAP";
  const gapDescription = stored ? "STORED PREGAME · NO VERIFIED ODDS" : soccerPick ? "1X2 · MODEL CONFIDENCE · NOT EV"
    : showReferenceGap ? referenceLead.kind === "spread" ? `Market: ${home.abbr} ${signed(referenceLead.offeredHome)} · FBIS: ${home.abbr} ${signed(referenceLead.modelHome)} · RESEARCH ONLY` : `Market: ${referenceLead.offeredTotal} · FBIS: ${referenceLead.modelTotal} · RESEARCH ONLY`
    : `${edge.type} · MODEL / MARKET`;
  const isTennis = sportId === "tennis";
  if (isTennis) {
    return <TennisMatchCard game={game} open={open} onToggle={onToggle} renderDetail={renderDetail} />;
  }
  const marketSideLabel = ["mlb","npb","kbo"].includes(sportId) ? "MARKET RUN LINE" : sportId === "nhl" ? "MARKET PUCK LINE" : sportId === "soccer" ? "MARKET SIDE" : "MARKET SPREAD";
  const isFinal = String(vm.status?.key || "").toUpperCase() === "FINAL" || Boolean(game?.status?.completed);
  const finalAway = game?.away?.score ?? away?.score ?? null;
  const finalHome = game?.home?.score ?? home?.score ?? null;
  const hasFinalScore = isFinal && finalAway != null && finalHome != null;
  const hasLiveScore = Boolean(vm.event?.live && finalAway != null && finalHome != null);
  const tennis = game?.tennisProjection || {};
  const tennisTour = String(game?.tour || tennis.tour || "TENNIS").toUpperCase();
  const tennisRef = game?.market?.reference || {};
  const tennisAwayMl = market.awayMl ?? tennisRef?.moneyline?.away ?? null;
  const tennisHomeMl = market.homeMl ?? tennisRef?.moneyline?.home ?? null;
  const tennisSpread = tennisRef?.spread || null;
  const tennisTotal = tennisRef?.total || null;
  const tennisSpreadLabel = tennisSpread?.home == null && tennisSpread?.away == null
    ? "—"
    : `${away.abbr} ${signed(tennisSpread?.away)} (${fmtOdds(tennisSpread?.awayPrice)}) · ${home.abbr} ${signed(tennisSpread?.home)} (${fmtOdds(tennisSpread?.homePrice)})`;
  const tennisTotalLabel = tennisTotal?.line == null
    ? "—"
    : `O ${num(tennisTotal.line)} ${fmtOdds(tennisTotal.overPrice)} · U ${num(tennisTotal.line)} ${fmtOdds(tennisTotal.underPrice)}`;
  const tennisMarketP1 = Number(tennis.marketPriorP1 ?? tennisRef?.noVig?.home);
  const tennisPureP1 = Number(tennis.player1WinProb);
  const tennisProbEdge = Number.isFinite(tennisMarketP1) && Number.isFinite(tennisPureP1)
    ? (tennisPureP1 - tennisMarketP1) * 100
    : null;
  const tennisEdgeTeam = tennisProbEdge == null ? null : tennisProbEdge >= 0 ? home : away;
  const tennisEdgeValue = tennisProbEdge == null
    ? "RESEARCH"
    : `${tennisEdgeTeam?.abbr || "EDGE"} +${num(Math.abs(tennisProbEdge))}%`;
  const tennisEdgeDelta = tennisProbEdge == null ? "NO MARKET EDGE" : "MODEL vs NO-VIG";

  return (
    <article className={`pgc pgc-featured fbis-universal-premium status-${String(vm.status?.tone || "neutral").toLowerCase()}${sportId === "mlb" ? " pgc-mlb" : ""}`} style={{"--fbis-away":teamColor(away)||"#0b5fa5","--fbis-home":teamColor(home)||"#7b1734","--cgc-away-brand":teamColor(away)||"#0b5fa5","--cgc-home-brand":teamColor(home)||"#7b1734"}}>
      <header className="pgc-featured-head">
        <div className="pgc-featured-title">
          <span aria-hidden="true">🏆</span>
          <strong>Featured Matchup</strong>
        </div>
        <div className="pgc-featured-meta">
          <span>{[vm.timing?.dateLine, vm.timing?.timeLine].filter(Boolean).join(" · ") || "—"}</span>
          <span className="pgc-sport-pill">{String(vm.sport || "").toUpperCase()}</span>
          {stored ? null : sportId !== "nhl" || proj.available ? <span title={sportId === "nhl" ? "NHL evidence rating, not wagering authority" : "Model confidence rating"}><SharpStars value={stars} max={rating.max} /></span> : <span>NO MODEL RATING</span>}
        </div>
      </header>
      {isNfl ? <NflInjuryIntegrityStrip game={game} /> : null}
      {isNfl && game.nflInternationalContext?.international ? (
        <div className="pgc-status-note" role="status" aria-label="International-game risk">
          🌍 {game.nflInternationalContext.site?.city || "INTERNATIONAL"} · INTERNATIONAL / NEUTRAL · TRAVEL NOT VALIDATED · NO BET AUTHORITY
        </div>
      ) : null}
      {sportId === "nhl" && vm.event?.live ? (
        <section className="cgc-live-nhl-score" aria-label="Live NHL score">
          <span>LIVE SCORE · PRE-GAME FORECAST BELOW</span>
          <strong>{hasLiveScore ? `${away.abbr} ${finalAway} – ${finalHome} ${home.abbr}` : "LIVE SCORE NOT AVAILABLE FROM FEED"}</strong>
        </section>
      ) : null}
      {hasFinalScore ? (
        <section className="pgc-final-score" aria-label="Final score">
          <span>FINAL SCORE</span>
          <strong><b>{away.abbr}</b> {finalAway} <i>–</i> {finalHome} <b>{home.abbr}</b></strong>
          <small>Pregame FBIS projection preserved below</small>
        </section>
      ) : null}

      <SoccerPinnOdds game={game} className="pgc-status-note" />
      <section className="pgc-featured-matchup pgc-team-atmosphere">
        {away.logoUrl ? <img className="pgc-team-watermark pgc-team-watermark-away" src={away.logoUrl} alt="" aria-hidden="true" /> : null}
        {home.logoUrl ? <img className="pgc-team-watermark pgc-team-watermark-home" src={home.logoUrl} alt="" aria-hidden="true" /> : null}
        <div className={`pgc-featured-team${sportId === "mlb" ? " pgc-featured-team-mlb" : ""}`}>
          {sportId === "mlb" ? (
            <>
              <MlbStarterMini game={game} side="away" />
              <div className="pgc-mlb-team-copy">
                <small>{game?.neutralSite ? "NEUTRAL SITE" : "AWAY"}</small>
                <strong className="pgc-featured-name">{away.fullName || away.name || away.abbr || "—"}</strong>
                {away.record ? <span className="pgc-featured-record">{away.record}</span> : null}
                <div className="pgc-mlb-score-inline">
                  <b className="pgc-featured-score">{proj.available ? (proj.away ?? "—") : "—"}</b>
                  <small>PROJ. SCORE</small>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="pgc-team-visual">
                <TeamLogo team={away} size={103} className="pgc-featured-logo" />
              </div>
              <div>
                <small>{game?.neutralSite ? "NEUTRAL SITE" : "AWAY"}</small>
                <strong className="pgc-featured-name">{away.fullName || away.name || away.abbr || "—"}</strong>
                {isTennis ? <span className="pgc-tennis-meta">{tennisPlayerMeta(away, tennisTour)}</span> : null}
                {away.record ? <span className="pgc-featured-record">{away.record}</span> : null}
                <b className="pgc-featured-score">{proj.available ? (isTennis ? `${num(proj.away)}%` : (proj.away ?? "—")) : "—"}</b>
                <small>{isTennis ? "WIN PROB." : "PROJ. SCORE"}</small>
                {proj.available && !stored && winProbabilities.find(r=>r.side==="away")?.fbisProbability!=null ? <small>{(winProbabilities.find(r=>r.side==="away").fbisProbability*100).toFixed(1)}% MODEL WIN PROB.</small> : null}
              </div>
            </>
          )}
        </div>

        <div className="pgc-featured-center">
          <span className="pgc-vs">VS</span>
          <small>{sportId === "mlb" ? "PITCH · HIT" : "FBIS MATCHUP INTELLIGENCE"}</small>
          {sportId === "mlb" ? (
            <div className="pgc-mlb-center-logos" aria-hidden="true">
              <TeamLogo team={away} size={36} />
              <TeamLogo team={home} size={36} />
            </div>
          ) : null}
        </div>

        <div className={`pgc-featured-team pgc-featured-team-home${sportId === "mlb" ? " pgc-featured-team-mlb" : ""}`}>
          {sportId === "mlb" ? (
            <>
              <MlbStarterMini game={game} side="home" />
              <div className="pgc-mlb-team-copy">
                <small>{game?.neutralSite ? "NEUTRAL SITE" : "HOME"}</small>
                <strong className="pgc-featured-name">{home.fullName || home.name || home.abbr || "—"}</strong>
                {home.record ? <span className="pgc-featured-record">{home.record}</span> : null}
                <div className="pgc-mlb-score-inline">
                  <b className="pgc-featured-score">{proj.available ? (proj.home ?? "—") : "—"}</b>
                  <small>PROJ. SCORE</small>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="pgc-team-visual">
                <TeamLogo team={home} size={103} className="pgc-featured-logo" />
              </div>
              <div>
                <small>{game?.neutralSite ? "NEUTRAL SITE" : "HOME"}</small>
                <strong className="pgc-featured-name">{home.fullName || home.name || home.abbr || "—"}</strong>
                {isTennis ? <span className="pgc-tennis-meta">{tennisPlayerMeta(home, tennisTour)}</span> : null}
                {home.record ? <span className="pgc-featured-record">{home.record}</span> : null}
                <b className="pgc-featured-score">{proj.available ? (isTennis ? `${num(proj.home)}%` : (proj.home ?? "—")) : "—"}</b>
                <small>{isTennis ? "WIN PROB." : "PROJ. SCORE"}</small>
                {proj.available && !stored && winProbabilities.find(r=>r.side==="home")?.fbisProbability!=null ? <small>{(winProbabilities.find(r=>r.side==="home").fbisProbability*100).toFixed(1)}% MODEL WIN PROB.</small> : null}
              </div>
            </>
          )}
        </div>
      </section>
      <VenueConditions context={ctx} game={game} />
      <div className="pgc-qualification" role="status">{stored ? "STORED PREGAME · STATUS UNVERIFIED" : game?.canAuthorizeWager === true && vm.decision?.qualification === "QUALIFIED" ? "QUALIFIED" : `RESEARCH ONLY · ${String(game.projectionState || "NOT QUALIFIED").replaceAll("_"," ")} · NO WAGER AUTHORITY`}</div>
      <section
        className={`pgc-gap-strip ${gapKind}`}
        style={gapColor && !gapTotal ? {"--pgc-gap-brand":gapColor} : undefined}
        aria-label={gapLabel}
      >
        <span className="pgc-gap-heading">{gapLabel}</span>
        <div className="pgc-gap-identity">
          {gapTeam ? <>
            <TeamLogo team={gapTeam} size={83} className="pgc-gap-logo" />
            <b>{gapTeam.abbr && gapTeam.abbr!=="—" ? gapTeam.abbr : gapTeam.name}</b>
          </> : gapTotal && gapSide!=="even" ? (
            <span className="pgc-gap-direction"><b aria-hidden="true">{gapSide==="over"?"↑":"↓"}</b><strong>{gapSide.toUpperCase()}</strong></span>
          ) : <span className="pgc-gap-unavailable">—</span>}
        </div>
        <strong className="pgc-gap-value">{gapValue}</strong>
        <span className="pgc-gap-description">{gapDescription}</span>
      </section>

      {["cfb","nfl","cbb","nba","wnba","nhl","mlb","npb","kbo","soccer","tennis"].includes(sportId) ? (
        <>
          {["nhl","mlb","npb","kbo"].includes(sportId) ? <MoneylinePriceComparison game={game} /> : null}
          <PinnoddsCardMarkets game={game} projection={proj} marketFamilies={["spread","total"]} />
          {["cfb","nfl","cbb","nba","wnba","soccer"].includes(sportId) ? <MoneylinePriceComparison game={game} /> : null}
        </>
      ) : (
        <>
          <section className="pgc-nfl-market" aria-label="FBIS and market summary">
            <div><span>{marketSideLabel}</span><strong>{market.spreadLabel || cmp.marketSide?.label || "—"}</strong></div>
            <div><span>FBIS TOTAL</span><strong>{proj.total ?? "—"}</strong></div>
            <div><span>MARKET TOTAL</span><strong>{market.total ?? "—"}</strong></div>
          </section>
          <MoneylinePriceComparison game={game} />
        </>
      )}
      {sportId === "cfb" ? <CfbSeasonStatStrip evidence={game.cfbSeasonEvidence} /> : null}
      {sportId === "cfb" ? <CfbProjectionReliability reliability={game.cfbProjectionReliability} game={game} /> : null}
      {!stored && sportId === "nhl" ? <NhlBettingIntelligence game={game} vm={vm} /> : null}
      {!stored && sportId === "nhl" ? <NhlMatchupSignals game={game} away={away} home={home} /> : null}
      {!stored && sportId === "mlb" ? <MlbPitchHitMatchups game={game} away={away} home={home} /> : null}
      {!stored && sportId !== "nhl" && sportId !== "mlb"
        ? sportId === "nfl"
          ? <NflDirectionalMatchups game={game} matchup={game.nflGameMatchup} away={away} home={home} />
          : sportId === "cfb"
            ? <CfbDirectionalMatchups game={game} away={away} home={home} />
            : <MatchupSignals game={game} away={away} home={home} sport={sportId} />
        : null}
      {!stored && sportId !== "nhl" && action.available ? (
        <section className={`pgc-nfl-action${action.available ? "" : " is-unavailable"}`} aria-label="ACTION market intelligence">
          <div className="pgc-nfl-action-head"><strong>ACTION</strong><span>{action.headline?.label || (action.available ? "MARKET INTEL" : action.emptyLabel || "NO SNAPSHOT")}</span></div>
          <div><span>TICKETS</span><strong>{splitLabel(action.tickets, away, home)}</strong></div>
          <div><span>MONEY</span><strong>{splitLabel(action.money, away, home)}</strong></div>
          <div><span>LINE MOVE</span><strong>{action.lineMove?.label || action.movement?.label || "Movement unavailable"}</strong></div>
        </section>
      ) : null}

      {!stored ? <AlternateLines game={game} /> : null}
      {!stored ? <><EventMarkets game={game} /><EventPlayerProps game={game} /></> : null}

      <footer className="pgc-footer pgc-featured-footer">
        <span>{referenceGap.available ? (market.available ? "Captured PinnOdds reference · Execution market shown in details" : "Captured PinnOdds reference · Current execution quote unavailable") : vm.footer?.marketSourceLabel || "Market Source: —"}</span>
        {typeof onToggle === "function" ? (
          <button type="button" className="pgc-details-btn" onClick={() => onToggle(cardKey)}>
            {open ? "Hide Details" : "View Details"} →
          </button>
        ) : (
          <span className="pgc-status-note">{vm.status?.key === "BLOCKED" ? "NOT QUALIFIED" : vm.status?.label || "—"}</span>
        )}
      </footer>

      {open ? (
        <div className="pgc-advanced">
          <AdvancedGameDetail game={game} onClose={() => onToggle?.(cardKey)} />
          {typeof renderDetail === "function" ? <div className="pgc-detail">{renderDetail(game)}</div> : null}
        </div>
      ) : null}
    </article>
  );
}
