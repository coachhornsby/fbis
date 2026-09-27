const LEAGUES={nfl:["football","nfl"],mlb:["baseball","mlb"],nba:["basketball","nba"],nhl:["hockey","nhl"]};

function norm(s){return String(s||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();}
function num(v){const n=Number(String(v??"").replace(/,/g,""));return Number.isFinite(n)?n:null;}
function nameMatch(a,b){const x=norm(a),y=norm(b);return x===y || (x&&y&&(x.includes(y)||y.includes(x)));}

function statMap(summary, playerName){
  const out={};
  for(const team of summary?.boxscore?.players||[]){
    for(const group of team.statistics||[]){
      const labels=group.labels||group.names||[];
      for(const row of group.athletes||[]){
        const name=row.athlete?.displayName||row.athlete?.fullName||row.athlete?.shortName;
        if(!nameMatch(name,playerName)) continue;
        const stats=row.stats||row.statistics||[];
        labels.forEach((label,i)=>{ const v=num(stats[i]); if(v!=null) out[`${norm(group.name)}|${norm(label)}`]=v; });
        for(const [k,v] of Object.entries(row.stats||{})){const n=num(v);if(n!=null)out[`${norm(group.name)}|${norm(k)}`]=n;}
      }
    }
  }
  return out;
}
function pick(map,patterns){for(const [k,v] of Object.entries(map)){if(patterns.some(p=>p.test(k)))return v;}return null;}
function valueFor(sport,type,map){
 const t=norm(type).replace(/ /g,"_");
 const p=(...xs)=>pick(map,xs);
 if(sport==="nfl"){
  if(/pass_yards/.test(t)) return p(/passing.*yds/,/passing.*yards/);
  if(/pass_attempt/.test(t)) return p(/passing.*att/,/passing.*attempt/);
  if(/completion/.test(t)) return p(/passing.*cmp/,/passing.*comp/);
  if(/pass_touchdown/.test(t)) return p(/passing.*td/);
  if(/interception/.test(t)) return p(/passing.*int/);
  if(/rush_yards/.test(t)) return p(/rushing.*yds/,/rushing.*yards/);
  if(/rush_attempt/.test(t)) return p(/rushing.*car/,/rushing.*att/);
  if(/receiv.*yards/.test(t)) return p(/receiving.*yds/,/receiving.*yards/);
  if(/reception/.test(t)) return p(/receiving.*rec/);
  if(/touchdown/.test(t)) {const vals=Object.entries(map).filter(([k])=>/(rushing|receiving).*(td|touchdown)/.test(k)).map(([,v])=>v);return vals.length?vals.reduce((a,b)=>a+b,0):null;}
 }
 if(sport==="mlb"){
  if(/strikeout/.test(t)) return p(/pitching.*k\b/,/pitching.*so\b/,/pitching.*strikeout/);
  if(t==="hits") return p(/batting.*h\b/,/batting.*hits/);
  if(/total_bases/.test(t)) return p(/batting.*tb\b/,/batting.*total bases/);
  if(/home_run/.test(t)) return p(/batting.*hr\b/,/batting.*home run/);
  if(/rbis?/.test(t)) return p(/batting.*rbi/);
  if(t==="runs") return p(/batting.*r\b/,/batting.*runs/);
  if(/stolen/.test(t)) return p(/batting.*sb\b/,/batting.*stolen/);
  if(/earned_runs/.test(t)) return p(/pitching.*er\b/,/pitching.*earned/);
  if(/hits_allowed/.test(t)) return p(/pitching.*h\b/,/pitching.*hits/);
  if(/walks_allowed/.test(t)) return p(/pitching.*bb\b/,/pitching.*walk/);
  if(/pitcher_outs/.test(t)){const ip=p(/pitching.*ip\b/,/pitching.*innings/);if(ip==null)return null;const whole=Math.trunc(ip),frac=Math.round((ip-whole)*10);return whole*3+Math.min(2,frac);}
 }
 if(sport==="nba"){
  const pts=p(/statistics.*pts\b/,/.*points/),reb=p(/statistics.*reb\b/,/.*rebounds/),ast=p(/statistics.*ast\b/,/.*assists/);
  if(t==="points")return pts;if(t==="rebounds")return reb;if(t==="assists")return ast;
  if(/points_rebounds_assists/.test(t)&&[pts,reb,ast].every(x=>x!=null))return pts+reb+ast;
  if(/points_rebounds$/.test(t)&&pts!=null&&reb!=null)return pts+reb;
  if(/points_assists/.test(t)&&pts!=null&&ast!=null)return pts+ast;
  if(/rebounds_assists/.test(t)&&reb!=null&&ast!=null)return reb+ast;
  if(/three/.test(t))return p(/statistics.*3pm/,/.*three.*made/);
  if(t==="steals")return p(/statistics.*stl/,/.*steals/);if(t==="blocks")return p(/statistics.*blk/,/.*blocks/);if(t==="turnovers")return p(/statistics.*to\b/,/.*turnovers/);
 }
 if(sport==="nhl"){
  if(/shots/.test(t))return p(/skaters.*s\b/,/.*shots/);if(t==="goals")return p(/skaters.*g\b/,/.*goals/);
  if(t==="assists")return p(/skaters.*a\b/,/.*assists/);if(t==="points"){const g=valueFor(sport,"goals",map),a=valueFor(sport,"assists",map);return g!=null&&a!=null?g+a:null;}
  if(t==="saves")return p(/goalies.*sv\b/,/.*saves/);
 }
 return null;
}

export async function fetchPlayerPropActual(ticket,{fetchImpl=fetch}={}){
 const sport=String(ticket.sport||"").toLowerCase(), league=LEAGUES[sport];
 if(!league) return {ok:false,reason:"unsupported-sport"};
 const eventId=String(ticket.gameId||ticket.sourceEventId||"").trim();
 if(!eventId) return {ok:false,reason:"missing-event-id"};
 const url=`https://site.api.espn.com/apis/site/v2/sports/${league[0]}/${league[1]}/summary?event=${encodeURIComponent(eventId)}`;
 const res=await fetchImpl(url,{headers:{accept:"application/json"}});
 if(!res.ok)return {ok:false,reason:`espn-http-${res.status}`};
 const summary=await res.json();
 const completed=summary?.header?.competitions?.[0]?.status?.type?.completed===true || /final/i.test(summary?.header?.competitions?.[0]?.status?.type?.description||"");
 if(!completed)return {ok:false,reason:"event-not-final"};
 const map=statMap(summary,ticket.playerName||ticket.selectedTeam);
 if(!Object.keys(map).length)return {ok:false,reason:"player-not-found"};
 const actual=valueFor(sport,ticket.propType,map);
 if(actual==null)return {ok:false,reason:"stat-not-found"};
 return {ok:true,actual,source:"ESPN box score",sourceUrl:url,eventId};
}
