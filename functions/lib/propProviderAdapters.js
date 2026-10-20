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
export const norm=v=>String(v||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const ctDate=v=>{const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(v)).map(p=>[p.type,p.value]));return `${parts.year}-${parts.month}-${parts.day}`;};
function teamMatch(label,abbr,name,sport) {
 const teams=registries[sport]||[];const t=teams.find(t=>String(t.abbr).toUpperCase()===String(abbr).toUpperCase());
 const location=t?.nickname&&t?.displayName?.endsWith(' '+t.nickname)?t.displayName.slice(0,-t.nickname.length).trim():null;
 return [abbr,name,t?.displayName,t?.school,t?.city,location,(sport==='nhl'&&String(abbr).toUpperCase()==='DET'?'Detroit':null),...(t?.aliases||[]),...(t?.sources?.heritage?.names||[])].filter(Boolean).some(x=>norm(x)===norm(label));
}
export function canonicalPlayerId(sport,provider,id) { return id?`${sport}:${provider}:${id}`:null; }
/** The rule date + two registry teams + unique fixture establish the event; expiry never does. */
export function mapKalshiPlayerContract(m,{games=[],players=[],capturedAt,seriesTicker}={}) {
 const spec=KALSHI_PROP_SERIES[seriesTicker];if(!spec||!String(m.ticker).startsWith(seriesTicker+'-')||m.mve_collection_ticker||m.mve_selected_legs?.length)return null;
 const [sport,stat]=spec;
 const rule=/^If (.+?) records (\d+(?:\.\d+)?)\+ (.+?) in the (.+?) vs (.+?) (?<league>Pro Basketball|Pro Football|Pro Hockey|Pro Baseball|Women\'s Pro Basketball|NHL|NFL|NBA|MLB) game originally scheduled for (?<day>[A-Z][a-z]{2} \d{1,2}, \d{4}), then the market resolves to Yes\.$/.exec(m.rules_primary||'');
 if(!rule||m.strike_type!=='greater'||number(m.floor_strike)!==Number(rule[2])-.5)return {rejected:true,reason:'CONTRACT_RULE_TEMPLATE_UNVERIFIED',id:m.ticker,sport};
 const statNames={points:['points'],rebounds:['rebounds'],assists:['assists'],three_pointers_made:['three pointers','three-pointers','threes','three-pointers made'],points_rebounds_assists:['points + rebounds + assists'],passing_yards:['passing yards'],rushing_yards:['rushing yards'],receiving_yards:['receiving yards'],receptions:['receptions'],saves:['saves'],goals:['goals'],shots_on_goal:['shots on goal'],hits:['hits'],home_runs:['home runs'],pitcher_outs:['outs recorded'],strikeouts:['strikeouts']};
 if(!(statNames[stat]||[]).some(s=>norm(s)===norm(rule[3])))return {rejected:true,reason:'STAT_DEFINITION_MISMATCH',id:m.ticker,sport};
 const leagueNames={nba:['Pro Basketball','NBA'],nfl:['Pro Football','NFL'],nhl:['Pro Hockey','NHL'],mlb:['Pro Baseball','MLB'],wnba:["Women's Pro Basketball"]};
 if(!leagueNames[sport]?.includes(rule.groups.league))return {rejected:true,reason:'LEAGUE_DEFINITION_MISMATCH',id:m.ticker,sport};
 const ruleDate=Date.parse(rule.groups.day+' 12:00:00 GMT');if(!Number.isFinite(ruleDate))return null;
 const day=new Date(ruleDate).toISOString().slice(0,10);
 const matches=games.filter(g=>g.sport===sport&&Number.isFinite(Date.parse(g.start))&&ctDate(g.start)===day&&
  ((teamMatch(rule[4],g.away_abbr,g.away_name,sport)&&teamMatch(rule[5],g.home_abbr,g.home_name,sport))||
   (teamMatch(rule[5],g.away_abbr,g.away_name,sport)&&teamMatch(rule[4],g.home_abbr,g.home_name,sport))));
 if(matches.length!==1)return {rejected:true,reason:'EXACT_EVENT_UNRESOLVED',id:m.ticker,sport};
 const game=matches[0];
 const athleteField={nba:'basketball_player',wnba:'basketball_player',nfl:'football_player',nhl:'hockey_player',mlb:'baseball_player'}[sport];
 const providerPlayerId=m.custom_strike?.[athleteField];
 const roster=players.filter(p=>p.sport===sport&&norm(p.player_name)===norm(rule[1])&&[game.home_abbr,game.away_abbr].some(a=>norm(a)===norm(p.team_key)));
 const unique=[...new Map(roster.map(p=>[String(p.player_id),p])).values()];
 // Roster team plus unique fixture plus full rule name plus provider athlete ID; never name-only.
 if(!providerPlayerId||unique.length!==1)return {rejected:true,reason:'PLAYER_ROSTER_IDENTITY_UNRESOLVED',id:m.ticker,sport};
 const player=unique[0],team=String(player.team_key).toUpperCase(),terms=[m.rules_primary,m.rules_secondary].filter(Boolean).join('\n');
 const historyProvider=sport==='nhl'?'nhl':sport==='mlb'?'mlb':'espn';
 return {id:`kalshi:${m.ticker}:yes`,provider:'Kalshi',source:'Kalshi REST',sport,canonicalEventId:String(game.id),
  canonicalPlayerId:canonicalPlayerId(sport,historyProvider,player.player_id),providerPlayerId:String(providerPlayerId),providerEventId:m.event_ticker,contractId:m.ticker,
  player_name:player.player_name,team,opponent:norm(team)===norm(game.home_abbr)?game.away_abbr:game.home_abbr,
  position:player.position||null,historyProvider,historyPlayerId:String(player.player_id),start_time:game.start,canonical_market:stat,
  line:number(m.floor_strike),trigger:Number(rule[2]),side:'yes',statSide:'over',period:'full_game',settlementTerms:terms,
  settlementScope:'OFFICIAL_GAME_PER_PROVIDER_RULES',dnpSettlement:/fair price/i.test(m.rules_secondary||'')?'FAIR_PRICE':'UNVERIFIED',
  identityVerified:true,priceVerified:false,observedAsk:number(m.yes_ask_dollars),observedBid:number(m.yes_bid_dollars),
  observedDepth:number(m.yes_ask_size_fp),contractStatus:m.status,observedAt:null,collectedAt:capturedAt,
  quoteClockStatus:'SOURCE_TIME_UNKNOWN',purchaseAsk:null,executableSize:null,fresh:false,marketAvailable:false,
  modelStatus:'UNMODELED',fbis_projection:null,calibratedProbability:null,fees:null,expectedReturn:null,
  reasons:['QUOTE_SOURCE_TIME_UNKNOWN','MODEL_UNAVAILABLE','FEES_UNVERIFIED'],canQualify:false,executionEligible:false,canAuthorizeWager:false};
}
