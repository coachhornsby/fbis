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
const knownTeam = (game,team) => {
  if(!team)return true; // e.g. tennis singles; game evidence still required
  const actual=normalized(team);
  return [game.home,game.away].some(t=>[t?.abbr,t?.name,t?.fullName,t?.school].some(v=>normalized(v)===actual));
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
      fbisSigma:line==null?null:raw.fbisSigma,
      probabilityOver:line==null?null:raw.probabilityOver,
      probabilityUnder:line==null?null:raw.probabilityUnder,
      edge:line==null?null:raw.edge,
    });
    rows.push({
      ...result,marketLabel:formatMarketLabel(market),
      hasPairedLine:line!=null,
      gameId:String(game.id),
      decisionEligible:false,canQualify:false,canAuthorizeWager:false,
      displayStatus:line==null?"PROJECTION_ONLY":raw.propGate==="HOLD"?"RESEARCH_HOLD":"RESEARCH_ONLY",
    });
  }
  // Prefer Standard PrizePicks lines so embedded cards match Player Props / Board.
  const isStandard=(r)=>String(r.oddsTier||r.odds_tier||"standard").toLowerCase()==="standard";
  const isPrizePicks=(r)=>{
    const book=String(r.book||r.source||"").toLowerCase();
    return book.includes("prizepicks")||book==="prizepicks_apify";
  };
  const standardPp=rows.filter((r)=>isPrizePicks(r)&&isStandard(r)&&r.hasPairedLine);
  const paired=rows.filter((r)=>r.hasPairedLine);
  const pool=standardPp.length?standardPp:paired.length?paired:rows;
  const sorted=sortPropsByConviction(pool);
  const seen=new Set();
  return sorted.filter(row=>{
    const id=normalized(row.fbisPlayerId||row.providerPlayerId||row.playerName);
    const key=[id,normalized(row.marketCanonical)].join("|");
    if(seen.has(key))return false;
    seen.add(key);
    return true;
  }).slice(0,3);
}
