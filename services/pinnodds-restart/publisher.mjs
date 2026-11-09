// Trusted source-to-static boundary. Returns a board; does not publish or write.
import {loadTrustedArchive} from './loadArchive.mjs';
import {publishStaticReference} from './staticPacket.mjs';
export async function prepareTrustedPublication(env,{board,now=Date.now(),admit}={}){
 if(!Array.isArray(board?.games)||board.games.length>1000)throw Error('PINNODDS_PUBLICATION_BOARD_INVALID');
 const selected=board.games.filter(g=>['nfl','cfb'].includes(g.sport)&&g.status==='scheduled'&&Date.parse(g.start)>now);
 if(!selected.length||selected.length>100||selected.some(g=>g.source!=='ESPN_SCOREBOARD'||!/^\d{6,}$/.test(g.id||'')||typeof g.home?.name!=='string'||typeof g.away?.name!=='string'||!Number.isFinite(Date.parse(g.capturedAt))||Date.parse(g.capturedAt)>now||now-Date.parse(g.capturedAt)>300000))throw Error('PINNODDS_PUBLICATION_INDEPENDENT_FIXTURES_REQUIRED');
 const fixtures=selected.map(g=>({id:g.id,sport:g.sport,start:g.start,home_name:g.home.name,away_name:g.away.name}));
 const loaded=await loadTrustedArchive(env,{fixtures,now,admit});
 return {board:publishStaticReference(board,loaded.packet,{now}),budget:loaded.budget,published:false,canAuthorizeWager:false};
}
