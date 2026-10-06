import { authorizeSoccerWorker, unauthorizedBody } from "../lib/soccerWorkerAuth.js";
import {
  HERITAGE_SOCCER_COMPETITIONS,
  HERITAGE_SOCCER_EXTENDED_OFFERINGS,
} from "../lib/soccerCompetitionRegistry.js";

function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});}
function norm(s){return String(s||"").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();}
const STOP=new Set(["league","liga","division","divisao","premier","primera","serie","super","championship","cup","copa","national","international","soccer","football","the","de","do","da","la"]);
function tokens(s){return norm(s).split(" ").filter(x=>x&&!STOP.has(x));}
function jaccard(a,b){const A=new Set(tokens(a)),B=new Set(tokens(b));if(!A.size||!B.size)return 0;let i=0;for(const x of A)if(B.has(x))i++;return i/(A.size+B.size-i);}
function prefixCountry(name){
  const first=norm(name).split(" ")[0];
  const map={argentina:"ARG",australia:"AUS",austria:"AUT",belgium:"BEL",bolivia:"BOL",brazil:"BRA",bulgaria:"BUL",canada:"CAN",chile:"CHI",china:"CHN",colombia:"COL",croatia:"CRO",cyprus:"CYP",denmark:"DEN",ecuador:"ECU",egypt:"EGY",england:"ENG",estonia:"EST",finland:"FIN",france:"FRA",germany:"GER",greece:"GRE",honduras:"HON",hungary:"HUN",iceland:"ISL",india:"IND",indonesia:"IDN",ireland:"IRL",israel:"ISR",italy:"ITA",jamaica:"JAM",japan:"JPN",kenya:"KEN",mexico:"MEX",netherlands:"NED",nicaragua:"NCA",norway:"NOR",paraguay:"PAR",peru:"PER",poland:"POL",portugal:"POR",qatar:"QAT",romania:"ROU",russian:"RUS",russia:"RUS",saudi:"KSA",scotland:"SCO",serbia:"SRB",slovakia:"SVK",slovenia:"SVN",sweden:"SWE",switzerland:"SUI",turkey:"TUR",ukraine:"UKR",uruguay:"URU",venezuela:"VEN",vietnam:"VIE",wales:"WAL"};
  return map[first]||null;
}
function safeJsonArray(v){
  try{
    const x=JSON.parse(String(v||"[]"));
    return Array.isArray(x)?x.map(String).filter(Boolean):[];
  }catch{return[];}
}
function aliasesFor(name,registryRow){
  const canonical=HERITAGE_SOCCER_COMPETITIONS.find(x=>x.name===name);
  return [...new Set([
    ...(canonical?[canonical.name,...canonical.aliases]:[name]),
    ...safeJsonArray(registryRow?.provider_aliases_json),
    registryRow?.provider_name,
  ].filter(Boolean))];
}
function bestMatch(name,leagues,registryRow){
  const registryId=String(registryRow?.provider_competition_id||"");
  if(registryId){
    const league=leagues.find(l=>String(l.id)===registryId);
    if(league)return {league,score:Number(registryRow?.confidence)||1,method:"registry-id",accepted:true,review:false};
  }
  const aliases=aliasesFor(name,registryRow),wantedCountry=prefixCountry(name);
  let best=null;
  for(const l of leagues){
    const candidates=[l.name,l.short_name,l.slug].filter(Boolean);
    let score=0,method="fuzzy";
    for(const a of aliases)for(const cand of candidates){
      if(norm(a)===norm(cand)){score=1;method="exact";break;}
      score=Math.max(score,jaccard(a,cand));
    }
    const cc=String(l.country_code||l.country?.code||"").toUpperCase();
    if(wantedCountry&&cc&&wantedCountry!==cc)score*=0.55;
    if(!best||score>best.score)best={league:l,score,method};
  }
  if(!best)return null;
  return {...best,accepted:best.score>=0.92,review:best.score>=0.72&&best.score<0.92};
}
async function pitch(env,path){
  const key=String(env?.PITCHAPI_API_KEY||"");if(!key)throw new Error("pitchapi-secret-unconfigured");
  const r=await fetch("https://api.pitchapi.dev"+path,{headers:{"X-API-KEY":key,accept:"application/json"},signal:AbortSignal.timeout(9000)});
  if(!r.ok)throw new Error("PitchAPI "+r.status);
  return (await r.json())?.data??null;
}
function seasonList(l){return Array.isArray(l?.seasons)?l.seasons.map(String).filter(Boolean):[];}
function sourceFor(match,registryRow){
  if(match?.method==="registry-id")return registryRow?.verified_manual===1?"MANUAL_VERIFIED":"REGISTRY_ID";
  if(match?.method==="exact")return "AUTO_EXACT";
  return "AUTO_HIGH_CONFIDENCE";
}
export async function onRequestPost(context){
  const auth=authorizeSoccerWorker(context.request,context.env);if(!auth.ok)return json(unauthorizedBody(auth.reason),401);
  const db=context.env?.DB;if(!db?.prepare)return json({ok:false,error:"d1-unbound"},503);
  const started=new Date().toISOString(),runId=crypto.randomUUID();
  try{
    let body={};try{body=await context.request.json();}catch{}
    const limit=Math.max(1,Math.min(40,Number(body.limit)||40));
    const data=await pitch(context.env,"/v1/leagues"),leagues=data?.leagues||[];
    const pending=(await db.prepare("SELECT heritage_name,heritage_key,offering_tier,model_eligible,policy_reason FROM soccer_competition_coverage WHERE discovery_status IN ('PENDING','REVIEW','UNMATCHED') ORDER BY CASE discovery_status WHEN 'PENDING' THEN 0 WHEN 'REVIEW' THEN 1 ELSE 2 END, heritage_name LIMIT ?").bind(limit).all()).results||[];
    let exact=0,fuzzy=0,registry=0,unmatched=0,queued=0;
    await db.prepare("INSERT INTO soccer_pitchapi_discovery_runs(id,started_at,status,heritage_offerings,pitch_leagues) VALUES(?,?,?,?,?)")
      .bind(runId,started,"RUNNING",pending.length,leagues.length).run();
    for(const row of pending){
      const name=row.heritage_name;
      const registryRow=await db.prepare("SELECT * FROM soccer_competition_provider_map WHERE heritage_name=? AND provider='pitchapi'").bind(name).first();
      const match=bestMatch(name,leagues,registryRow),accepted=Boolean(match?.accepted);
      const status=accepted?"MATCHED":match?.review?"REVIEW":"UNMATCHED";
      if(match?.method==="registry-id"&&accepted)registry++; else if(match?.method==="exact"&&accepted)exact++; else if(accepted)fuzzy++; else unmatched++;
      const l=accepted?match.league:null,seasons=seasonList(l).sort((a,b)=>{const ya=Number(String(a).match(/\d{4}/)?.[0]||0),yb=Number(String(b).match(/\d{4}/)?.[0]||0);return yb-ya;}),canonical=HERITAGE_SOCCER_COMPETITIONS.find(x=>x.name===name);
      const heritageKey=row.heritage_key||canonical?.key||("heritage."+norm(name).replace(/ /g,"."));
      const blocked=row.model_eligible===0;
      const modelEligible=blocked?0:(accepted?1:null);
      await db.prepare("INSERT INTO soccer_competition_coverage(heritage_name,heritage_key,offering_tier,model_eligible,policy_reason,pitch_league_id,pitch_league_name,pitch_country_code,match_score,match_method,seasons_json,current_season,discovery_status,validation_status,can_qualify,can_authorize,last_discovered_at,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'NOT_RUN',0,0,?,?) ON CONFLICT(heritage_name) DO UPDATE SET heritage_key=excluded.heritage_key,offering_tier=excluded.offering_tier,model_eligible=excluded.model_eligible,policy_reason=excluded.policy_reason,pitch_league_id=excluded.pitch_league_id,pitch_league_name=excluded.pitch_league_name,pitch_country_code=excluded.pitch_country_code,match_score=excluded.match_score,match_method=excluded.match_method,seasons_json=excluded.seasons_json,current_season=excluded.current_season,discovery_status=excluded.discovery_status,last_discovered_at=excluded.last_discovered_at,notes=excluded.notes")
        .bind(name,heritageKey,row.offering_tier,modelEligible,row.policy_reason,l?.id||null,l?.name||null,l?.country_code||l?.country?.code||null,match?.score??null,match?.method||null,JSON.stringify(seasons),seasons[0]||null,status,started,accepted?null:(match?.league?("candidate:"+match.league.name):"no PitchAPI candidate")).run();
      if(accepted){
        const aliases=[...new Set([l?.name,l?.short_name,l?.slug,...aliasesFor(name,registryRow)].filter(Boolean))];
        await db.prepare(`INSERT INTO soccer_competition_provider_map(
          heritage_name,heritage_key,canonical_competition_id,provider,provider_competition_id,provider_name,provider_aliases_json,
          mapping_source,confidence,verified_manual,last_checked,created_at,updated_at
        ) VALUES(?,?,?,'pitchapi',?,?,?,?,?,COALESCE(?,0),?,?,?)
        ON CONFLICT(heritage_name) DO UPDATE SET
          heritage_key=excluded.heritage_key,canonical_competition_id=excluded.canonical_competition_id,
          provider_competition_id=excluded.provider_competition_id,provider_name=excluded.provider_name,
          provider_aliases_json=excluded.provider_aliases_json,mapping_source=CASE
            WHEN soccer_competition_provider_map.verified_manual=1 THEN soccer_competition_provider_map.mapping_source
            ELSE excluded.mapping_source END,
          confidence=excluded.confidence,last_checked=excluded.last_checked,updated_at=excluded.updated_at`).bind(
            name,heritageKey,heritageKey,String(l.id),l.name||null,JSON.stringify(aliases),sourceFor(match,registryRow),match.score??1,
            registryRow?.verified_manual??0,started,registryRow?.created_at||started,started
          ).run();
      }
      if(accepted&&modelEligible===1){
        for(const season of seasons.slice(0,6)){
          const qid=String(l.id)+":"+season+":0";
          await db.prepare("INSERT OR IGNORE INTO soccer_pitchapi_backfill_queue(id,heritage_name,heritage_key,pitch_league_id,season,offset,page_size,status,attempts,created_at,updated_at) VALUES(?,?,?,?,?,0,12,'PENDING',0,?,?)")
            .bind(qid,name,heritageKey,String(l.id),season,started,started).run();
          queued++;
        }
      }
    }
    const done=new Date().toISOString();
    await db.prepare("UPDATE soccer_pitchapi_discovery_runs SET completed_at=?,status='SUCCESS',exact_matches=?,fuzzy_matches=?,unmatched=?,meta_json=? WHERE id=?")
      .bind(done,exact,fuzzy,unmatched,JSON.stringify({registryMatches:registry}),runId).run();
    const remaining=await db.prepare("SELECT COUNT(*) n FROM soccer_competition_coverage WHERE discovery_status!='MATCHED'").first();
    return json({ok:true,runId,processed:pending.length,remaining:Number(remaining?.n||0),pitchLeagues:leagues.length,registry,exact,fuzzy,unmatched,queueSeeds:queued,policy:"durable registry first; auto-match >=0.92 only; review candidates never model-authorize"});
  }catch(e){
    await db.prepare("UPDATE soccer_pitchapi_discovery_runs SET completed_at=?,status='FAILED',meta_json=? WHERE id=?")
      .bind(new Date().toISOString(),JSON.stringify({error:String(e?.message||e)}),runId).run().catch(()=>{});
    return json({ok:false,error:String(e?.message||e),runId},502);
  }
}
