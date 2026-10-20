import nba from '../../data/teams/nba.js';
import nfl from '../../data/teams/nfl.js';
import nhl from '../../data/teams/nhl.js';
import mlb from '../../data/teams/mlb.js';
import { finitePropNumber as number } from './exchangePlayerProps.js';
const registries={nba,nfl,nhl,mlb};
export const KALSHI_PROP_SERIES=Object.freeze({
 KXNBAPTS:['nba','points'],KXNBAREB:['nba','rebounds'],KXNBAAST:['nba','assists'],KXNBA3PT:['nba','three_pointers_made'],KXNBAPRA:['nba','points_rebounds_assists'],
 KXNFLPASSYDS:['nfl','passing_yards'],KXNFLRSHYDS:['nfl','rushing_yards'],KXNFLRECYDS:['nfl','receiving_yards'],KXNFLREC:['nfl','receptions'],
 KXNHLPTS:['nhl','points'],KXNHLSAVES:['nhl','saves'],KXNHLGOALS:['nhl','goals'],KXNHLSOG:['nhl','shots_on_goal'],
 KXMLBHIT:['mlb','hits'],KXMLBHR:['mlb','home_runs'],KXMLBOUTS:['mlb','pitcher_outs'],KXMLBSO:['mlb','strikeouts'],
 KXWNBAPTS:['wnba','points'],KXWNBAREB:['wnba','rebounds'],KXWNBAAST:['wnba','assists'],
});
// ESPN game registry uses SA/NY; verified NBA roster states use SAS/NYK.
// Exact fixture and canonical team identity remain mandatory before applying this crosswalk.
const NBA_ROSTER_ABBR=Object.freeze({SA:'SAS',NY:'NYK'});
export const norm=v=>String(v||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const ctDate=v=>{const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(v)).map(p=>[p.type,p.value]));return `${parts.year}-${parts.month}-${parts.day}`;};
/**
 * Resolve a provider's location label through the independent team registry.
 * The canonical team name must agree with any recognized fixture abbreviation.
 * ESPN's legacy SA/NY are not accepted as canonical roster IDs, but exact
 * verified display names identify SAS/NYK without a fuzzy name guess.
 */
