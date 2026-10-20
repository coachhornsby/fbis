import { norm } from './propProviderAdapters.js';
const validPlayer=x=>/^\d{7}$/.test(String(x||''));
const validGame=x=>/^\d{10}$/.test(String(x||''));
const abbr=x=>/^[A-Z]{3}$/.test(String(x||''));
const teamId=t=>String(t?.abbrev||'').toUpperCase();
const fullName=p=>norm([(p.firstName?.default||p.firstName||''),(p.lastName?.default||p.lastName||'')].join(' '));
/** Exact identity certification for NHL outcome extraction ONLY, never exchange settlement. */
export function verifyNhlSourceScope(contract,officialSchedule,officialRoster,{observedAt}={}){
 const blocked=reason=>({ok:false,reason,certified:false,canAuthorizeWager:false});
 if(contract?.sport!=='nhl'||contract?.provider!=='Kalshi'||contract.identityVerified!==true)
  return blocked('EXCHANGE_CONTRACT_IDENTITY_UNVERIFIED');
 const playerId=String(contract.historyPlayerId||''),start=Date.parse(contract.start_time);
 const collected=Date.parse(contract.collectedAt),now=Date.parse(observedAt);
 if(!validPlayer(playerId)||contract.canonicalPlayerId!=='nhl:nhl:'+playerId||
    !contract.canonicalEventId||!contract.contractId||!contract.providerEventId||
    !Number.isFinite(start)||!Number.isFinite(collected)||!Number.isFinite(now)||
    collected>now||now>=start||collected>=start)return blocked('PREGAME_CANONICAL_IDENTITY_REQUIRED');
 const home=String(contract.home_abbr||''),away=String(contract.away_abbr||'');
 const team=String(contract.team||''),opponent=String(contract.opponent||'');
 if(!abbr(home)||!abbr(away)||!abbr(team)||!abbr(opponent)||
    ![home,away].includes(team)||![home,away].includes(opponent)||team===opponent)
  return blocked('CANONICAL_FIXTURE_TEAMS_REQUIRED');
 const matches=(officialSchedule?.gameWeek||[]).flatMap(w=>w.games||[]).filter(g=>
  validGame(g.id)&&g.gameType===2&&
  teamId(g.homeTeam)===home&&teamId(g.awayTeam)===away&&
  Number.isFinite(Date.parse(g.startTimeUTC))&&Math.abs(Date.parse(g.startTimeUTC)-start)<=5*60000);
 if(matches.length!==1)return blocked('NHL_OFFICIAL_FIXTURE_UNRESOLVED');
 const roster=Object.entries({forwards:officialRoster?.forwards||[],defense:officialRoster?.defensemen||[],goalies:officialRoster?.goalies||[]})
  .flatMap(([role,ps])=>ps.map(p=>({role,player:p}))).filter(x=>String(x.player.id)===playerId);
 if(roster.length!==1||fullName(roster[0].player)!==norm(contract.player_name))return blocked('NHL_OFFICIAL_PLAYER_UNRESOLVED');
 if(contract.canonical_market==='saves'&&roster[0].role!=='goalies')return blocked('GOALIE_STAT_MISMATCH');
 if(contract.canonical_market!=='saves'&&roster[0].role==='goalies')return blocked('SKATER_STAT_MISMATCH');
 if(!['shots_on_goal','goals','assists','points','saves'].includes(contract.canonical_market)||
    contract.period!=='full_game')return blocked('STAT_SCOPE_UNSUPPORTED');
 const gameId=String(matches[0].id);
 return {ok:true,certified:true,scope:{
  gameId,playerId,canonicalEventId:String(contract.canonicalEventId),
  canonicalPlayerId:contract.canonicalPlayerId,stat:contract.canonical_market,
  period:'full_game',identityVerified:true,
  identityBasis:'NHL_OFFICIAL_SCHEDULE_AND_ROSTER',sourceVerifiedAt:observedAt,
  sourceFixtureStart:matches[0].startTimeUTC,homeAbbr:home,awayAbbr:away,
  contractId:contract.contractId,providerEventId:contract.providerEventId,
  providerPlayerId:contract.providerPlayerId,settlementRuleVerified:false
 },canQualify:false,canAuthorizeWager:false};
}
