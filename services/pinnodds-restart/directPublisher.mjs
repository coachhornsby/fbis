import {buildDirectStaticPacket,publishStaticReference} from './staticPacket.mjs';
// No provider calls, storage, credential use or deployment. Caller supplies an
// actual sanitized acquisition receipt and fresh independent ESPN board data.
export async function prepareDirectPublication({raw,receipt,board,now=Date.now()}={}){
 if(!Array.isArray(board?.games)||board.games.length>1000)throw Error('PINNODDS_PUBLICATION_BOARD_INVALID');
 const selected=board.games.filter(g=>['nfl','cfb'].includes(g.sport)&&g.status==='scheduled'&&Date.parse(g.start)>now);
 if(!selected.length||selected.length>100||selected.some(g=>g.source!=='ESPN_SCOREBOARD'||!/^\d{6,}$/.test(g.id||'')||typeof g.home?.name!=='string'||typeof g.away?.name!=='string'||!Number.isFinite(Date.parse(g.capturedAt))||Date.parse(g.capturedAt)>now||now-Date.parse(g.capturedAt)>300000))throw Error('PINNODDS_PUBLICATION_INDEPENDENT_FIXTURES_REQUIRED');
 const fixtures=selected.map(g=>({id:g.id,sport:g.sport,start:g.start,home_name:g.home.name,away_name:g.away.name}));
 const packet=await buildDirectStaticPacket({raw,receipt,fixtures,now});
 return {board:publishStaticReference(board,packet,{now}),diagnostics:packet.diagnostics,published:false,canAuthorizeWager:false};
}
