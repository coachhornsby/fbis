// Display only verified model fields or observed scores; never infer market odds.
export function recoveryCardFacts(game, now=Date.now()) {
 const p=game?.recoveryVerifiedProjection;
 const fresh=Boolean(p&&[p.awayScore,p.homeScore,p.margin,p.total].every(Number.isFinite)&&
   Date.parse(p.expiresAt)>now&&game.status==='scheduled'&&Date.parse(game.start)>now);
 const actual=Boolean(['live','final'].includes(game?.status)&&
   [game.away?.score,game.home?.score].every(Number.isFinite));
 const winner=fresh?(p.margin>0?game.home:p.margin<0?game.away:null):null;
 const historical=game?.recoveryHistoricalProjection;
 const savedProjection=['live','final'].includes(game?.status)&&historical&&
  [historical.awayScore,historical.homeScore].every(Number.isFinite)?historical:null;
 return {fresh,actual,savedProjection,awayScore:actual?game.away.score:fresh?p.awayScore:null,
   homeScore:actual?game.home.score:fresh?p.homeScore:null,
   total:fresh?p.total:null,
   fairSpread:fresh?(winner?(winner.abbr||winner.name)+' −'+Math.abs(p.margin).toFixed(1):'Pick’em'):null};
}
