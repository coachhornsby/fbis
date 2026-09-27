import { authorizeExecutedBetWrite, unauthorizedBody } from "../lib/auth.js";
import { persistAdvisorReview, queryAdvisorReviews } from "../lib/store.js";
import { hashText } from "../lib/heritageSlip.js";

function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});}
function compactGame(g){
 return {id:String(g.id||""),sport:g.sport||"",date:g.date||"",start:g.start||null,
  home:g.home||null,away:g.away||null,modelVersion:g.modelVersion||g.projection?.modelVersion||null,
  projection:g.projection||null,odds:g.odds||null,pin:g.pin||null,action:g.action||g.actionIntel||null,
  dataQuality:g.dataQuality||null,qualification:g.qualification||g.decision||null,injuries:g.injuries||null,
  weather:g.weather||null,myBets:g.myBets||null};
}
async function callOpenAI(apiKey,games,model){
 const prompt=`You are the second-pass research analyst inside FBIS. Evaluate only the supplied immutable pregame data. Never invent injuries, lines, stats, or context. ACTION/public betting is context, not an independent model. Respect FBIS qualification/fail-closed rules. For each game return decision A, B, C, or NO_PLAY; confidence HIGH, MEDIUM, or LOW; and a concise reason. A/B/C are research classifications, not automatic wager authorization.\nDATA:\n${JSON.stringify(games)}`;
 const res=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{"content-type":"application/json","authorization":`Bearer ${apiKey}`},body:JSON.stringify({model,input:prompt,reasoning:{effort:"medium"},text:{format:{type:"json_schema",name:"fbis_advisor",strict:true,schema:{type:"object",properties:{reviews:{type:"array",items:{type:"object",properties:{gameId:{type:"string"},decision:{type:"string",enum:["A","B","C","NO_PLAY"]},confidence:{type:"string",enum:["HIGH","MEDIUM","LOW"]},reason:{type:"string"}},required:["gameId","decision","confidence","reason"],additionalProperties:false}}},required:["reviews"],additionalProperties:false}}}})});
 if(!res.ok) throw new Error(`openai-http-${res.status}: ${(await res.text()).slice(0,300)}`);
 const data=await res.json();
 const raw=data.output_text || data.output?.flatMap(x=>x.content||[]).find(x=>x.type==="output_text")?.text;
 if(!raw) throw new Error("openai-empty-output");
 return {reviews:JSON.parse(raw).reviews||[],responseId:data.id,model:data.model||model};
}

export async function onRequestGet(context){
 const u=new URL(context.request.url); const q=await queryAdvisorReviews(context.env,{date:u.searchParams.get("date")||undefined,sport:u.searchParams.get("sport")||undefined});
 return json({ok:q.ok,rows:q.rows||[],error:q.reason||null},q.ok?200:503);
}
export async function onRequestPost(context){
 const auth=authorizeExecutedBetWrite(context.request,context.env);
 if(!auth.ok)return json(unauthorizedBody(),401);
 if(!context.env.OPENAI_API_KEY)return json({ok:false,error:"OPENAI_API_KEY is not configured; advisor fails closed."},503);
 let body;try{body=await context.request.json();}catch{return json({ok:false,error:"invalid-json"},400);}
 const games=(body.games||[]).map(compactGame).filter(g=>g.id&&g.sport&&g.date);
 if(!games.length)return json({ok:false,error:"no-games"},400);
 const model=context.env.OPENAI_ADVISOR_MODEL||"gpt-5.6-luna";
 try{
  const result=await callOpenAI(context.env.OPENAI_API_KEY,games,model);
  const byId=new Map(games.map(g=>[g.id,g])); const saved=[];
  for(const review of result.reviews){
   const snapshot=byId.get(String(review.gameId)); if(!snapshot)continue;
   const snapshotHash=await hashText(JSON.stringify(snapshot)); const reviewedAt=new Date().toISOString();
   const row={id:`advisor:${snapshot.id}:${snapshotHash.slice(0,16)}`,gameId:snapshot.id,sport:snapshot.sport,date:snapshot.date,
    decision:review.decision,confidence:review.confidence,reason:review.reason,modelVersion:snapshot.modelVersion,
    snapshotHash,snapshot,reviewedAt,provider:"openai",model:result.model};
   const w=await persistAdvisorReview(context.env,row); if(w.ok)saved.push(row);
  }
  return json({ok:true,reviews:saved,responseId:result.responseId,model:result.model});
 }catch(err){return json({ok:false,error:String(err?.message||err)},502);}
}
