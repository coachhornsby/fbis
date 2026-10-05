import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
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
      WHERE lower(sport)=? AND substr(start_time,1,10)=?
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

const SOCCER_PITCHAPI_MARKETS=Object.freeze({
  shots:{column:"shots",aliases:["total_shots","shots"]},
  shots_on_target:{aliases:["shots_on_target","total_shots_on_target","shots_on_goal"]},
  goals:{column:"goals",aliases:["goals"]},
  assists:{column:"assists",aliases:["assists"]},
  goal_assist:{derive:["goals","assists"]},
  saves:{column:"saves",aliases:["saves"]},
  fouls:{aliases:["fouls","fouls_committed","total_fouls"]},
  tackles:{aliases:["tackles","total_tackles","tackles_won"]},
  clearances:{aliases:["clearances","total_clearances"]},
  passes:{aliases:["passes","total_passes","passes_attempted"]},
  chances_created:{column:"chances_created",aliases:["chances_created","key_passes"]},
  expected_goals:{column:"expected_goals",aliases:["expected_goals","xg"]},
  expected_assists:{column:"expected_assists",aliases:["expected_assists","xag"]}
});
function normKey(v){return String(v||"").toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"")}
function pitchRawStat(raw,aliases=[]){
  const wanted=new Set(aliases.map(normKey));
  let obj=null;try{obj=typeof raw==="string"?JSON.parse(raw):raw}catch{return null}
  const stack=[obj];
  while(stack.length){
    const x=stack.pop();
    if(!x||typeof x!=="object")continue;
    if(Array.isArray(x)){for(const y of x)stack.push(y);continue}
    const key=normKey(x.key||x.name||x.stat_key||x.statKey);
    if(key&&wanted.has(key)){
      const v=finite(x?.stat?.value??x.value??x.stat??x.total);
      if(v!=null)return v;
    }
    for(const y of Object.values(x))if(y&&typeof y==="object")stack.push(y);
  }
  return null;
}
function pitchMarketValue(row,market){
  const cfg=SOCCER_PITCHAPI_MARKETS[market];
  if(!cfg)return null;
  if(cfg.derive){
    const vals=cfg.derive.map(k=>finite(row[k]));
    return vals.every(v=>v!=null)?vals.reduce((a,b)=>a+b,0):null;
  }
  const direct=cfg.column?finite(row[cfg.column]):null;
  return direct!=null?direct:pitchRawStat(row.raw_json,cfg.aliases||[]);
}
async function soccerPitchApiLastFive(db,row){
  const market=String(row.canonical_market||"").toLowerCase();
  if(!SOCCER_PITCHAPI_MARKETS[market])return {values:[],reason:"pitchapi-market-not-modeled"};
  const kickoff=String(row.start_time||"");
  const candidates=(await db.prepare(`
    SELECT player_id,player_name,team_id,match_date,minutes_played,shots,goals,assists,
           expected_goals,expected_assists,saves,chances_created,raw_json
    FROM soccer_pitchapi_player_match
    WHERE match_date < substr(?,1,10) AND lower(player_name)=lower(?)
    ORDER BY match_date DESC LIMIT 12
  `).bind(kickoff,row.player_name).all())?.results||[];
  const exact=candidates.filter(x=>clean(x.player_name)===clean(row.player_name));
  if(!exact.length)return {values:[],reason:"pitchapi-player-history-missing"};
  const values=[];
  for(const x of exact){
    const v=pitchMarketValue(x,market);
    if(v!=null)values.push(v);
    if(values.length>=5)break;
  }
  return {values,reason:values.length?null:"pitchapi-market-history-missing",playerId:exact[0]?.player_id||null};
}
async function enrichSoccer(db,row){
  const hist=await soccerPitchApiLastFive(db,row);
  const vals=(hist.values||[]).filter(v=>finite(v)!=null);
  if(!vals.length)return {ok:false,reason:hist.reason||"pitchapi-history-unavailable"};
  const projection=weightedRecent(vals),sigma=sd(vals);
  if(projection==null)return {ok:false,reason:"pitchapi-history-empty"};
  const source="SOCCER-PITCHAPI-PLAYER-LAST5-v1";
  const changed=await persistProjection(db,row,Math.round(projection*100)/100,sigma==null?null:Math.round(sigma*100)/100,source);
  return {ok:changed>0,changed,projection,market:row.canonical_market,source,playerId:hist.playerId,sample:vals.length};
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
