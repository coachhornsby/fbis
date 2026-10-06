#!/usr/bin/env node
import fs from "node:fs";
const args=Object.fromEntries(process.argv.slice(2).map(x=>x.split("="))),input=args.input||"artifacts/nba-deep-shadow.json",state=args.stateSnapshots||"artifacts/nba-latest-team-snapshots.json",out=args.sql||"artifacts/nba-deep-prospective-ledger.sql",codeSha=args.codeSha||process.env.GITHUB_SHA||"UNKNOWN";
const j=JSON.parse(fs.readFileSync(input,"utf8")),raw=JSON.parse(fs.readFileSync(state,"utf8")),flat=x=>Array.isArray(x)?(x.every(r=>Array.isArray(r?.results))?x.flatMap(r=>r.results||[]):x):[];
const snaps=new Map(flat(raw).map(x=>[String(x.team_key||"").toUpperCase(),x.id]));
const q=v=>v==null?"NULL":"'"+String(v).replaceAll("'","''")+"'",num=v=>Number.isFinite(Number(v))?String(Number(v)):"NULL";
const sql=[];
for(const r of j.rows||[]){const prediction=r.featureCutoff||j.createdAt,ids=[snaps.get(String(r.homeTeam).toUpperCase()),snaps.get(String(r.awayTeam).toUpperCase())].filter(Boolean);
 const id=[r.gameId,prediction,r.modelId,r.modelVersion].join(":");
 sql.push(`INSERT OR IGNORE INTO nba_prospective_game_shadow (id,game_id,tipoff_timestamp,prediction_timestamp,feature_cutoff_timestamp,model_id,model_version,code_sha,team_state_snapshot_ids_json,lineup_state_json,availability_state_json,schedule_state_json,lifecycle,projected_home,projected_away,projected_margin,projected_total,expected_possessions,p_home_win,sigma_margin,sigma_total,overlay_json,injury_buckets_json,schedule_buckets_json,market_used_as_feature,can_qualify,can_authorize,created_at) VALUES (${q(id)},${q(r.gameId)},${q(r.tipoff)},${q(prediction)},${q(prediction)},${q(r.modelId)},${q(r.modelVersion)},${q(codeSha)},${q(JSON.stringify(ids))},${q(JSON.stringify(r.decomposition?.lineups||{}))},${q(JSON.stringify({availabilityVerified:r.availabilityVerified}))},${q(JSON.stringify(r.decomposition?.schedule||{}))},'SHADOW',${num(r.home)},${num(r.away)},${num(r.margin)},${num(r.total)},${num(r.expectedPossessions)},${num(r.pHomeWin)},${num(r.sigmaMargin)},${num(r.sigmaTotal)},${q(JSON.stringify(r.decomposition||{}))},'[]','[]',0,0,0,${q(prediction)});`);
}
fs.writeFileSync(out,sql.join("\n")+(sql.length?"\n":""));console.log(JSON.stringify({ok:true,rows:sql.length,out},null,2));
