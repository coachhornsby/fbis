import { MLB_COMPETITIVE_TYPES, mlbInningsToOuts, MLB_HISTORY_VERSION } from './mlbPlayerHistory.js';
export const MLB_FEATURE_VERSION='mlb-boxscore-features-v1';
const n=v=>v==null||v===''||!Number.isFinite(Number(v))?null:Number(v);
const ratio=(a,b)=>a!=null&&b>0?a/b:null;
/** Normalize a finalized official feed. Team identities come from this game, never today's roster. */
export function normalizeMlbGameFeed(feed,{observedAt=new Date().toISOString(),sourceHash}={}) {
 const info=feed.gameData||{},game=info.game||{},box=feed.liveData?.boxscore;
 if(!game.pk||!sourceHash||info.status?.abstractGameState!=='Final'||info.status?.codedGameState!=='F'||!MLB_COMPETITIVE_TYPES.includes(game.type)||!box)throw Error('FINAL_COMPETITIVE_GAME_REQUIRED');
 const players=[],pitches=[];
 for(const side of ['home','away']){
  const team=box.teams?.[side],opponent=box.teams?.[side==='home'?'away':'home'];
  if(!team?.team?.id||!opponent?.team?.id)throw Error('GAME_TEAM_IDENTITIES_REQUIRED');
  for(const player of Object.values(team.players||{})){
   const id=player.person?.id;if(!id)continue;
   for(const group of ['batting','pitching','fielding']){
    const stats=player.stats?.[group];if(!stats||!Object.keys(stats).length)continue;
    const appeared=group==='batting'?n(stats.plateAppearances)>0:group==='pitching'?(n(stats.battersFaced)>0||n(stats.numberOfPitches)>0):n(stats.gamesStarted)>0||n(stats.assists)>0||n(stats.putOuts)>0||n(stats.errors)>0;
    if(!appeared)continue;
    players.push({playerId:String(id),playerName:player.person.fullName,group,teamId:String(team.team.id),opponentId:String(opponent.team.id),isHome:side==='home',position:player.position?.abbreviation,battingOrder:player.battingOrder||null,starter:group==='pitching'?String(team.pitchers?.[0])===String(id):player.gameStatus?.isSubstitute===false,stats:{...stats,...(group==='pitching'?{outs:mlbInningsToOuts(stats.inningsPitched)}:{})}});
   }
  }
 }
 for(const play of feed.liveData?.plays?.allPlays||[])for(const event of play.playEvents||[])if(event.isPitch){
  pitches.push({gameId:String(game.pk),inning:play.about?.inning,half:play.about?.halfInning,plateAppearance:play.about?.atBatIndex,pitchNumber:event.pitchNumber,eventIndex:event.index,batterId:String(play.matchup?.batter?.id||''),pitcherId:String(play.matchup?.pitcher?.id||''),batterHand:play.matchup?.batSide?.code,pitcherHand:play.matchup?.pitchHand?.code,pitchType:event.details?.type?.code,result:event.details?.code,description:event.details?.description,...event.pitchData,hitData:event.hitData||null});
 }
 return {version:MLB_HISTORY_VERSION,gameId:String(game.pk),season:Number(game.season),gameType:game.type,officialDate:info.datetime?.officialDate,start:info.datetime?.dateTime,observedAt,sourceHash,source:`https://statsapi.mlb.com/api/v1.1/game/${game.pk}/feed/live`,players,pitches};
}
/** Ratios retain their actual operands and coverage. Unsupported metrics stay absent. */
export function mlbBoxscoreFeatures(records,{asOf,observedBefore=asOf}={}) {
 const eligible=records.filter(r=>Date.parse(r.date)<Date.parse(asOf)&&Date.parse(r.observedAt)<=Date.parse(observedBefore)).sort((a,b)=>Date.parse(b.observedAt)-Date.parse(a.observedAt));
 const seen=new Set();const rows=eligible.filter(r=>{const key=[r.playerId,r.gameId,r.group].join(':');if(seen.has(key))return false;seen.add(key);return true;});
 const sum=(group,key)=>{const xs=rows.filter(r=>r.group===group).map(r=>n(r.stats?.[key]));return xs.length&&xs.every(v=>v!=null)?xs.reduce((a,b)=>a+b,0):null;};
 const metric=(numerator,denominator)=>({value:ratio(numerator,denominator),numerator,denominator,sampleGames:rows.length});
 const h=sum('batting','hits'),ab=sum('batting','atBats'),bb=sum('batting','baseOnBalls'),hbp=sum('batting','hitByPitch'),sf=sum('batting','sacFlies'),pa=sum('batting','plateAppearances'),tb=sum('batting','totalBases'),k=sum('batting','strikeOuts'),hr=sum('batting','homeRuns');
 const validSum=(...xs)=>xs.every(x=>x!=null)?xs.reduce((a,b)=>a+b,0):null;
 const outs=sum('pitching','outs'),er=sum('pitching','earnedRuns'),ph=sum('pitching','hits'),pb=sum('pitching','baseOnBalls'),pk=sum('pitching','strikeOuts'),bf=sum('pitching','battersFaced');
 return {version:MLB_FEATURE_VERSION,asOf,observedBefore,sampleGames:new Set(rows.map(r=>r.gameId)).size,gameTypes:[...new Set(rows.map(r=>r.gameType))],
  hitter:{AVG:metric(h,ab),OBP:metric(validSum(h,bb,hbp),validSum(ab,bb,hbp,sf)),SLG:metric(tb,ab),ISO:metric(tb!=null&&h!=null?tb-h:null,ab),BABIP:metric(h!=null&&hr!=null?h-hr:null,ab!=null&&k!=null&&hr!=null&&sf!=null?ab-k-hr+sf:null),K:metric(k,pa),BB:metric(bb,pa)},
  pitcher:{ERA:metric(er==null?null:er*27,outs),WHIP:metric(ph==null||pb==null?null:(ph+pb)*3,outs),K:metric(pk,bf),BB:metric(pb,bf),K9:metric(pk==null?null:pk*27,outs),BB9:metric(pb==null?null:pb*27,outs)},
  coverage:{records:rows.length,statcast:false,pointInTimePolicy:'RESULT_DATE_AND_SOURCE_OBSERVED_CUTOFF',smallSample:rows.length<20},canAuthorizeWager:false};
}
