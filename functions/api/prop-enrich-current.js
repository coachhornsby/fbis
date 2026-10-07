import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
import { loadEspnLastFive, valueForEspnEvent } from "../lib/playerPropHistory.js";
import { projectTennisPlayerPropsV2 } from "../lib/tennisPlayerPropModel.js";

function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json","cache-control":"no-store"}})}
const clean=v=>String(v||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
const finite=v=>{const n=Number(v);return Number.isFinite(n)?n:null};
function mean(a=[]){const x=a.map(finite).filter(v=>v!=null);return x.length?x.reduce((s,v)=>s+v,0)/x.length:null}
function sd(a=[]){const x=a.map(finite).filter(v=>v!=null);if(x.length<2)return null;const m=mean(x);return Math.sqrt(x.reduce((s,v)=>s+(v-m)**2,0)/(x.length-1))}
function weightedRecent(a=[]){
  const x=a.map(finite).filter(v=>v!=null).slice(0,5),w=[.35,.25,.18,.13,.09];
  if(!x.length)return null;let n=0,d=0;for(let i=0;i<x.length;i++){n+=x[i]*w[i];d+=w[i]}return n/d;
}
async function currentRows(db,sport,date,limit){
  return (await db.prepare(`
    WITH latest AS (
      SELECT *,ROW_NUMBER() OVER(
        PARTITION BY lower(sport),lower(player_name),lower(canonical_market),lower(coalesce(duration,'full'))
        ORDER BY collected_at DESC
      ) rn
      FROM prizepicks_prop_lines
      WHERE run_id IN (SELECT run_id FROM prizepicks_daily_acquisitions WHERE state='COMPLETE') AND julianday(collected_at) BETWEEN julianday('now','-24 hours') AND julianday('now') AND lower(sport)=? AND substr(start_time,1,10)=?
        AND fbis_projection IS NULL AND line IS NOT NULL\n        AND (model_source IS NULL OR model_source NOT LIKE 'ENRICH_UNAVAILABLE:%')
        AND lower(coalesce(odds_tier,'standard'))='standard'
        AND lower(coalesce(duration,'full'))='full'
    )
    SELECT * FROM latest WHERE rn=1 ORDER BY start_time,player_name LIMIT ?
  `).bind(sport,date,limit).all())?.results||[];
}
async function persistProjection(db,row,projection,sigma,source){
  const out=await db.prepare(`
    UPDATE prizepicks_prop_lines
    SET fbis_projection=?,fbis_sigma=?,delta_fbis_minus_line=?-line,
        candidate_side=CASE WHEN ?>line THEN 'MORE' WHEN ?<line THEN 'LESS' ELSE NULL END,
        model_source=?,model_version=?
    WHERE lower(sport)=? AND substr(start_time,1,10)=?
      AND lower(player_name)=? AND lower(canonical_market)=?
      AND lower(coalesce(duration,'full'))=?
  `).bind(projection,sigma,projection,projection,projection,source,source,
    String(row.sport).toLowerCase(),String(row.start_time).slice(0,10),String(row.player_name).toLowerCase(),
    String(row.canonical_market).toLowerCase(),String(row.duration||"full").toLowerCase()).run();
  return Number(out?.meta?.changes||0);
}
async function tennisProfiles(db,name,opponent){
  const keys=[clean(name),clean(opponent)];
  const rows=(await db.prepare(`
    SELECT tour,surface,player_key,profile_json,source_as_of
    FROM tennis_player_profiles_current WHERE player_key IN (?,?)
    ORDER BY CASE WHEN surface='hard' THEN 0 ELSE 1 END,source_as_of DESC
  `).bind(...keys).all())?.results||[];
  for(const tour of ["atp","wta"]){
    const a=rows.find(r=>r.tour===tour&&r.player_key===keys[0]);
    const b=rows.find(r=>r.tour===tour&&r.player_key===keys[1]);
    if(a&&b){
      try{return {tour,player1:JSON.parse(a.profile_json),player2:JSON.parse(b.profile_json)}}catch{}
    }
  }
  return null;
}
async function enrichTennis(db,row){
  if(!row.opponent)return {ok:false,reason:"opponent-missing"};
  const profiles=await tennisProfiles(db,row.player_name,row.opponent);
  if(!profiles)return {ok:false,reason:"deep-profile-missing"};
  const model=projectTennisPlayerPropsV2({
    id:row.game_id||row.fbis_event_id||[row.player_name,row.opponent,row.start_time].join("|"),
    tour:profiles.tour,surface:"hard",bestOf:3,simulations:1200,
    player1:profiles.player1,player2:profiles.player2
  },[]);
  if(!model?.ok)return {ok:false,reason:model?.state||"tennis-model-unavailable"};
  const market=String(row.canonical_market||"");
  const who=clean(row.player_name);
  const match=(model.rows||[]).find(r=>r.market===market &&
    (["total_games","total_sets","total_tie_breaks"].includes(market)||clean(r.playerName)===who));
  if(!match||finite(match.fbisProjection)==null)return {ok:false,reason:"market-not-modeled"};
  const changed=await persistProjection(db,row,match.fbisProjection,match.fbisSigma,model.modelId||"TENNIS-FBIS-v2-CONTEXT");
  return {ok:changed>0,changed,projection:match.fbisProjection,market};
}

const SOCCER_LEAGUES=["uefa.nations","arg.1","eng.1","esp.1","ger.1","ita.1","fra.1","usa.1","bra.1","uefa.champions","uefa.europa"];
const soccerCache=new Map();
async function getJson(url,timeoutMs=5000){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{const r=await fetch(url,{headers:{accept:"application/json","user-agent":"FBIS/1.0"},signal:controller.signal});return r.ok?await r.json():null}
  catch{return null}finally{clearTimeout(timer)}
}
function teamToken(v){return clean(v).replace(/\b(fc|cf|ca|club|de|the)\b/g," ").replace(/\s+/g," ").trim()}
function compTeams(event){
  return event?.competitions?.[0]?.competitors||[];
}
async function soccerTeamContext(row){
  const k=[row.team,row.opponent,String(row.start_time).slice(0,10)].join("|");
  if(soccerCache.has(k))return soccerCache.get(k);
  const date=String(row.start_time).slice(0,10).replace(/-/g,"");
  const t=teamToken(row.team),o=teamToken(row.opponent);
  for(const league of SOCCER_LEAGUES){
    const board=await getJson("https://site.api.espn.com/apis/site/v2/sports/soccer/"+league+"/scoreboard?dates="+date,3500);
    for(const event of board?.events||[]){
      const comps=compTeams(event);
      const names=comps.map(x=>teamToken(x?.team?.displayName||x?.team?.shortDisplayName||x?.team?.name||x?.team?.abbreviation));
      const teamIndex=names.findIndex(x=>x&&(x.includes(t)||t.includes(x)));
      const oppOk=!o||names.some(x=>x&&(x.includes(o)||o.includes(x)));
      if(teamIndex>=0&&oppOk){
        const out={league,teamId:comps[teamIndex]?.team?.id,eventId:event.id};
        soccerCache.set(k,out);return out;
      }
    }
  }
  soccerCache.set(k,null);return null;
}
async function soccerRecentPlayerValues(row){
  const ctx=await soccerTeamContext(row);
  if(!ctx)return {values:[],reason:"event-team-not-found"};
  const season=new Date(row.start_time).getUTCFullYear();
  const sched=await getJson("https://site.api.espn.com/apis/site/v2/sports/soccer/"+ctx.league+"/teams/"+ctx.teamId+"/schedule?season="+season,5000);
  const startMs=Date.parse(row.start_time);
  const events=(sched?.events||[]).filter(e=>{
    const ms=Date.parse(e.date||e?.competitions?.[0]?.date||"");
    return Number.isFinite(ms)&&ms<startMs&&(e?.status?.type?.completed===true||String(e?.status?.type?.state||"").toLowerCase()==="post");
  }).sort((a,b)=>Date.parse(b.date)-Date.parse(a.date)).slice(0,5);
  const values=[];
  for(const event of events){
    const summary=await getJson("https://site.api.espn.com/apis/site/v2/sports/soccer/"+ctx.league+"/summary?event="+event.id,5000);
    const groups=summary?.boxscore?.players||[];
    for(const group of groups){
      for(const statGroup of group?.statistics||[]){
        const names=statGroup?.keys||statGroup?.names||statGroup?.labels||[];
        for(const athlete of statGroup?.athletes||[]){
          const name=athlete?.athlete?.displayName||athlete?.athlete?.fullName||athlete?.displayName||"";
          if(clean(name)!==clean(row.player_name))continue;
          const v=valueForEspnEvent({names},{stats:athlete?.stats||[]},row.canonical_market,"soccer",row.player_name);
          if(v!=null){values.push(v);break}
        }
        if(values.length&&values.length>=events.indexOf(event)+1)break;
      }
    }
  }
  return {values:values.slice(0,5),reason:values.length?null:"boxscore-stat-not-found",league:ctx.league};
}

async function enrichSoccer(db,row){
  let vals=[];
  const direct=await soccerRecentPlayerValues(row);
  vals=(direct.values||[]).filter(v=>finite(v)!=null);
  if(!vals.length){
    const h=await loadEspnLastFive({sport:"soccer",name:row.player_name,team:row.team,market:row.canonical_market,line:row.line});
    vals=(h?.last5||[]).map(x=>x.value).filter(v=>finite(v)!=null);
    if(!vals.length)return {ok:false,reason:direct.reason||h?.reason||"history-unavailable"};
  }
  const projection=weightedRecent(vals),sigma=sd(vals);
  if(projection==null)return {ok:false,reason:"history-empty"};
  const changed=await persistProjection(db,row,Math.round(projection*100)/100,sigma==null?null:Math.round(sigma*100)/100,"SOCCER-PLAYER-LAST5-BOXSCORE-v1");
  return {ok:changed>0,changed,projection,market:row.canonical_market};
}
export async function onRequestPost(context){
  const auth=authorizeHarvest(context.request,context.env);
  if(!auth.ok)return json(unauthorizedBody(auth.reason),401);
  if(!context.env?.DB)return json({ok:false,error:"database unavailable"},503);
  const body=await context.request.json().catch(()=>({}));
  const sport=String(body.sport||"").toLowerCase();
  if(!["tennis","soccer"].includes(sport))return json({ok:false,error:"sport must be tennis or soccer"},400);
  const date=String(body.date||new Intl.DateTimeFormat("en-CA",{timeZone:"America/Chicago",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date()));
  const limit=Math.max(1,Math.min(sport==="soccer"?20:30,Number(body.limit)||20));
  if(body.resetUnavailable===true){
    await context.env.DB.prepare("UPDATE prizepicks_prop_lines SET model_source=NULL WHERE lower(sport)=? AND substr(start_time,1,10)=? AND fbis_projection IS NULL AND model_source LIKE 'ENRICH_UNAVAILABLE:%'").bind(sport,date).run();
  }
  const rows=await currentRows(context.env.DB,sport,date,limit);
  let projected=0,updated=0;const failures={};
  for(const row of rows){
    const r=sport==="tennis"?await enrichTennis(context.env.DB,row):await enrichSoccer(context.env.DB,row);
    if(r.ok){projected++;updated+=r.changed||0}
    else {
      const reason=r.reason||"unknown"; failures[reason]=(failures[reason]||0)+1;
      await context.env.DB.prepare("UPDATE prizepicks_prop_lines SET model_source=? WHERE lower(sport)=? AND substr(start_time,1,10)=? AND lower(player_name)=? AND lower(canonical_market)=? AND lower(coalesce(duration,'full'))='full' AND fbis_projection IS NULL")
        .bind("ENRICH_UNAVAILABLE:"+reason,sport,date,String(row.player_name).toLowerCase(),String(row.canonical_market).toLowerCase()).run();
    }
  }
  return json({ok:true,sport,date,attempted:rows.length,projected,updated,failures,remainingHint:rows.length===limit});
}
