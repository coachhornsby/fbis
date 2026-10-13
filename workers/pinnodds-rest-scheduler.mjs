import { PINNODDS_SPORTS, collectPinnOddsPrematch } from "../functions/lib/pinnOddsRest.js";

export const PINNODDS_REST_CRON="12,32,52 * * * *"; // 72 routine calls/day maximum.
const ALL_SPORTS=Object.entries(PINNODDS_SPORTS).map(([id,sports])=>({id:Number(id),sports}));
export async function runScheduledPinnOdds(env,{now=new Date()}={}){
 if(String(env.PINNODDS_COLLECT_ENABLED||"false").toLowerCase()!=="true")
  return {ok:true,status:"DISABLED_FAIL_CLOSED",networkRequests:0};
 if(!env.DB?.prepare||!env.PINNODDS_API_KEY)
  return {ok:false,status:"D1_OR_CREDENTIAL_MISSING",networkRequests:0};
 const start=now.toISOString(),end=new Date(now.getTime()+14*86400000).toISOString();
 let rows,state;
 try{
  [rows,state]=await Promise.all([
   env.DB.prepare("SELECT sport,start FROM games WHERE start BETWEEN ? AND ?").bind(start,end).all(),
   env.DB.prepare("SELECT sport_id,last_success_at,last_full_at FROM pinnodds_feed_state").all()
  ]);
 }catch{return {ok:false,status:"BUDGET_OR_SCHEDULE_UNAVAILABLE",networkRequests:0}}
 const games=rows.results||[],previous=new Map((state.results||[]).map(x=>[Number(x.sport_id),x]));
 const scored=ALL_SPORTS.map(x=>{
  const relevant=games.filter(g=>x.sports.includes(String(g.sport||"").toLowerCase()));
  const near=relevant.filter(g=>Date.parse(g.start)<now.getTime()+48*3600000).length;
  const recent=previous.get(x.id)?.last_success_at;
  const age=recent?Math.max(0,now.getTime()-Date.parse(recent)):72*3600000;
  const freshness=Number.isFinite(age)?Math.min(72,age/3600000):72;
  return {id:x.id,upcoming:relevant.length,score:near*4+relevant.length+freshness};
 }).filter(x=>x.upcoming>0).sort((a,b)=>b.score-a.score||a.id-b.id);
 if(!scored.length)return {ok:true,status:"NO_UPCOMING_MATCHED_SPORTS",networkRequests:0};
 const choice=scored[0].id;
 const result=await collectPinnOddsPrematch(env,{sportId:choice,purpose:"routine",now});
 return {status:result.ok?"COLLECTED":"COLLECT_BLOCKED",...result,selectedSportId:choice,networkRequests:result.reason==="QUOTA_OR_COOLDOWN"||result.reason==="CREDENTIAL_NOT_CONFIGURED"?0:1};
}
