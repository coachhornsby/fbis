/**
 * SOCCER-FBIS-v3 research challenger.
 *
 * PitchAPI is an independent football-data feature layer. Market prices never
 * enter this model. Every historical target is predicted from team state built
 * strictly from earlier completed matches; the classifier updates only after
 * the result is observed.
 */
import { normalizeSoccerName, loadPitchApiHistory, loadEligiblePitchApiLineups, findPitchApiFixture } from "./soccerPitchApiStore.js";

export const SOCCER_FBIS_V3_ID="SOCCER-FBIS-v3";
export const SOCCER_FBIS_V3_VERSION="research-v1.1-pitchapi-full-reference";
const MIN_LEAGUE=80,MIN_TEAM=8,LR=.03,L2=.0008;
const FIELDS=[
 ["xg",1.2],["npxg",1.1],["xgot",1],["xg_per_shot",.12],["sot",3],
 ["field_tilt",20],["final_third_entries",35],["box_entries",15],
 ["ppda",6],["avg_defensive_action_x",10],["high_turnovers",6],["counterpress_regains",7],["ball_recovery_time",8],
 ["xt",.6],["vaep",.4],["progressive_passes",25],["progressive_pass_distance",350],["passes_into_box",12],
 ["progressive_carries",15],["carries_into_final_third",12],["carries_into_box",7],["xag",1],
 ["possession",20],["pass_accuracy",10],["passes_per_sequence",2],["direct_speed",1],
 ["buildup_attacks",7],["direct_attacks",6],["network_centralization",.18],
];
function n(v){const x=Number(v);return Number.isFinite(x)?x:null;}
function clamp(v,a,b){return Math.max(a,Math.min(b,Number(v)));}
function softmax(z){const m=Math.max(...z),e=z.map(x=>Math.exp(x-m)),s=e.reduce((a,b)=>a+b,0)||1;return e.map(x=>x/s);}
function teamKey(id,name){return id?String(id):normalizeSoccerName(name);}
function empty(){return{games:0,gf:0,ga:0,metrics:Object.fromEntries(FIELDS.map(([f])=>[f,{for:0,against:0,n:0}]))};}
function avg(x){return x.n?x.for/x.n:null;}function avgAgainst(x){return x.n?x.against/x.n:null;}
function col(row,side,f){
  const map={
    xg:"xg",npxg:"npxg",xgot:"xgot",xg_per_shot:"xg_per_shot",sot:"sot",
    field_tilt:"field_tilt",final_third_entries:"final_third_entries",box_entries:"box_entries",
    ppda:"ppda",avg_defensive_action_x:"avg_defensive_action_x",high_turnovers:"high_turnovers",counterpress_regains:"counterpress_regains",ball_recovery_time:"ball_recovery_time",
    xt:"xt",vaep:"vaep",progressive_passes:"progressive_passes",progressive_pass_distance:"progressive_pass_distance",passes_into_box:"passes_into_box",
    progressive_carries:"progressive_carries",carries_into_final_third:"carries_into_final_third",carries_into_box:"carries_into_box",xag:"xag",
    possession:"possession",pass_accuracy:"pass_accuracy",passes_per_sequence:"passes_per_sequence",direct_speed:"direct_speed",
    buildup_attacks:"buildup_attacks",direct_attacks:"direct_attacks",network_centralization:"network_centralization"
  };
  return n(row?.[`${side}_${map[f]}`]);
}
function addTeam(t,row,side){
  const opp=side==="home"?"away":"home";t.games++;t.gf+=n(row[`${side}_score`])||0;t.ga+=n(row[`${opp}_score`])||0;
  for(const [f] of FIELDS){const a=col(row,side,f),b=col(row,opp,f);if(a!=null&&b!=null){t.metrics[f].for+=a;t.metrics[f].against+=b;t.metrics[f].n++;}}
}
function feature(state,homeKey,awayKey){
  const h=state.teams.get(homeKey)||empty(),a=state.teams.get(awayKey)||empty(),out=[];
  for(const [f,scale] of FIELDS){
    const hm=h.metrics[f],am=a.metrics[f];
    let hv=avg(hm),av=avg(am);
    if(f==="ppda"||f==="ball_recovery_time"){const x=hv;hv=av;av=x;}
    out.push(hv==null||av==null?0:clamp((hv-av)/scale,-3,3));
    const hd=avg(hm),haa=avgAgainst(hm),ad=avg(am),aaa=avgAgainst(am);
    if(["xg","npxg","xgot","xg_per_shot","sot","xt","vaep","xag","passes_into_box","carries_into_box"].includes(f)) out.push([hd,haa,ad,aaa].some(x=>x==null)?0:clamp(((hd-haa)-(ad-aaa))/scale,-3,3));
  }
  out.push(clamp((h.games-a.games)/20,-1,1));
  return{vector:out,homeGames:h.games,awayGames:a.games};
}
function classifier(d){return{w:Array.from({length:3},()=>Array(d+1).fill(0)),updates:0,loss:0};}
function predict(m,x){const xx=[1,...x],z=m.w.map(w=>w.reduce((s,v,i)=>s+v*xx[i],0));return softmax(z);}
function update(m,x,y){const xx=[1,...x],p=predict(m,x);for(let c=0;c<3;c++){const e=(c===y?1:0)-p[c];for(let j=0;j<xx.length;j++)m.w[c][j]+=LR*(e*xx[j]-(j?L2*m.w[c][j]:0));}m.updates++;m.loss+=-Math.log(Math.max(1e-9,p[y]));}
function outcome(h,a){return h>a?0:h===a?1:2;}
function stateFrom(rows=[],cutoff="9999-12-31"){
  const d=FIELDS.length+["xg","npxg","xgot","xg_per_shot","sot","xt","vaep","xag","passes_into_box","carries_into_box"].length+1,state={teams:new Map(),model:null,matches:0,coverage:0};
  state.model=classifier(d);
  for(const r of [...rows].filter(x=>String(x.match_date)<cutoff).sort((a,b)=>String(a.match_date).localeCompare(String(b.match_date)))){
    const hk=teamKey(r.home_team_id,r.home_team_name),ak=teamKey(r.away_team_id,r.away_team_name);
    if(!state.teams.has(hk))state.teams.set(hk,empty());if(!state.teams.has(ak))state.teams.set(ak,empty());
    const f=feature(state,hk,ak);const hs=n(r.home_score),as=n(r.away_score);
    if(hs!=null&&as!=null&&f.homeGames>=3&&f.awayGames>=3)update(state.model,f.vector,outcome(hs,as));
    addTeam(state.teams.get(hk),r,"home");addTeam(state.teams.get(ak),r,"away");state.matches++;
    const present=FIELDS.filter(([name])=>col(r,"home",name)!=null&&col(r,"away",name)!=null).length;
    state.coverage+=present/FIELDS.length;
  }
  return state;
}
function findTeam(state,name){const k=normalizeSoccerName(name);for(const [id,t] of state.teams){if(normalizeSoccerName(t.name||"")===k)return[id,t];}return null;}
function matchIds(rows,game){
  const h=normalizeSoccerName(game?.home?.name||game?.homeTeam||""),a=normalizeSoccerName(game?.away?.name||game?.awayTeam||"");
  const exact=[...rows].reverse().find(r=>normalizeSoccerName(r.home_team_name)===h&&normalizeSoccerName(r.away_team_name)===a);
  if(exact)return[teamKey(exact.home_team_id,exact.home_team_name),teamKey(exact.away_team_id,exact.away_team_name),exact.pitch_match_id];
  const ht=[...rows].reverse().find(r=>normalizeSoccerName(r.home_team_name)===h||normalizeSoccerName(r.away_team_name)===h);
  const at=[...rows].reverse().find(r=>normalizeSoccerName(r.home_team_name)===a||normalizeSoccerName(r.away_team_name)===a);
  return[ht?teamKey(normalizeSoccerName(ht.home_team_name)===h?ht.home_team_id:ht.away_team_id,h):h,at?teamKey(normalizeSoccerName(at.home_team_name)===a?at.home_team_id:at.away_team_id,a):a,null];
}
export function projectSoccerV3(game,v2,rows=[]){
  const cutoff=String(game.start||game.date||"").slice(0,10);if(!v2?.ok)return{ok:false,reason:"v2-required",modelId:SOCCER_FBIS_V3_ID};
  const state=stateFrom(rows,cutoff),[hk,ak,pitchMatchId]=matchIds(rows,game),f=feature(state,hk,ak);
  const active=state.matches>=MIN_LEAGUE&&Math.min(f.homeGames,f.awayGames)>=MIN_TEAM&&state.model.updates>=50;
  if(!active)return{ok:false,reason:"insufficient-pitchapi-history",modelId:SOCCER_FBIS_V3_ID,historyMatches:state.matches,classifierUpdates:state.model.updates,homeHistory:f.homeGames,awayHistory:f.awayGames};
  const p=predict(state.model,f.vector),w=clamp(.72+(state.coverage/state.matches<.55?.08:0),.62,.82);
  const probs=[w*v2.pHomeWin+(1-w)*p[0],w*v2.pDraw+(1-w)*p[1],w*v2.pAwayWin+(1-w)*p[2]],s=probs.reduce((a,b)=>a+b,0);
  return{ok:true,modelId:SOCCER_FBIS_V3_ID,modelVersion:SOCCER_FBIS_V3_VERSION,pHomeWin:probs[0]/s,pDraw:probs[1]/s,pAwayWin:probs[2]/s,
    marketInformed:false,canQualify:false,canAuthorize:false,maturity:"RESEARCH",pitchMatchId,
    pitchapi:{classifier:{pHome:p[0],pDraw:p[1],pAway:p[2],updates:state.model.updates,trainingLogLoss:state.model.loss/state.model.updates},
      coverage:state.matches?state.coverage/state.matches:0,historyMatches:state.matches,homeHistory:f.homeGames,awayHistory:f.awayGames,
      featureFamilies:["shot-quality","chance-type","pressing","defensive-height","territory","possession-value","progression","passing-efficiency","tempo","build-up-style","pass-network"]},
    ensemble:{v2Weight:w,pitchApiWeight:1-w},provenance:{provider:"PitchAPI",pointInTimeCutoff:cutoff,marketUsed:false,postMatchTargetFeaturesUsed:false}};
}
export async function attachSoccerV3Research(games=[],env={}){
  const groups=new Map();for(const g of games){const l=String(g.soccerLeague||g.league||"");if(!groups.has(l))groups.set(l,[]);groups.get(l).push(g);}
  const out=new Map();let available=0,missing=0,lineupEligible=0;
  for(const [league,gs] of groups){
    const cutoff=String(gs.map(g=>g.start||g.date).filter(Boolean).sort()[0]||new Date().toISOString()).slice(0,10);
    const rows=await loadPitchApiHistory(env,{leagueKey:league,startDate:"2021-01-01",beforeDate:cutoff}).catch(()=>[]);
    for(const g of gs){
      const v2=g.soccerFbisV2||g.soccerFbis||g.researchProjection;
      const p=projectSoccerV3(g,v2,rows);
      const fixture=await findPitchApiFixture(env,{leagueKey:league,date:String(g.start||g.date||"").slice(0,10),homeName:g.home?.name,awayName:g.away?.name}).catch(()=>null);
      let lineups=[];if(fixture?.pitch_match_id)lineups=await loadEligiblePitchApiLineups(env,{pitchMatchId:fixture.pitch_match_id,cutoff:g.start||g.date}).catch(()=>[]);
      if(lineups.length)lineupEligible++;
      const enriched={...p,pitchMatchId:fixture?.pitch_match_id||p.pitchMatchId||null,lineupEvidence:{eligible:lineups.length>0,count:lineups.length,confirmedSides:lineups.filter(x=>Number(x.confirmed)===1).length,policy:"pre-kick-observations-only"}};
      if(p.ok)available++;else missing++;
      out.set(String(g.id),{...g,soccerFbisV3:enriched,challengers:{...(g.challengers||{}),[SOCCER_FBIS_V3_ID]:enriched}});
    }
  }
  return{games:games.map(g=>out.get(String(g.id))||g),meta:{modelId:SOCCER_FBIS_V3_ID,version:SOCCER_FBIS_V3_VERSION,available,missing,lineupEligible,marketInformed:false,canQualify:false,canAuthorize:false,maturity:"RESEARCH_SHADOW",promotionGate:"walk-forward-ablation-required"}};
}
