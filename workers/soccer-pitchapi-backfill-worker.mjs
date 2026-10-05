const PITCH="https://api.pitchapi.dev";
const STOP=new Set(["league","liga","division","divisao","premier","primera","serie","super","championship","cup","copa","national","international","soccer","football","the","de","do","da","la"]);
function norm(s){return String(s||"").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();}
function tokens(s){return norm(s).split(" ").filter(x=>x&&!STOP.has(x));}
function jac(a,b){const A=new Set(tokens(a)),B=new Set(tokens(b));if(!A.size||!B.size)return 0;let i=0;for(const x of A)if(B.has(x))i++;return i/(A.size+B.size-i);}
function json(o,s=200){return new Response(JSON.stringify(o),{status:s,headers:{"content-type":"application/json","cache-control":"no-store"}});}
function num(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function pick(o,path){let x=o;for(const k of path.split(".")){if(x==null)return null;x=x[k];}return num(x);}
function flattenShots(d){return(d?.periods||[]).flatMap(p=>p?.shots||[]);}
function sumShots(shots,id,f){const x=shots.filter(s=>String(s.team_id)===String(id)).map(s=>num(s[f])).filter(v=>v!=null);return x.length?x.reduce((a,b)=>a+b,0):null;}
function countShots(shots,id,fn=()=>true){return shots.filter(s=>String(s.team_id)===String(id)&&fn(s)).length;}
function statMap(d){const p=(d?.periods||[]).find(x=>String(x.period).toLowerCase()==="all")||d?.periods?.[0],o={};for(const g of p?.groups||[])for(const it of g?.items||[]){const m=String(it.home??"").match(/-?\d+(?:\.\d+)?/),n=String(it.away??"").match(/-?\d+(?:\.\d+)?/);o[it.key]={home:m?Number(m[0]):null,away:n?Number(n[0]):null};}return o;}
function sideAdv(d,id){return(d?.teams||[]).find(x=>String(x?.team?.id)===String(id))||null;}
function netMap(d){return Object.fromEntries((d?.networks||[]).filter(x=>x?.team?.id).map(x=>[String(x.team.id),x]));}
async function pitch(env,path,optional=false){
  const r=await fetch(PITCH+path,{headers:{"X-API-KEY":env.PITCHAPI_API_KEY,accept:"application/json"},signal:AbortSignal.timeout(8000)});
  if(r.ok)return(await r.json())?.data??null;
  if(optional&&r.status===404)return null;
  throw new Error("PitchAPI "+r.status+" "+path);
}
function best(name,leagues){
  let b=null;for(const l of leagues){const score=Math.max(jac(name,l.name),jac(name,l.short_name),jac(name,l.slug));if(!b||score>b.score)b={l,score};}
  return b;
}
async function discover(env){
  const data=await pitch(env,"/v1/leagues"),leagues=data?.leagues||[],now=new Date().toISOString();
  const rows=(await env.DB.prepare("SELECT heritage_name,heritage_key,offering_tier,model_eligible FROM soccer_competition_coverage WHERE discovery_status IN ('PENDING','REVIEW') ORDER BY heritage_name LIMIT 60").all()).results||[];
  let matched=0,review=0,unmatched=0,queued=0;
  for(const r of rows){
    const b=best(r.heritage_name,leagues),accept=b&&b.score>=.92,status=accept?"MATCHED":b&&b.score>=.72?"REVIEW":"UNMATCHED";
    if(accept)matched++;else if(status==="REVIEW")review++;else unmatched++;
    const l=accept?b.l:null,seasons=Array.isArray(l?.seasons)?l.seasons.map(String):[];
    const eligible=Number(r.model_eligible)===0?0:(accept?1:null);
    await env.DB.prepare(\`UPDATE soccer_competition_coverage SET model_eligible=?,pitch_league_id=?,pitch_league_name=?,pitch_country_code=?,match_score=?,match_method=?,seasons_json=?,current_season=?,discovery_status=?,last_discovered_at=?,notes=? WHERE heritage_name=?\`)
      .bind(eligible,l?.id==null?null:String(l.id),l?.name||null,l?.country_code||l?.country?.code||null,b?.score??null,b?.score===1?"exact":"token-jaccard",JSON.stringify(seasons),seasons[0]||null,status,now,accept?null:(b?.l?("candidate:"+b.l.name):"no candidate"),r.heritage_name).run();
    if(accept&&eligible===1){
      for(const season of seasons.slice(0,6)){
        const id=String(l.id)+":"+season+":0";
        await env.DB.prepare(\`INSERT OR IGNORE INTO soccer_pitchapi_backfill_queue(id,heritage_name,heritage_key,pitch_league_id,season,offset,page_size,status,attempts,created_at,updated_at) VALUES(?,?,?,?,?,0,4,'PENDING',0,?,?)\`)
          .bind(id,r.heritage_name,r.heritage_key,String(l.id),season,now,now).run();queued++;
      }
    }
  }
  return{scanned:rows.length,matched,review,unmatched,queued,pitchLeagues:leagues.length};
}
async function claim(env){
  const now=new Date(),iso=now.toISOString(),lease=new Date(now.getTime()+4*60000).toISOString();
  const row=await env.DB.prepare(\`SELECT * FROM soccer_pitchapi_backfill_queue WHERE (status='PENDING' OR (status='LEASED' AND lease_until<?)) AND attempts<6 ORDER BY updated_at,id LIMIT 1\`).bind(iso).first();
  if(!row)return null;
  const u=await env.DB.prepare(\`UPDATE soccer_pitchapi_backfill_queue SET status='LEASED',attempts=attempts+1,lease_until=?,updated_at=? WHERE id=? AND (status='PENDING' OR (status='LEASED' AND lease_until<?))\`).bind(lease,iso,row.id,iso).run();
  return u?.meta?.changes?row:null;
}
async function persist(env,row,m,advanced,stats,shotsData,network){
  const h=m.home_team,a=m.away_team,shots=flattenShots(shotsData),ha=sideAdv(advanced,h.id),aa=sideAdv(advanced,a.id),sm=statMap(stats),st=(k,s)=>num(sm[k]?.[s]),nm=netMap(network),hn=nm[String(h.id)]||{},an=nm[String(a.id)]||{},now=new Date().toISOString();
  const fx={
    homeXg:sumShots(shots,h.id,"expected_goals")??st("expected_goals","home"),awayXg:sumShots(shots,a.id,"expected_goals")??st("expected_goals","away"),
    homeXgot:sumShots(shots,h.id,"expected_goals_on_target"),awayXgot:sumShots(shots,a.id,"expected_goals_on_target"),
    homeShots:shotsData?countShots(shots,h.id):null,awayShots:shotsData?countShots(shots,a.id):null,homeSot:shotsData?countShots(shots,h.id,s=>s.is_on_target===true):null,awaySot:shotsData?countShots(shots,a.id,s=>s.is_on_target===true):null,
    homePpda:pick(ha,"defending.ppda"),awayPpda:pick(aa,"defending.ppda"),homeFieldTilt:pick(ha,"territory.field_tilt"),awayFieldTilt:pick(aa,"territory.field_tilt"),
    homeFinalThird:pick(ha,"territory.final_third_entries"),awayFinalThird:pick(aa,"territory.final_third_entries"),homeBox:pick(ha,"territory.box_entries"),awayBox:pick(aa,"territory.box_entries"),
    homeHigh:pick(ha,"defending.high_turnovers"),awayHigh:pick(aa,"defending.high_turnovers"),homeCounter:pick(ha,"defending.counterpress_regains_5s"),awayCounter:pick(aa,"defending.counterpress_regains_5s"),
    homeRecovery:pick(ha,"defending.ball_recovery_time"),awayRecovery:pick(aa,"defending.ball_recovery_time"),homeXt:pick(ha,"possession_value.xt_total"),awayXt:pick(aa,"possession_value.xt_total"),
    homeVaep:pick(ha,"possession_value.vaep_total"),awayVaep:pick(aa,"possession_value.vaep_total"),homeProg:pick(ha,"passing.progressive_passes"),awayProg:pick(aa,"passing.progressive_passes"),
    homeCarry:pick(ha,"carrying.progressive_carries"),awayCarry:pick(aa,"carrying.progressive_carries"),homeXag:pick(ha,"creation.xag"),awayXag:pick(aa,"creation.xag"),
    homePoss:pick(ha,"territory.possession_pct"),awayPoss:pick(aa,"territory.possession_pct"),homePps:pick(ha,"tempo.passes_per_sequence"),awayPps:pick(aa,"tempo.passes_per_sequence"),
    homeDirect:pick(ha,"tempo.direct_speed"),awayDirect:pick(aa,"tempo.direct_speed"),homeOpen:st("expected_goals_open_play","home"),awayOpen:st("expected_goals_open_play","away"),
    homeSet:st("expected_goals_set_play","home"),awaySet:st("expected_goals_set_play","away"),homePassAcc:pick(ha,"passing.pass_accuracy"),awayPassAcc:pick(aa,"passing.pass_accuracy"),
    homeIntoBox:pick(ha,"passing.passes_into_box"),awayIntoBox:pick(aa,"passing.passes_into_box"),homeProgDist:pick(ha,"passing.progressive_pass_distance"),awayProgDist:pick(aa,"passing.progressive_pass_distance"),
    homeCarryThird:pick(ha,"carrying.carries_into_final_third"),awayCarryThird:pick(aa,"carrying.carries_into_final_third"),homeCarryBox:pick(ha,"carrying.carries_into_box"),awayCarryBox:pick(aa,"carrying.carries_into_box"),
    homeDefX:pick(ha,"defending.avg_defensive_action_x"),awayDefX:pick(aa,"defending.avg_defensive_action_x"),homeBuild:pick(ha,"tempo.buildup_attacks"),awayBuild:pick(aa,"tempo.buildup_attacks"),
    homeDA:pick(ha,"tempo.direct_attacks"),awayDA:pick(aa,"tempo.direct_attacks"),homeCent:num(hn.centralization),awayCent:num(an.centralization)
  };
  await env.DB.prepare(\`INSERT INTO soccer_pitchapi_match_features(
    pitch_match_id,league_key,pitch_league_id,pitch_league_name,season,match_date,start_time,status,home_team_id,home_team_name,away_team_id,away_team_name,home_score,away_score,
    home_xg,away_xg,home_xgot,away_xgot,home_shots,away_shots,home_sot,away_sot,home_ppda,away_ppda,home_field_tilt,away_field_tilt,home_final_third_entries,away_final_third_entries,
    home_box_entries,away_box_entries,home_high_turnovers,away_high_turnovers,home_counterpress_regains,away_counterpress_regains,home_ball_recovery_time,away_ball_recovery_time,
    home_xt,away_xt,home_vaep,away_vaep,home_progressive_passes,away_progressive_passes,home_progressive_carries,away_progressive_carries,home_xag,away_xag,home_possession,away_possession,
    home_passes_per_sequence,away_passes_per_sequence,home_direct_speed,away_direct_speed,source_observed_at,created_at,updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(pitch_match_id) DO UPDATE SET status=excluded.status,home_score=excluded.home_score,away_score=excluded.away_score,home_xg=COALESCE(excluded.home_xg,home_xg),away_xg=COALESCE(excluded.away_xg,away_xg),
  home_ppda=COALESCE(excluded.home_ppda,home_ppda),away_ppda=COALESCE(excluded.away_ppda,away_ppda),home_field_tilt=COALESCE(excluded.home_field_tilt,home_field_tilt),away_field_tilt=COALESCE(excluded.away_field_tilt,away_field_tilt),updated_at=excluded.updated_at\`)
  .bind(m.id,row.heritage_key,row.pitch_league_id,row.heritage_name,row.season,m.date,m.time_utc,m.status,h.id,h.name,a.id,a.name,num(m.score_home),num(m.score_away),fx.homeXg,fx.awayXg,fx.homeXgot,fx.awayXgot,fx.homeShots,fx.awayShots,fx.homeSot,fx.awaySot,fx.homePpda,fx.awayPpda,fx.homeFieldTilt,fx.awayFieldTilt,fx.homeFinalThird,fx.awayFinalThird,fx.homeBox,fx.awayBox,fx.homeHigh,fx.awayHigh,fx.homeCounter,fx.awayCounter,fx.homeRecovery,fx.awayRecovery,fx.homeXt,fx.awayXt,fx.homeVaep,fx.awayVaep,fx.homeProg,fx.awayProg,fx.homeCarry,fx.awayCarry,fx.homeXag,fx.awayXag,fx.homePoss,fx.awayPoss,fx.homePps,fx.awayPps,fx.homeDirect,fx.awayDirect,now,now,now).run();
  await env.DB.prepare(\`UPDATE soccer_pitchapi_match_features SET home_npxg=?,away_npxg=?,home_xg_open_play=?,away_xg_open_play=?,home_xg_set_play=?,away_xg_set_play=?,home_xg_per_shot=?,away_xg_per_shot=?,home_pass_accuracy=?,away_pass_accuracy=?,home_passes_into_box=?,away_passes_into_box=?,home_progressive_pass_distance=?,away_progressive_pass_distance=?,home_carries_into_final_third=?,away_carries_into_final_third=?,home_carries_into_box=?,away_carries_into_box=?,home_avg_defensive_action_x=?,away_avg_defensive_action_x=?,home_buildup_attacks=?,away_buildup_attacks=?,home_direct_attacks=?,away_direct_attacks=?,home_network_centralization=?,away_network_centralization=? WHERE pitch_match_id=?\`)
    .bind(fx.homeOpen!=null&&fx.homeSet!=null?fx.homeOpen+fx.homeSet:null,fx.awayOpen!=null&&fx.awaySet!=null?fx.awayOpen+fx.awaySet:null,fx.homeOpen,fx.awayOpen,fx.homeSet,fx.awaySet,fx.homeShots?fx.homeXg/fx.homeShots:null,fx.awayShots?fx.awayXg/fx.awayShots:null,fx.homePassAcc,fx.awayPassAcc,fx.homeIntoBox,fx.awayIntoBox,fx.homeProgDist,fx.awayProgDist,fx.homeCarryThird,fx.awayCarryThird,fx.homeCarryBox,fx.awayCarryBox,fx.homeDefX,fx.awayDefX,fx.homeBuild,fx.awayBuild,fx.homeDA,fx.awayDA,fx.homeCent,fx.awayCent,m.id).run();
}
async function work(env){
  const row=await claim(env);if(!row)return{status:"QUEUE_EMPTY"};
  try{
    const list=await pitch(env,"/v1/leagues/"+row.pitch_league_id+"/matches?season="+encodeURIComponent(row.season)+"&status=played"),all=(list?.matches||[]).filter(m=>m.status==="finished").sort((a,b)=>String(a.time_utc||a.date).localeCompare(String(b.time_utc||b.date))),page=all.slice(Number(row.offset),Number(row.offset)+Number(row.page_size||4));
    let persisted=0,unavailable=0;
    for(let i=0;i<page.length;i+=2){
      await Promise.all(page.slice(i,i+2).map(async m=>{const [adv,shots,stats,network]=await Promise.all([pitch(env,"/v1/matches/"+m.id+"/advanced",true),pitch(env,"/v1/matches/"+m.id+"/shots",true),pitch(env,"/v1/matches/"+m.id+"/stats",true),pitch(env,"/v1/matches/"+m.id+"/advanced/network",true)]);if(!adv)unavailable++;await persist(env,row,m,adv,stats,shots,network);persisted++;}));
    }
    const now=new Date().toISOString(),done=Number(row.offset)+page.length>=all.length;
    await env.DB.prepare("UPDATE soccer_pitchapi_backfill_queue SET status='DONE',matches_seen=matches_seen+?,matches_persisted=matches_persisted+?,analytics_unavailable=analytics_unavailable+?,last_error=NULL,lease_until=NULL,updated_at=?,completed_at=? WHERE id=?").bind(page.length,persisted,unavailable,now,now,row.id).run();
    if(!done&&page.length){
      const off=Number(row.offset)+page.length,id=String(row.pitch_league_id)+":"+row.season+":"+off;
      await env.DB.prepare("INSERT OR IGNORE INTO soccer_pitchapi_backfill_queue(id,heritage_name,heritage_key,pitch_league_id,season,offset,page_size,status,attempts,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'PENDING',0,?,?)").bind(id,row.heritage_name,row.heritage_key,row.pitch_league_id,row.season,off,row.page_size,now,now).run();
    }
    await env.DB.prepare("UPDATE soccer_competition_coverage SET last_ingested_at=?,pitch_match_count=(SELECT COUNT(*) FROM soccer_pitchapi_match_features WHERE league_key=?),advanced_rows=(SELECT COUNT(*) FROM soccer_pitchapi_match_features WHERE league_key=? AND home_xg IS NOT NULL AND away_xg IS NOT NULL),history_start=(SELECT MIN(match_date) FROM soccer_pitchapi_match_features WHERE league_key=?),history_end=(SELECT MAX(match_date) FROM soccer_pitchapi_match_features WHERE league_key=?) WHERE heritage_name=?").bind(now,row.heritage_key,row.heritage_key,row.heritage_key,row.heritage_key,row.heritage_name).run();
    return{status:"PROCESSED",id:row.id,league:row.heritage_name,season:row.season,offset:row.offset,processed:page.length,persisted,done};
  }catch(e){
    const now=new Date().toISOString(),terminal=Number(row.attempts||0)+1>=6;
    await env.DB.prepare("UPDATE soccer_pitchapi_backfill_queue SET status=?,last_error=?,lease_until=NULL,updated_at=? WHERE id=?").bind(terminal?"FAILED":"PENDING",String(e?.message||e).slice(0,600),now,row.id).run();
    return{status:terminal?"FAILED":"RETRY",id:row.id,error:String(e?.message||e)};
  }
}
async function cycle(env){
  let discovery=null;
  const pending=await env.DB.prepare("SELECT COUNT(*) n FROM soccer_competition_coverage WHERE discovery_status IN ('PENDING','REVIEW')").first();
  if(Number(pending?.n||0)>0)discovery=await discover(env);
  const workResults=[];for(let i=0;i<2;i++){const r=await work(env);workResults.push(r);if(r.status==="QUEUE_EMPTY")break;}
  return{ok:true,at:new Date().toISOString(),discovery,work:workResults};
}
async function status(env){
  const c=await env.DB.prepare("SELECT discovery_status,COUNT(*) n FROM soccer_competition_coverage GROUP BY discovery_status").all();
  const q=await env.DB.prepare("SELECT status,COUNT(*) n FROM soccer_pitchapi_backfill_queue GROUP BY status").all();
  const m=await env.DB.prepare("SELECT COUNT(*) n,MIN(match_date) first_date,MAX(match_date) last_date FROM soccer_pitchapi_match_features").first();
  return{ok:true,coverage:c.results||[],queue:q.results||[],matches:m};
}
export default{
  async fetch(req,env){
    const u=new URL(req.url);
    if(req.method==="GET"&&u.pathname==="/health")return json({ok:true,service:"fbis-soccer-pitchapi-backfill",version:"v1",cron:true});
    if(req.method==="GET"&&u.pathname==="/status")return json(await status(env));
    if(req.method==="POST"&&u.pathname==="/run"){
      if(!env.SOCCER_CONTROL_TOKEN||req.headers.get("x-control-token")!==env.SOCCER_CONTROL_TOKEN)return json({ok:false,error:"unauthorized"},401);
      return json(await cycle(env));
    }
    return json({ok:false,error:"not found"},404);
  },
  async scheduled(_c,env,ctx){ctx.waitUntil(cycle(env).then(x=>console.log(JSON.stringify(x))).catch(e=>console.error(String(e?.stack||e))));}
};