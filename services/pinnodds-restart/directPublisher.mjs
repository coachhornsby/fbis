import {buildDirectStaticPacket,publishStaticReference} from './staticPacket.mjs';
// No provider calls, storage, credential use or deployment. Caller supplies an
// actual sanitized acquisition receipt and fresh independent ESPN board data.
export async function prepareDirectPublication({raw,receipt,board,fixtureProofs,now=Date.now()}={}){
 if(!Array.isArray(board?.games)||board.games.length>1000)throw Error('PINNODDS_PUBLICATION_BOARD_INVALID');
 let fixtures;
 if(fixtureProofs!==undefined){
  if(!Array.isArray(fixtureProofs)||!fixtureProofs.length||fixtureProofs.length>100)throw Error('PINNODDS_PUBLICATION_INDEPENDENT_FIXTURES_REQUIRED');
  fixtures=fixtureProofs.map(p=>{
   const expectedUrl='https://site.api.espn.com/apis/site/v2/sports/football/'+(p?.sport==='nfl'?'nfl':'college-football')+'/summary?event='+p?.id;
   const at=Date.parse(p?.receivedAt),start=Date.parse(p?.start);
   if(p?.source!=='ESPN_SUMMARY'||p.httpStatus!==200||!['nfl','cfb'].includes(p.sport)||!/^\d{6,}$/.test(p.id||'')||p.sourceUrl!==expectedUrl||p.status!=='scheduled'||!Number.isFinite(start)||start<=now||!Number.isFinite(at)||at>now||now-at>300000||typeof p.home_name!=='string'||typeof p.away_name!=='string')throw Error('PINNODDS_PUBLICATION_INDEPENDENT_FIXTURES_REQUIRED');
   const games=board.games.filter(g=>g.id===p.id&&g.sport===p.sport&&g.status==='scheduled'&&Date.parse(g.start)===start&&g.home?.name===p.home_name&&g.away?.name===p.away_name);
   if(games.length!==1)throw Error('PINNODDS_PUBLICATION_FIXTURE_IDENTITY_MISMATCH');
   return {id:p.id,sport:p.sport,start:p.start,home_name:p.home_name,away_name:p.away_name};
  });
 }else{
  const selected=board.games.filter(g=>['nfl','cfb'].includes(g.sport)&&g.status==='scheduled'&&Date.parse(g.start)>now);
  if(!selected.length||selected.length>100||selected.some(g=>g.source!=='ESPN_SCOREBOARD'||!/^\d{6,}$/.test(g.id||'')||typeof g.home?.name!=='string'||typeof g.away?.name!=='string'||!Number.isFinite(Date.parse(g.capturedAt))||Date.parse(g.capturedAt)>now||now-Date.parse(g.capturedAt)>300000))throw Error('PINNODDS_PUBLICATION_INDEPENDENT_FIXTURES_REQUIRED');
  fixtures=selected.map(g=>({id:g.id,sport:g.sport,start:g.start,home_name:g.home.name,away_name:g.away.name}));
 }
 const packet=await buildDirectStaticPacket({raw,receipt,fixtures,now});
 return {board:publishStaticReference(board,packet,{now}),diagnostics:packet.diagnostics,published:false,canAuthorizeWager:false};
}
