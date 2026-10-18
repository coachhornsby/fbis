import VenueConditions from "./VenueConditions.jsx";
import SoccerPinnOdds from "./SoccerPinnOdds.jsx";
import EventPlayerProps from "./EventPlayerProps.jsx";
import EventMarkets from "./EventMarkets.jsx";
import MoneylinePriceComparison from "./MoneylinePriceComparison.jsx";
import PinnoddsCardMarkets from "./PinnoddsCardMarkets.jsx";
import {pinnoddsReferenceDifference} from "../../lib/pinnoddsReferenceDifference.js";
import { lineLabel, bestEdge, evidenceNumber } from "../../lib/boardEvidence.js";
import TeamLogo from "../TeamLogo.jsx";
import NhlBettingIntelligence from "./NhlBettingIntelligence.jsx";
import NflDirectionalMatchups from "./NflDirectionalMatchups.jsx";
import NflInjuryIntegrityStrip from "./NflInjuryIntegrityStrip.jsx";
import CfbDirectionalMatchups from "./CfbDirectionalMatchups.jsx";

import { buildGameCardViewModel } from "../../lib/gameCardViewModel.js";
import MatchupSignals from "./MatchupSignals.jsx";
import NhlMatchupSignals from "./NhlMatchupSignals.jsx";
import { confidenceStars } from "../../lib/confidenceStars.js";
import { gapBrandColor } from "../../lib/marketGapBrand.js";
import { matchupSignalColors } from "../../lib/matchupTeamBrand.js";
import "./compactGameCardEnhancements.css";
import "./universalPremiumCard.css";

function Stars({ value = 1 }) {
  const safe = Math.max(1, Math.min(5, Number(value) || 1));
  return (
    <span className="cgc-star-row" aria-label={`${safe} of 5 confidence stars`}>
      {Array.from({ length: 5 }, (_, i) => (
        i < safe ? <svg key={i} className="filled" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.2l2.95 5.98 6.6.96-4.78 4.66 1.13 6.58L12 17.28l-5.9 3.1 1.13-6.58-4.78-4.66 6.6-.96L12 2.2z" /></svg> : null
      ))}
    </span>
  );
}

function TotalGapDirection({ side }) {
  const direction = String(side || "").toLowerCase();
  if (direction !== "over" && direction !== "under") return <div className="cgc-total-mark">EVEN</div>;
  return (
    <span className={`cgc-total-direction is-${direction}`} role="img" aria-label={`${direction.toUpperCase()} projected game total compared with market`}>
      <span className="cgc-total-direction-arrow" aria-hidden="true">{direction === "over" ? "↑" : "↓"}</span>
      <span className="cgc-total-direction-label" aria-hidden="true">{direction.toUpperCase()}</span>
    </span>
  );
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

function starterInitials(name) {
  return String(name || "SP").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "SP";
}

function MlbStarterMini({ game, side }) {
  const sp = mlbStarterInfo(game, side);
  if (!sp.name && sp.era == null) return null;
  const record = sp.wins != null && sp.losses != null ? `${sp.wins}-${sp.losses}` : null;
  const era = Number.isFinite(Number(sp.era)) ? `${Number(sp.era).toFixed(2)} ERA` : null;
  const image = sp.id ? `/api/mlb-headshot?id=${encodeURIComponent(sp.id)}` : null;
  return (
    <div className="cgc-mlb-starter" aria-label={[`Starter ${sp.name || "TBD"}`, record, era].filter(Boolean).join(", ")}>
      <span className="cgc-starter-avatar cgc-starter-bubble" aria-hidden="true">
        <span>{starterInitials(sp.name)}</span>
        {image ? <img src={image} alt="" width="44" height="44" loading="lazy" referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.display = "none"; }} /> : null}
      </span>
      <span className="cgc-starter-copy">
        <strong title={sp.name || "TBD"}>{sp.name || "TBD"}</strong>
        <span>{[record, era].filter(Boolean).join(" · ") || "Starter"}</span>
      </span>
    </div>
  );
}

function actionSplitLabel(split, away, home) {
  if (!split) return "—";
  const awayPct = Number(split.awayPct);
  const homePct = Number(split.homePct);
  if (!Number.isFinite(awayPct) || !Number.isFinite(homePct)) return "—";
  if (homePct >= awayPct) return `${home.abbr || "HOME"} ${Math.round(homePct)}%`;
  return `${away.abbr || "AWAY"} ${Math.round(awayPct)}%`;
}

