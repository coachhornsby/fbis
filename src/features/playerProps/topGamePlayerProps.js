/**
 * Three evidence-backed, game-local player props for expanded game cards.
 * Displays model projections and paired lines when genuinely available.
 * This selector is not a betting or promotion decision engine.
 */
import {
  normalizeBoardGame, withFbisPropAnalytics, sortPropsByConviction, formatMarketLabel,
} from "./buildPlayerPropsBoard.js";
import { PRO_PLAYER_PROP_MARKETS, canonicalizeProPlayerPropMarket } from "../../../functions/lib/proPlayerProps.js";

const college = Object.freeze({
  cfb:new Set(["passing_yards","rushing_yards","receiving_yards"]),
  cbb:new Set(["points","rebounds","assists","three_pointers_made"]),
});
const normalized = s => String(s||"").toLowerCase().replace(/[^a-z0-9]+/g,"");
const finite = v => v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null;
const canonicalGameTeam = (sport,value) => {
  const abbr=String(value||'').trim().toUpperCase();
  return normalized(sport==='nba'?({SA:'SAS',NY:'NYK',GS:'GSW',NO:'NOP'}[abbr]||abbr):value);
};
const knownTeam = (game,team) => {
  if(!team)return true; // e.g. tennis singles; game evidence still required
  const actual=canonicalGameTeam(game.sport,team);
  return [game.home,game.away].some(t=>[t?.abbr,t?.name,t?.fullName,t?.school]
    .some(v=>canonicalGameTeam(game.sport,v)===actual));
};

/** Hard cap at three; never promote an unvalidated projection/line to a bet. */
export function topThreeGamePlayerProps(game={}) {
  if(!game?.id || !game?.sport || game.durableFallback) return [];
  const sport=String(game.sport).toLowerCase();
  const supported=new Set(PRO_PLAYER_PROP_MARKETS[sport]||college[sport]||[]);
  if(!supported.size)return [];
  const normalizedGame=normalizeBoardGame(game);
  const rows=[];
  for(const raw of normalizedGame.playerMarkets||[]){
    if(!raw || raw.propGate==="BLOCKED" ||
       ["OUT","IR","CONFIRMED_SCRATCH"].includes(String(raw.availabilityStatus||"").toUpperCase()))continue;
    // Reject explicitly mismatched *canonical* event identities. Provider
    // fixture IDs do not necessarily equal the FBIS event ID.
    const associated=raw.fbisEventId??raw.canonicalEventId??raw.eventId??null;
    if(associated!=null && String(associated)!==String(game.id))continue;
    if(!raw.playerName || !knownTeam(game,raw.team))continue;
    const market=canonicalizeProPlayerPropMarket(sport,raw.marketCanonical||raw.market)
      || String(raw.marketCanonical||raw.market||"").toLowerCase();
    if(!supported.has(market) || finite(raw.fbisProjection??raw.projection)==null ||
       raw.modelIndependent===false || raw.marketInformed===true)continue;
    if(sport==="tennis" && !raw.imageUrl && !raw.playerHeadshotUrl)continue;
    const line=finite(raw.line);
    const result=withFbisPropAnalytics({
      ...raw,sport,marketCanonical:market,
      fbisProjection:finite(raw.fbisProjection??raw.projection),line,
      // Do not interpret a missing line as zero or derive synthetic
      // over/under probabilities from a model-only projection.
      fbisSigma:line==null||sport==='mlb'&&raw.propCalibrationValidated!==true?null:raw.fbisSigma,
      probabilityOver:line==null||sport==='mlb'&&raw.propCalibrationValidated!==true?null:raw.probabilityOver,
      probabilityUnder:line==null||sport==='mlb'&&raw.propCalibrationValidated!==true?null:raw.probabilityUnder,
      ...(sport==='mlb'&&raw.propCalibrationValidated!==true?{probability:null}:{}),
      edge:line==null?null:raw.edge,
    });
    if(sport==='mlb'&&raw.propCalibrationValidated!==true){
      result.probabilityOver=null;result.probabilityUnder=null;
    }
    rows.push({
      ...result,marketLabel:formatMarketLabel(market),
      hasPairedLine:line!=null,
      gameId:String(game.id),
      // NBA research projections persist the exact ESPN roster athlete ID.
      // Use the same event/roster-verified history route as the main props board.
      ...(sport==='mlb'&&/^\d+$/.test(String(raw.fbisPlayerId||''))?{canonicalPlayerId:`mlb:mlb:${raw.fbisPlayerId}`,canonicalEventId:String(game.id),start_time:game.start,canonical_market:market}:{}),
      ...(sport==='nba'&&raw.projectionSource==='NBA_PLAYER_PROP_PROJECTIONS_D1'&&/^\d+$/.test(String(raw.fbisPlayerId||''))?{
        canonicalPlayerId:`nba:espn:${raw.fbisPlayerId}`,canonicalEventId:String(game.id),
        start_time:game.start,canonical_market:market,
        opponent:normalized(raw.team)===normalized(game.home?.abbr)?game.away?.abbr:game.home?.abbr,
      }:{}),
      decisionEligible:false,canQualify:false,canAuthorizeWager:false,
      displayStatus:line==null?"PROJECTION_ONLY":raw.propGate==="HOLD"?"RESEARCH_HOLD":"RESEARCH_ONLY",
    });
  }
  // One player per game card, regardless of market or provider ID spelling.
  // Rank matched, independently modeled probabilities first. A projection
  // without a comparable market threshold cannot assert a hit probability.
  const isPrizePicks = r => /prizepicks/i.test(String(r.book || r.source || r.provider || ""));
  const candidates = rows.filter(r => !isPrizePicks(r));
  const hitProbability = r => {
    if (!r.hasPairedLine) return null;
    const over = finite(r.probabilityOver);
    const under = finite(r.probabilityUnder);
    if (over == null || under == null || over < 0 || under < 0 ||
        over > 1 || under > 1 || Math.abs(over + under - 1) > 0.05) return null;
    return Math.max(over, under);
  };
  const sorted = [...candidates].sort((a, b) => {
    const ap = hitProbability(a), bp = hitProbability(b);
    if ((bp != null) !== (ap != null)) return bp != null ? 1 : -1;
    if (ap != null && bp !== ap) return bp - ap;
    // Unpriced / uncalibrated projections are context, not ranked hit picks.
    return sortPropsByConviction([a, b])[0] === a ? -1 : 1;
  });
  const seen = new Set();
  return sorted.filter(row => {
    const id = normalized(row.canonicalPlayerId || row.fbisPlayerId ||
      row.providerPlayerId || row.playerName);
    const name = normalized(row.playerName);
    // Name is also checked: one person may have several provider identifiers.
    if (!id || seen.has(id) || seen.has(name)) return false;
    seen.add(id);
    seen.add(name);
    return true;
  }).slice(0, 3);
}
