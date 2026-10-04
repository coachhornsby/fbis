import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
import { WNBA_PLAYER_MODEL_VERSION } from "../lib/wnbaPlayerProjection.js";

function json(body,status=200){
  return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
}
const finite=v=>{const n=Number(v);return Number.isFinite(n)?n:null};
const clean=v=>String(v||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
const playerKey=v=>clean(v).replace(/\b(jr|sr|ii|iii|iv)\b/g,"").replace(/\s+/g," ").trim();

function stars(projection,line,sigma){
  const p=finite(projection),l=finite(line),s=finite(sigma);
  if(p==null||l==null)return null;
  const d=Math.abs(p-l);
  if(s!=null&&s>0){
    const z=d/s;
    if(z>=0.90)return 5;
    if(z>=0.65)return 4;
    if(z>=0.40)return 3;
    if(z>=0.20)return 2;
    return 1;
  }
  const rel=d/Math.max(Math.abs(l),1);
  if(rel>=0.15)return 5;
  if(rel>=0.10)return 4;
  if(rel>=0.06)return 3;
  if(rel>=0.03)return 2;
  return 1;
}

async function fetchSummary(eventId){
  const url=`https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/summary?event=${encodeURIComponent(eventId)}`;
  const r=await fetch(url,{headers:{"user-agent":"FBIS-WNBA-Prop-Grader/1.0",accept:"application/json"}});
  if(!r.ok)throw new Error(`ESPN summary HTTP ${r.status}`);
  return r.json();
}

function parseMadeAttempt(v){
  const txt=String(v??"").trim();
  const m=txt.match(/^\s*(\d+(?:\.\d+)?)\s*[-/]\s*(\d+(?:\.\d+)?)/);
  if(m)return finite(m[1]);
  return finite(txt);
}
function statMap(names=[],stats=[]){
  const out={};
  for(let i=0;i<names.length;i++){
    const k=clean(names[i]);
    const raw=stats[i];
    out[k]=raw;
    if(k==="3pt"||k.includes("3 point"))out["three_pointers_made"]=parseMadeAttempt(raw);
    if(k==="fg"||k.includes("field goal"))out["field_goals_made"]=parseMadeAttempt(raw);
  }
  return out;
}
function pickStat(map,aliases=[],madeAttempt=false){
  for(const a of aliases){
    const key=clean(a);
    for(const [k,v] of Object.entries(map||{})){
      if(k===key||k.includes(key)||key.includes(k)){
        return madeAttempt?parseMadeAttempt(v):finite(v);
      }
    }
  }
  return null;
}
function playerActuals(summary){
  const out=new Map();
  for(const group of summary?.boxscore?.players||[]){
    const team=group?.team?.abbreviation||group?.team?.shortDisplayName||null;
    for(const block of group?.statistics||[]){
      const names=block?.names||block?.labels||block?.keys||[];
      for(const row of block?.athletes||[]){
        const name=row?.athlete?.displayName||row?.athlete?.fullName||row?.displayName||null;
        if(!name)continue;
        const map=statMap(names,row?.stats||row?.statistics||[]);
        const rec={
          playerId:String(row?.athlete?.id||row?.id||"")||null,
          playerName:name,team,
          points:pickStat(map,["pts","points"]),
          rebounds:pickStat(map,["reb","rebounds"]),
          assists:pickStat(map,["ast","assists"]),
          three_pointers_made: map.three_pointers_made ?? pickStat(map,["3pt","3pm","3 point field goals"],true),
          steals:pickStat(map,["stl","steals"]),
          blocks:pickStat(map,["blk","blocks"]),
          turnovers:pickStat(map,["to","turnovers"]),
        };
        if(rec.points!=null||rec.rebounds!=null||rec.assists!=null)out.set(playerKey(name),rec);
      }
    }
  }
  return out;
}
function actualFor(rec,market){
  if(!rec)return null;
  if(market==="points_rebounds_assists"){
    return [rec.points,rec.rebounds,rec.assists].every(v=>v!=null)?rec.points+rec.rebounds+rec.assists:null;
  }
  if(market==="points_rebounds"){
    return [rec.points,rec.rebounds].every(v=>v!=null)?rec.points+rec.rebounds:null;
  }
  if(market==="points_assists"){
    return [rec.points,rec.assists].every(v=>v!=null)?rec.points+rec.assists:null;
  }
  if(market==="rebounds_assists"){
    return [rec.rebounds,rec.assists].every(v=>v!=null)?rec.rebounds+rec.assists:null;
  }
  return finite(rec?.[market]);
}
function grade(side,actual,line){
  const a=finite(actual),l=finite(line);
  if(a==null||l==null)return null;
  const s=String(side||"").toUpperCase();
  if(a===l)return {result:"PUSH",hit:null,push:1};
  if(s==="MORE"||s==="OVER")return {result:a>l?"WIN":"LOSS",hit:a>l?1:0,push:0};
  if(s==="LESS"||s==="UNDER")return {result:a<l?"WIN":"LOSS",hit:a<l?1:0,push:0};
  return null;
}

export async function onRequestPost(context){
  const auth=authorizeHarvest(context.request,context.env);
  if(!auth.ok)return json(unauthorizedBody(),401);
  if(!context.env?.DB)return json({ok:false,error:"database unavailable"},503);
  try{
    const body=await context.request.json().catch(()=>({}));
    const date=String(body?.date||"").slice(0,10);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return json({ok:false,error:"invalid-date"},400);

    const rows=await context.env.DB.prepare(
      `WITH ranked AS (
         SELECT *, ROW_NUMBER() OVER (
           PARTITION BY COALESCE(fbis_event_id,game_id),player_name,canonical_market,COALESCE(odds_tier,'standard'),COALESCE(duration,'Full')
           ORDER BY collected_at DESC
         ) rn
         FROM prizepicks_prop_lines
         WHERE sport='wnba'
           AND substr(start_time,1,10)=?
           AND fbis_projection IS NOT NULL
           AND fbis_event_id IS NOT NULL
           AND canonical_market IS NOT NULL
       )
       SELECT * FROM ranked WHERE rn=1 ORDER BY fbis_event_id,player_name,canonical_market`
    ).bind(date).all();
    const lines=rows?.results||[];
    const eventIds=[...new Set(lines.map(r=>String(r.fbis_event_id||"")).filter(Boolean))];
    const actualsByEvent=new Map();
    const errors=[];
    for(const eventId of eventIds){
      try{actualsByEvent.set(eventId,playerActuals(await fetchSummary(eventId)));}
      catch(e){errors.push({eventId,error:String(e?.message||e)});}
    }

    let graded=0,wins=0,losses=0,pushes=0,unmatched=0;
    for(const row of lines){
      const players=actualsByEvent.get(String(row.fbis_event_id))||new Map();
      const rec=players.get(playerKey(row.player_name));
      const actual=actualFor(rec,row.canonical_market);
      const g=grade(row.candidate_side,actual,row.line);
      if(!rec||actual==null||!g){unmatched++;continue;}
      const rawStar=stars(row.fbis_projection,row.line,row.fbis_sigma);
      const id=`wnbapv_${String(row.id).replace(/[^a-zA-Z0-9]/g,"").slice(-24)}`;
      await context.env.DB.prepare(
        `INSERT OR REPLACE INTO wnba_prop_validation (
          id,source_line_id,run_id,event_id,game_start,player_id,player_name,team,market,line,odds_tier,
          fbis_projection,fbis_sigma,projection_delta,candidate_side,raw_star,actual,result,hit,push,
          observed_at,collected_at,graded_at,model_version
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        id,row.id,row.run_id,row.fbis_event_id,row.start_time,row.player_id||rec.playerId||null,row.player_name,row.team,
        row.canonical_market,row.line,row.odds_tier||"standard",row.fbis_projection,row.fbis_sigma,
        finite(row.delta_fbis_minus_line)??(finite(row.fbis_projection)-finite(row.line)),row.candidate_side,rawStar,
        actual,g.result,g.hit,g.push,row.observed_at,row.collected_at,new Date().toISOString(),WNBA_PLAYER_MODEL_VERSION
      ).run();
      graded++;
      if(g.result==="WIN")wins++;
      else if(g.result==="LOSS")losses++;
      else pushes++;
    }

    const calibration=await context.env.DB.prepare(
      `SELECT market,raw_star,candidate_side,odds_tier,graded,decisions,hits,hit_rate,avg_abs_projection_delta,avg_abs_z
         FROM wnba_prop_calibration
        ORDER BY market,raw_star DESC,candidate_side,odds_tier`
    ).all();

    return json({ok:true,date,lines:lines.length,events:eventIds.length,graded,wins,losses,pushes,unmatched,errors,calibration:calibration?.results||[]});
  }catch(err){
    return json({ok:false,error:String(err?.message||err)},500);
  }
}
