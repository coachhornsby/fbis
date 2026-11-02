/** Pure dated official-schedule corrections. No provider calls or trading authority. */
export function applyCbbOfficialFixture(game,record,now=Date.now()){
 if(!record||game.sport!=='cbb'||game.id!==record.eventId||game.date!==record.date)return game;
 if(String(game.home?.espnId)!==record.homeEspnId||String(game.away?.espnId)!==record.awayEspnId||game.neutralSite!==record.neutralSite)return game;
 let source;try{source=new URL(record.sourceUrl);}catch{return game;}
 if(!Array.isArray(record.remainingHolds))return game;
 const time=Number(now),review=Date.parse(record.reviewedAt),expiry=Date.parse(record.expiresAt),resolved=Date.parse(record.resolvedStart),original=Date.parse(record.originalStart),start=Date.parse(game.start);
 if(![time,review,expiry,resolved,original,start].every(Number.isFinite)||time<review||time>=expiry||expiry<=review||source.protocol!=='https:')return game;
 if(start!==original&&start!==resolved)return game; // A new reschedule requires a new review.
 return {...game,start:record.resolvedStart,officialSchedule:{decision:record.decision,sourceUrl:record.sourceUrl,reviewedAt:record.reviewedAt,originalStart:record.originalStart,remainingHolds:[...(record.remainingHolds||[])],canAuthorizeWager:false}};
}
export function applyCbbOfficialSlate(games,packet,now=Date.now()){
 if(packet?.version!==1||!Array.isArray(packet.records))return games;
 const ids=packet.records.map(x=>x.eventId);if(new Set(ids).size!==ids.length)return games;
 const byId=new Map(packet.records.map(x=>[x.eventId,x]));return games.map(g=>packet.date===g.date?applyCbbOfficialFixture(g,byId.get(g.id),now):g);
}