function resolveTeam(label,abbr,name,sport) {
 const teams=registries[sport]||[];
 const byAbbr=teams.filter(t=>norm(t.abbr)===norm(abbr));
 const byName=teams.filter(t=>norm(t.displayName)===norm(name)||norm(t.sources?.espn?.name)===norm(name));
 if(byAbbr.length>1||byName.length>1)return null;
 const t=byAbbr[0]||byName[0];
 if(!t||(byAbbr[0]&&byName[0]&&byAbbr[0]!==byName[0]))return null;
 const location=t.nickname&&t.displayName?.endsWith(' '+t.nickname)?t.displayName.slice(0,-t.nickname.length).trim():null;
 const names=[abbr,name,t.displayName,t.school,t.city,location,
   (sport==='nhl'&&t.abbr==='DET'?'Detroit':null),
   ...(t.aliases||[]),...(t.sources?.kalshi?.names||[]),...(t.sources?.heritage?.names||[])];
 return names.some(x=>x&&norm(x)===norm(label))?t.abbr:null;
}
function verifiedMatchTeams(g,awayLabel,homeLabel,sport) {
 const forward=[resolveTeam(awayLabel,g.away_abbr,g.away_name,sport),
   resolveTeam(homeLabel,g.home_abbr,g.home_name,sport)];
 const reversed=[resolveTeam(homeLabel,g.away_abbr,g.away_name,sport),
   resolveTeam(awayLabel,g.home_abbr,g.home_name,sport)];
 for(const pair of [forward,reversed])if(pair[0]&&pair[1]&&pair[0]!==pair[1])return pair;
 return null;
}
export function canonicalPlayerId(sport,provider,id) { return id?`${sport}:${provider}:${id}`:null; }
/** The rule date + two registry teams + unique fixture establish the event; expiry never does. */
export function mapKalshiPlayerContract(m,{games=[],players=[],capturedAt,seriesTicker}={}) {
 const spec=KALSHI_PROP_SERIES[seriesTicker];if(!spec||!String(m.ticker).startsWith(seriesTicker+'-')||m.mve_collection_ticker||m.mve_selected_legs?.length)return null;
 const [sport,stat]=spec;
 const rule=/^If (.+?) records (\d+(?:\.\d+)?)\+ (.+?) in the (.+?) vs (.+?) (?<league>Pro Basketball|Pro Football|Pro Hockey|Pro Baseball|Women\'s Pro Basketball|NHL|NFL|NBA|MLB) game originally scheduled for (?<day>[A-Z][a-z]{2} \d{1,2}, \d{4}), then the market resolves to Yes\.$/.exec(m.rules_primary||'');
 if(!rule||m.strike_type!=='greater'||number(m.floor_strike)!==Number(rule[2])-.5)return {rejected:true,reason:'CONTRACT_RULE_TEMPLATE_UNVERIFIED',id:m.ticker,sport};
 const statNames={points:['points'],rebounds:['rebounds'],assists:['assists'],three_pointers_made:['three pointers','three-pointers','threes','three-pointers made','made three-pointers'],points_rebounds_assists:['points + rebounds + assists','combined points, rebounds, and assists'],passing_yards:['passing yards'],rushing_yards:['rushing yards'],receiving_yards:['receiving yards'],receptions:['receptions'],saves:['saves'],goals:['goals'],shots_on_goal:['shots on goal'],hits:['hits'],home_runs:['home runs'],pitcher_outs:['outs recorded'],strikeouts:['strikeouts']};
 if(!(statNames[stat]||[]).some(s=>norm(s)===norm(rule[3])))return {rejected:true,reason:'STAT_DEFINITION_MISMATCH',id:m.ticker,sport};
 const leagueNames={nba:['Pro Basketball','NBA'],nfl:['Pro Football','NFL'],nhl:['Pro Hockey','NHL'],mlb:['Pro Baseball','MLB'],wnba:["Women's Pro Basketball"]};
 if(!leagueNames[sport]?.includes(rule.groups.league))return {rejected:true,reason:'LEAGUE_DEFINITION_MISMATCH',id:m.ticker,sport};
 const ruleDate=Date.parse(rule.groups.day+' 12:00:00 GMT');if(!Number.isFinite(ruleDate))return null;
 const day=new Date(ruleDate).toISOString().slice(0,10);
 const matches=games.filter(g=>g.sport===sport&&Number.isFinite(Date.parse(g.start))&&
  ctDate(g.start)===day&&verifiedMatchTeams(g,rule[4],rule[5],sport));
 if(matches.length!==1)return {rejected:true,reason:'EXACT_EVENT_UNRESOLVED',id:m.ticker,sport};
 const game=matches[0],canonicalTeams=verifiedMatchTeams(game,rule[4],rule[5],sport);
 if(!canonicalTeams)return {rejected:true,reason:'REGISTERED_TEAM_IDENTITY_UNRESOLVED',id:m.ticker,sport};
 const athleteField={nba:'basketball_player',wnba:'basketball_player',nfl:'football_player',nhl:'hockey_player',mlb:'baseball_player'}[sport];
 const providerPlayerId=m.custom_strike?.[athleteField];
 const keys=canonicalTeams.map((abbr,i)=>new Set([
  abbr,i===0?game.away_abbr:game.home_abbr,
  sport==='nba'?NBA_ROSTER_ABBR[abbr]:null,
 ].filter(Boolean).map(norm)));
 const roster=players.filter(p=>p.sport===sport&&norm(p.player_name)===norm(rule[1])&&
  keys.some(set=>set.has(norm(p.team_key))));
 const unique=[...new Map(roster.map(p=>[String(p.player_id),p])).values()];
 // Roster team plus unique fixture plus full rule name plus provider athlete ID; never name-only.
 if(!providerPlayerId||unique.length!==1)return {rejected:true,reason:'PLAYER_ROSTER_IDENTITY_UNRESOLVED',id:m.ticker,sport};
 const player=unique[0],rosterKey=norm(player.team_key);
 const indices=keys.flatMap((set,i)=>set.has(rosterKey)?[i]:[]);
 if(indices.length!==1)return {rejected:true,reason:'PLAYER_ROSTER_TEAM_UNRESOLVED',id:m.ticker,sport};
 const rosterIndex=indices[0];
 const canonicalRosterTeam=i=>sport==='nba'?(NBA_ROSTER_ABBR[canonicalTeams[i]]||canonicalTeams[i]):canonicalTeams[i];
 const team=canonicalRosterTeam(rosterIndex),opponent=canonicalRosterTeam(1-rosterIndex);
 const terms=[m.rules_primary,m.rules_secondary].filter(Boolean).join('\n');
 const historyProvider=sport==='nhl'?'nhl':sport==='mlb'?'mlb':'espn';
 return {id:`kalshi:${m.ticker}:yes`,provider:'Kalshi',source:'Kalshi REST',sport,canonicalEventId:String(game.id),
  canonicalPlayerId:canonicalPlayerId(sport,historyProvider,player.player_id),providerPlayerId:String(providerPlayerId),providerEventId:m.event_ticker,contractId:m.ticker,
  player_name:player.player_name,home_abbr:String(game.home_abbr).toUpperCase(),away_abbr:String(game.away_abbr).toUpperCase(),team,opponent,
  position:player.position||null,historyProvider,historyPlayerId:String(player.player_id),start_time:game.start,canonical_market:stat,
  line:number(m.floor_strike),trigger:Number(rule[2]),side:'yes',statSide:'over',period:'full_game',settlementTerms:terms,
  settlementScope:'OFFICIAL_GAME_PER_PROVIDER_RULES',dnpSettlement:/last fair market price before game start/i.test(m.rules_secondary||'')?'ACTIVE_NO_APPEARANCE_LAST_FAIR_PRICE':/fair price/i.test(m.rules_secondary||'')?'FAIR_PRICE':'UNVERIFIED',
  identityVerified:true,priceVerified:false,observedAsk:number(m.yes_ask_dollars),observedBid:number(m.yes_bid_dollars),
  observedDepth:number(m.yes_ask_size_fp),contractStatus:m.status,observedAt:null,collectedAt:capturedAt,
  quoteClockStatus:'SOURCE_TIME_UNKNOWN',purchaseAsk:null,executableSize:null,fresh:false,marketAvailable:false,
  modelStatus:'UNMODELED',fbis_projection:null,calibratedProbability:null,fees:null,expectedReturn:null,
  reasons:['QUOTE_SOURCE_TIME_UNKNOWN','MODEL_UNAVAILABLE','FEES_UNVERIFIED'],canQualify:false,executionEligible:false,canAuthorizeWager:false};
}
