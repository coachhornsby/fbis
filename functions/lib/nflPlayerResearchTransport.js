// Derived estimates only. No source payloads, market prices, injury details or betting authority.
const MARKETS=new Set(['touchdowns','passing_yards','passing_attempts','completions','passing_touchdowns','interceptions','rushing_yards','rushing_attempts','receiving_yards','receptions','receiving_touchdowns','rushing_touchdowns']);
const KEYS=['playerId','playerName','teamId','position','market','projection','gate'];
export function validateNflPlayerResearch(value,event){
 if(!value||value.version!==1||value.state!=='HOLD_VALIDATION'||value.canAuthorizeWager!==false||value.canQualify!==false||!Array.isArray(value.rows)||value.rows.length>200||Object.keys(value).some(k=>!['version','state','canAuthorizeWager','canQualify','rows'].includes(k)))throw Error('INVALID_NFL_PLAYER_RESEARCH');
 const seen=new Set();
 for(const r of value.rows){
  if(!r||Object.keys(r).length!==KEYS.length||KEYS.some(k=>!Object.hasOwn(r,k))||typeof r.playerId!=='string'||!r.playerId.length||r.playerId.length>100||typeof r.playerName!=='string'||!r.playerName.trim()||r.playerName.length>120||!['QB','RB','WR','TE'].includes(r.position)||![event.homeId,event.awayId].includes(r.teamId)||!MARKETS.has(r.market)||typeof r.projection!=='number'||!Number.isFinite(r.projection)||r.projection<0||r.projection>1000||!['HOLD','BLOCKED'].includes(r.gate)||seen.has(r.playerId+':'+r.market))throw Error('INVALID_NFL_PLAYER_RESEARCH_ROW');
  seen.add(r.playerId+':'+r.market);
 }
 return value;
}
export function prepareNflPlayerResearch(game){
 const value={version:1,state:'HOLD_VALIDATION',canAuthorizeWager:false,canQualify:false,rows:(game.playerProjectionRows||[]).map(r=>{
  const side=[game.home,game.away].find(t=>t.abbr===r.team);if(!side)throw Error('NFL_PLAYER_TEAM_MISMATCH');
  return {playerId:String(r.playerId),playerName:r.playerName,teamId:'nfl-'+side.espnId,position:r.position,market:r.market,projection:r.fbisProjection,gate:r.propGate==='BLOCKED'?'BLOCKED':'HOLD'};
 })};
 return validateNflPlayerResearch(value,{homeId:'nfl-'+game.home.espnId,awayId:'nfl-'+game.away.espnId});
}
