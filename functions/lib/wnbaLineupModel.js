const finite=v=>{if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null};
const round=(v,d=4)=>{const n=finite(v);if(n==null)return null;const p=10**d;return Math.round(n*p)/p};
const norm=s=>String(s||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();

export function normalizeEspnPlay(play={}){
  const type=String(play?.type?.text||play?.type?.abbreviation||play?.type||"");
  const text=String(play?.text||play?.shortText||"");
  const participants=(play?.participants||[]).map(x=>({
    id:String(x?.athlete?.id||x?.id||""),
    name:x?.athlete?.displayName||x?.displayName||null,
  })).filter(x=>x.id||x.name);
  const period=Number(play?.period?.number||play?.period||0)||null;
  return {
    id:String(play?.id||""),
    sequenceNumber:finite(play?.sequenceNumber),
    period,
    clock:play?.clock?.displayValue||play?.clock||null,
    type,
    typeId:finite(play?.type?.id??play?.typeId),
    text,
    teamId:String(play?.team?.id||play?.teamId||""),
    shootingPlay:Boolean(play?.shootingPlay),
    scoringPlay:Boolean(play?.scoringPlay),
    scoreValue:finite(play?.scoreValue)||0,
    homeScore:finite(play?.homeScore),
    awayScore:finite(play?.awayScore),
    coordinate:{
      x:finite(play?.coordinate?.x??play?.coordinates?.x??play?.x),
      y:finite(play?.coordinate?.y??play?.coordinates?.y??play?.y),
    },
    participants,
  };
}

export function parseSubstitution(play={}){
  const p=normalizeEspnPlay(play),t=norm(p.type+" "+p.text);
  const isSub=/substitution|enters (the )?game|checks in|replaces/.test(t);
  if(!isSub)return null;
  let playerIn=null,playerOut=null;
  if(p.participants.length>=2){
    playerIn=p.participants[0];playerOut=p.participants[1];
  }
  const m=p.text.match(/(.+?)\s+(?:enters the game|checks in)\s+for\s+(.+?)(?:\.|$)/i);
  if(m){
    playerIn=playerIn||{id:"",name:m[1].trim()};
    playerOut=playerOut||{id:"",name:m[2].trim()};
  }
  return {playId:p.id,period:p.period,clock:p.clock,teamId:p.teamId,playerIn,playerOut,text:p.text};
}

function byName(players=[]){return new Map(players.map(p=>[norm(p.name||p.displayName),String(p.id||p.playerId||"")]).filter(x=>x[0]&&x[1]))}
function clockSeconds(clock){
  const m=String(clock||"").match(/(\d+):(\d+(?:\.\d+)?)/);return m?Number(m[1])*60+Number(m[2]):null;
}
function elapsed(period,clock){
  const p=Number(period||1),q=p<=4?600:300,c=clockSeconds(clock);
  let before=0;for(let i=1;i<p;i++)before+=i<=4?600:300;
  return before+(q-(c??q));
}

export function reconstructLineupStints({
  plays=[],homeTeamId,awayTeamId,homePlayers=[],awayPlayers=[]
}={}){
  const homeName=byName(homePlayers),awayName=byName(awayPlayers);
  const starters=arr=>arr.filter(p=>p.starter).slice(0,5).map(p=>String(p.id||p.playerId||""));
  let home=starters(homePlayers),away=starters(awayPlayers);
  const playerTeamById={};
  for(const p of homePlayers)playerTeamById[String(p.id||p.playerId||"")]=String(homeTeamId);
  for(const p of awayPlayers)playerTeamById[String(p.id||p.playerId||"")]=String(awayTeamId);
  const normalized=(plays||[]).map(normalizeEspnPlay).sort((a,b)=>{
    const ea=elapsed(a.period,a.clock),eb=elapsed(b.period,b.clock);
    if(ea!==eb)return ea-eb;
    return (a.sequenceNumber??0)-(b.sequenceNumber??0);
  });
  const out=[];let lastElapsed=0,lastHomeScore=0,lastAwayScore=0;
  const emit=(toElapsed,reason)=>{
    if(home.length!==5||away.length!==5){lastElapsed=toElapsed;return}
    const pointDiff=(lastHomeScore??0)-(lastAwayScore??0);
    const prev=out.at(-1);
    const base={startElapsed:lastElapsed,endElapsed:toElapsed,durationSeconds:Math.max(0,toElapsed-lastElapsed),
      homePlayers:[...home],awayPlayers:[...away],homeTeamId:String(homeTeamId),awayTeamId:String(awayTeamId),playerTeamById:{...playerTeamById},reason};
    if(base.durationSeconds>0){
      if(prev&&prev.homePlayers.join(",")===base.homePlayers.join(",")&&prev.awayPlayers.join(",")===base.awayPlayers.join(",")){
        prev.endElapsed=base.endElapsed;prev.durationSeconds+=base.durationSeconds;
      }else out.push(base);
    }
    lastElapsed=toElapsed;
  };
  for(const p of normalized){
    const e=elapsed(p.period,p.clock);
    if(p.homeScore!=null)lastHomeScore=p.homeScore;
    if(p.awayScore!=null)lastAwayScore=p.awayScore;
    const raw={...p,participants:p.participants};
    const sub=parseSubstitution(raw);if(!sub)continue;
    emit(e,"SUBSTITUTION");
    const team=String(sub.teamId||"");
    const isHome=team===String(homeTeamId);
    const lineup=isHome?home:away,nameMap=isHome?homeName:awayName;
    const resolve=x=>String(x?.id||nameMap.get(norm(x?.name))||"");
    const inn=resolve(sub.playerIn),outId=resolve(sub.playerOut);
    if(outId){const i=lineup.indexOf(outId);if(i>=0)lineup.splice(i,1)}
    if(inn&&!lineup.includes(inn)&&lineup.length<5)lineup.push(inn);
  }
  const maxPeriod=Math.max(4,...normalized.map(p=>Number(p.period||0)).filter(Number.isFinite));
  const gameEnd=2400+Math.max(0,maxPeriod-4)*300;
  emit(gameEnd,maxPeriod>4?"END_OVERTIME":"END_REGULATION");
  return out;
}

export function attachStintOutcomes(stints=[],plays=[]){
  const normPlays=(plays||[]).map(normalizeEspnPlay).sort((a,b)=>elapsed(a.period,a.clock)-elapsed(b.period,b.clock));
  return (stints||[]).map(s=>{
    const ps=normPlays.filter(p=>{const e=elapsed(p.period,p.clock);return e>=s.startElapsed&&e<s.endElapsed});
    let homePts=0,awayPts=0,poss=0;
    for(const p of ps){
      if(p.scoringPlay&&p.scoreValue){
        if(String(p.teamId)===String(s.homeTeamId))homePts+=p.scoreValue;
        if(String(p.teamId)===String(s.awayTeamId))awayPts+=p.scoreValue;
      }
      const t=norm(p.type+" "+p.text);
      if(/turnover|defensive rebound|made .*shot|made free throw/.test(t))poss+=.5;
    }
    const duration=s.durationSeconds||0;
    const possessionEstimate=poss>0?poss:duration/14.4;
    return {...s,homePoints:homePts,awayPoints:awayPts,pointDifferential:homePts-awayPts,possessions:round(possessionEstimate)};
  }).filter(s=>s.durationSeconds>0);
}

export function aggregateLineupEffects(stints=[],minPossessions=20){
  const agg=new Map();
  for(const s of stints||[]){
    const poss=finite(s.possessions),diff=finite(s.pointDifferential);if(!poss||diff==null)continue;
    for(const [side,players,sign] of [["home",s.homePlayers,1],["away",s.awayPlayers,-1]]){
      const ids=[...(players||[])].map(String).sort();
      const keys=[
        ["five",ids.join("|")],
        ...ids.map(id=>["player",id])
      ];
      for(let i=0;i<ids.length;i++)for(let j=i+1;j<ids.length;j++)keys.push(["pair",[ids[i],ids[j]].join("|")]);
      for(let i=0;i<ids.length;i++)for(let j=i+1;j<ids.length;j++)for(let k=j+1;k<ids.length;k++)keys.push(["trio",[ids[i],ids[j],ids[k]].join("|")]);
      for(const [kind,key] of keys){
        const mapKey=kind+":"+key;if(!agg.has(mapKey))agg.set(mapKey,{kind,key,possessions:0,diff:0});
        const a=agg.get(mapKey);a.possessions+=poss;a.diff+=sign*diff;
      }
    }
  }
  return [...agg.values()].map(a=>({...a,net100:round(100*a.diff/a.possessions),shrunkNet100:round((100*a.diff/a.possessions)*(a.possessions/(a.possessions+80)))}))
    .filter(a=>a.possessions>=minPossessions);
}

export function teammateWithWithout(stints=[],playerId,teammateId){
  const p=String(playerId),t=String(teammateId);
  let withPoss=0,withDiff=0,withoutPoss=0,withoutDiff=0;
  for(const s of stints||[]){
    const poss=finite(s.possessions),diff=finite(s.pointDifferential);if(!poss||diff==null)continue;
    for(const [players,sign] of [[s.homePlayers,1],[s.awayPlayers,-1]]){
      const ids=(players||[]).map(String);if(!ids.includes(p))continue;
      if(ids.includes(t)){withPoss+=poss;withDiff+=sign*diff}else{withoutPoss+=poss;withoutDiff+=sign*diff}
    }
  }
  return {
    playerId:p,teammateId:t,withPossessions:round(withPoss),withoutPossessions:round(withoutPoss),
    withNet100:withPoss?round(100*withDiff/withPoss):null,
    withoutNet100:withoutPoss?round(100*withoutDiff/withoutPoss):null,
    delta:withPoss&&withoutPoss?round(100*withDiff/withPoss-100*withoutDiff/withoutPoss):null,
  };
}