function actionMoveLabel(action, away, home) {
  const open = evidenceNumber(action?.movement?.open);
  const current = evidenceNumber(action?.movement?.current);
  if (Number.isFinite(open) && Number.isFinite(current) && Math.abs(current - open) < 0.05) {
    const team = current < 0 ? home : away;
    const teamLine = current < 0 ? current : -current;
    return `NO MOVE · ${lineLabel(team, teamLine)}`;
  }
  if (action?.lineMove?.label) return action.lineMove.label;
  if (action?.movement?.label) return action.movement.label;
  if (action?.consensus?.spreadHome != null) {
    const s = Number(action.consensus.spreadHome);
    const team = s < 0 ? home : away;
    const teamLine = s < 0 ? s : -s;
    return `CURRENT · ${lineLabel(team, teamLine)}`;
  }
  return "Movement unavailable";
}

function normalizeTeamColor(team, fallback) {
  const raw = team?.color || team?.primaryColor || team?.primary_color || team?.brandColor || "";
  const value = String(raw).trim();
  if (/^#?[0-9a-f]{6}$/i.test(value)) return value.startsWith("#") ? value : `#${value}`;
  if (/^#?[0-9a-f]{3}$/i.test(value)) return value.startsWith("#") ? value : `#${value}`;
  return fallback;
}

export default function CompactGameCard({ game, onOpen }) {
  const vm = buildGameCardViewModel(game);
  const stored = game?.durableFallback?.statusUnverified === true;
  const stars = stored ? null : confidenceStars(game);
  const away = vm.away || {};
  const home = vm.home || {};
  const awayBrand = normalizeTeamColor(away, "#0b5fa5");
  const homeBrand = normalizeTeamColor(home, "#7b1734");
  const matchupAtmosphere = {
    "--cgc-away-brand": awayBrand,
    "--cgc-home-brand": homeBrand,
  };
  const proj = vm.projection || {};
  const market = vm.market || {};
  const action = vm.action || {};
  const sportId = String(vm.sport || game?.sport || "").toLowerCase();
  const isNfl = sportId === "nfl";
  const isCfb = sportId === "cfb";
  const isFootball = isNfl || isCfb;
  const isNhl = sportId === "nhl";
  const showStars = !isNhl || proj.available;
  const showAction = true; // Keep compact-card information architecture consistent across sports.
  const marketSideLabel = ["mlb","npb","kbo"].includes(sportId) ? "MARKET RUN LINE" : sportId === "nhl" ? "MARKET PUCK LINE" : sportId === "soccer" ? "MARKET SIDE" : "MARKET SPREAD";
  const edge = bestEdge(vm);
  const referenceGap = pinnoddsReferenceDifference(game,proj);
  const referenceLead = referenceGap.leading;
  const showReferenceGap = !stored && !vm.decision?.evAvailable && referenceGap.available;
  const referenceTeam = showReferenceGap && referenceLead?.kind === "spread"
    ? referenceLead.side === "home" ? home : referenceLead.side === "away" ? away : null : null;
  const gapTotalSide = String(showReferenceGap ? referenceLead?.side : edge.detail || "").toLowerCase();
  const gapIsTotal = showReferenceGap ? referenceLead?.kind === "total" : edge.total;
  const matchup = isNfl ? game?.nflGameMatchup : null;
  const isFinal = String(vm.status?.key || "").toUpperCase() === "FINAL" || Boolean(game?.status?.completed);
  const finalAway = game?.away?.score ?? away?.score ?? null;
  const finalHome = game?.home?.score ?? home?.score ?? null;
  const hasFinalScore = isFinal && finalAway != null && finalHome != null;
  const hasLiveScore = Boolean(vm.event?.live && finalAway != null && finalHome != null);
  const soccerPick = String(vm.sport || game?.sport || "").toLowerCase() === "soccer"
    ? (game?.soccerConfidence || game?.confidencePick || game?.soccerFbis?.confidencePick || null)
    : null;
  const soccerPickTeam = soccerPick?.side === "HOME" ? home : soccerPick?.side === "AWAY" ? away : null;
  // Never use the projected winner as a substitute for the verified spread-side gap.
  // Soccer has 1X2 confidence picks rather than a modeled point-spread gap.
  const gapTeam = soccerPick ? soccerPickTeam : showReferenceGap ? referenceTeam : !edge.total ? edge.team : null;
  const rawGapTeam = gapTeam === away ? game?.away : gapTeam === home ? game?.home : null;
  const gapTeamColor = gapBrandColor(gapTeam, rawGapTeam, sportId);
  const gapTeamLabel = gapTeam?.abbr && gapTeam.abbr !== "—" ? gapTeam.abbr : gapTeam?.name || null;
  const gapUnit = ["mlb","npb","kbo"].includes(sportId) ? "RUNS" : sportId === "nhl" ? "GOALS" : "PTS";

  const gapPresentationClass = !soccerPick && gapIsTotal
    ? ` cgc-gap-total cgc-gap-total-${gapTotalSide === "over" || gapTotalSide === "under" ? gapTotalSide : "even"}`
    : gapTeam ? ` cgc-gap-team${gapTeamColor ? " cgc-gap-team-branded" : ""}`
    : !soccerPick ? " cgc-gap-neutral" : "";
  const gapPalette = gapTeam && !gapIsTotal ? matchupSignalColors(rawGapTeam || gapTeam, sportId) : null;
  const gapPresentationStyle = gapTeamColor && !gapIsTotal ? { "--cgc-gap-brand": gapPalette?.primary || gapTeamColor, "--cgc-gap-secondary": gapPalette?.secondary || gapPalette?.primary || gapTeamColor } : undefined;



  return (
    <article
      className={"cgc pgc fbis-universal-premium"+(stars===5&&showStars&&!stored?" cgc-five-star":"")+(stored?" cgc-stored":"")}
      data-game-id={vm.id || game?.id || ""}
      data-sport={vm.sport || ""}
      tabIndex={0}
      role="button"
      onClick={() => onOpen?.(game)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen?.(game);
        }
      }}
      aria-label={`Open ${away.abbr && away.abbr!=="—"?away.abbr:away.name||"away"} at ${home.abbr && home.abbr!=="—"?home.abbr:home.name||"home"} analysis`}
    >
      <header className="cgc-head">
        <div className="cgc-head-left">
          <span className="cgc-sport-pill">{String(vm.sport || "").toUpperCase()}</span>
          <span className="cgc-time">{vm.timing?.timeLine || "—"}</span>
        </div>
        <div className="cgc-head-right">
          {stored ? null : showStars ? <span title={isNhl ? "Model confidence rating, not a qualified betting signal" : "Model confidence rating"}><Stars value={stars} /></span> : <span className="cgc-rating-unavailable">NO MODEL RATING</span>}
          <span className={`cgc-status cgc-status-${String(vm.status?.tone || "neutral").toLowerCase()}`}>
            {vm.status?.label || "FBIS"}
          </span>
        </div>
      </header>

      {isNfl ? <NflInjuryIntegrityStrip game={game} /> : null}
      {isNfl && game.nflInternationalContext?.international ? (
        <div className="cgc-status-note" role="status" aria-label="International-game risk">
          🌍 {game.nflInternationalContext.site?.city || "INTERNATIONAL"} · INTERNATIONAL / NEUTRAL · TRAVEL NOT VALIDATED · NO BET AUTHORITY
        </div>
      ) : null}

      {isNhl && vm.event?.live ? (
        <section className="cgc-live-nhl-score" aria-label="Live NHL score">
          <span>LIVE SCORE · PRE-GAME FORECAST IS SHOWN BELOW</span>
          <strong>{hasLiveScore ? `${away.abbr} ${finalAway} – ${finalHome} ${home.abbr}` : "LIVE SCORE NOT AVAILABLE FROM FEED"}</strong>
        </section>
      ) : null}

      {hasFinalScore ? (
        <section className="cgc-final-score" aria-label="Final score">
          <span>FINAL SCORE</span>
          <strong><b>{away.abbr}</b> {finalAway} <i>–</i> {finalHome} <b>{home.abbr}</b></strong>
          <small>vs FBIS {proj.available ? `${proj.away ?? "—"}–${proj.home ?? "—"}` : "projection"}</small>
        </section>
      ) : null}

      <div className="cgc-main">
        <div className="cgc-matchup cgc-team-atmosphere" style={matchupAtmosphere}>
          {away.logoUrl ? <img className="cgc-team-watermark cgc-team-watermark-away" src={away.logoUrl} alt="" aria-hidden="true" /> : null}
          {home.logoUrl ? <img className="cgc-team-watermark cgc-team-watermark-home" src={home.logoUrl} alt="" aria-hidden="true" /> : null}
          <div className="cgc-team-block">
            <TeamLogo team={away} size={83} className={`cgc-logo${sportId === "mlb" ? " cgc-logo-mlb" : ""}`} />
            {sportId === "mlb" ? (
              <strong className="cgc-team-name cgc-team-name-mlb">{away.fullName || away.name || away.abbr || "—"}</strong>
            ) : (
              <>
                <strong className={`cgc-team-name fbis-full-team-name${!away.abbr||away.abbr==="—"?" cgc-unresolved-school":""}`}>{away.fullName || away.name || away.abbr || "—"}</strong>
              </>
            )}
            {sportId === "mlb" ? <MlbStarterMini game={game} side="away" /> : null}
            <strong className="cgc-proj">{proj.available ? (proj.away ?? "—") : "—"}</strong>
            <span>{stored ? "STORED PREGAME" : isNhl ? "PREGAME PROJ." : "FBIS SCORE"}</span>
          </div>

          <span className="cgc-vs">VS</span>

          <div className="cgc-team-block">
            <TeamLogo team={home} size={83} className={`cgc-logo${sportId === "mlb" ? " cgc-logo-mlb" : ""}`} />
            {sportId === "mlb" ? (
              <strong className="cgc-team-name cgc-team-name-mlb">{home.fullName || home.name || home.abbr || "—"}</strong>
            ) : (
              <>
                <strong className={`cgc-team-name fbis-full-team-name${!home.abbr||home.abbr==="—"?" cgc-unresolved-school":""}`}>{home.fullName || home.name || home.abbr || "—"}</strong>
              </>
            )}
            {sportId === "mlb" ? <MlbStarterMini game={game} side="home" /> : null}
            <strong className="cgc-proj">{proj.available ? (proj.home ?? "—") : "—"}</strong>
            <span>{stored ? "STORED PREGAME" : isNhl ? "PREGAME PROJ." : "FBIS SCORE"}</span>
          </div>
        </div>

        {stored ? (
          <aside className="cgc-best-edge cgc-stored-market" aria-label="No verified market">
            <span>MARKET UNAVAILABLE</span>
            <div className="cgc-edge-identity" aria-hidden="true" />
            <strong>—</strong>
            <b>No verified odds</b>
            <small>STORED PREGAME · NO EDGE</small>
          </aside>
        ) : (
        <aside className={`cgc-best-edge${soccerPick ? " is-side" : gapIsTotal ? " is-total" : " is-side"}${gapPresentationClass}`} style={gapPresentationStyle}>
          <span>{soccerPick ? "CONFIDENCE PICK" : showReferenceGap ? "FBIS / PINNODDS GAP" : isNhl && !proj.available ? "NO PURE PROJECTION" : vm.decision?.evAvailable ? "CALIBRATED EDGE" : isNhl && market.referenceOnly ? "MODEL / REFERENCE GAP" : "MODEL / MARKET GAP"}</span>
          <div className="cgc-edge-identity">
            {soccerPick ? (
              soccerPickTeam ? <TeamLogo team={soccerPickTeam} size={83} className="cgc-edge-logo" /> : <div className="cgc-total-mark">DRAW</div>
            ) : showReferenceGap ? (
              referenceLead?.kind === "total"
                ? <TotalGapDirection side={referenceLead.side} />
                : referenceTeam ? <><TeamLogo team={referenceTeam} size={83} className="cgc-edge-logo" /><span className="cgc-gap-side-name">{gapTeamLabel}</span></>
                : <div className="cgc-total-mark">EVEN</div>
            ) : edge.team ? (
              <><TeamLogo team={edge.team} size={83} className="cgc-edge-logo" /><span className="cgc-gap-side-name">{gapTeamLabel}</span></>
            ) : edge.total ? (
              <TotalGapDirection side={edge.detail} />
            ) : null}
          </div>
          <strong>{soccerPick ? `${stars}★` : showReferenceGap ? `${referenceLead.absDelta} ${gapUnit} DIFFERENCE` : edge.value}</strong>
          <b>{soccerPick ? soccerPick.pick || "—" : showReferenceGap ? <span className="cgc-gap-quote-stack"><span>Market: {referenceLead.kind === "total" ? referenceLead.offeredTotal : `${home.abbr} ${referenceLead.offeredHome > 0 ? "+" : ""}${referenceLead.offeredHome}`}</span><span>FBIS: {referenceLead.kind === "total" ? referenceLead.modelTotal : `${home.abbr} ${referenceLead.modelHome > 0 ? "+" : ""}${referenceLead.modelHome}`}</span></span> : edge.detail}</b>
          <small>{soccerPick ? "1X2 · MODEL CONFIDENCE" : showReferenceGap ? "CAPTURED LINE · NOT EV" : isNhl ? `${edge.type} · RESEARCH ONLY` : edge.type}</small>
        </aside>
        )}
      </div>

      {!stored ? <VenueConditions context={vm.context} game={game} compact /> : null}

    </article>
  );
}
