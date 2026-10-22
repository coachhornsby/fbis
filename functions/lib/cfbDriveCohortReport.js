/** First-party, operator-only V2 research cohort report in CFB_DB.
 * This is descriptive evaluation, not a wager-authorization or model selector.
 */
const finite=x=>typeof x==="number"&&Number.isFinite(x);
const round=x=>Math.round(x*1000)/1000;
const avg=arr=>arr.length?round(arr.reduce((a,b)=>a+b,0)/arr.length):null;
const pct=arr=>avg(arr);
function parse(s){try{return JSON.parse(s)}catch{return null}}
export function summarizeCfbDriveCohort(rows=[]){
 const items=[];
 for(const r of rows){
  const base=parse(r.baseline_json),dist=parse(r.distributions_json);
  if(!base||!dist?.total||!dist?.margin||!dist?.home_score||!dist?.away_score)continue;
  const bHome=base.home,bAway=base.away,h=dist.home_score.mean,a=dist.away_score.mean;
  if(![bHome,bAway,h,a].every(finite))continue;
  const official=finite(r.score_home)&&finite(r.score_away)&&Boolean(r.grade_run_id);
  const item={
   gameId:String(r.game_id),kickoff:r.kickoff,home:r.home_name,away:r.away_name,
   researchFrozenAt:r.frozen_at,sourceSnapshotFrozenAt:base.sourceFrozenAt||null,
   trainingGames:r.training_games,trainingDrives:r.training_drives,iterations:r.iterations,
   original:{home:bHome,away:bAway,total:round(bHome+bAway),margin:round(bHome-bAway)},
   v2:{home:round(h),away:round(a),total:round(dist.total.mean),margin:round(dist.margin.mean),
      totalP10:dist.total.p10,totalP90:dist.total.p90,marginP10:dist.margin.p10,marginP90:dist.margin.p90},
   graded:Boolean(official),
  };
  if(official){
   const total=r.score_home+r.score_away,margin=r.score_home-r.score_away;
   item.actual={home:r.score_home,away:r.score_away,total,margin};
   item.errors={
    originalTotal:round(Math.abs(total-(bHome+bAway))),
    originalMargin:round(Math.abs(margin-(bHome-bAway))),
    v2Total:round(Math.abs(total-dist.total.mean)),
    v2Margin:round(Math.abs(margin-dist.margin.mean)),
    v2Home:round(Math.abs(r.score_home-h)),
    v2Away:round(Math.abs(r.score_away-a)),
   };
   item.coverage={total80:r.total_80_covered,margin80:r.margin_80_covered,
       total90:r.total_90_covered,margin90:r.margin_90_covered};
  }
  items.push(item);
 }
 const graded=items.filter(x=>x.graded);
 const err=k=>avg(graded.map(x=>x.errors[k]));
 const coverage=k=>pct(graded.map(x=>x.coverage[k]));
 return {ok:true,scope:"CFB_DB",simulator:"CFB-DRIVE-STATE-SHADOW-v2",
   type:"RESEARCH_ONLY_PROSPECTIVE_COHORT",frozen:items.length,graded:graded.length,
   gradeCoverage:items.length?round(graded.length/items.length):null,
   paired:{
     totalErrorImprovement:graded.length?round(err("originalTotal")-err("v2Total")):null,
     marginErrorImprovement:graded.length?round(err("originalMargin")-err("v2Margin")):null,
     v2BetterTotalGames:graded.filter(x=>x.errors.v2Total<x.errors.originalTotal).length,
     v2BetterMarginGames:graded.filter(x=>x.errors.v2Margin<x.errors.originalMargin).length,
     tiesTotalGames:graded.filter(x=>x.errors.v2Total===x.errors.originalTotal).length,
     tiesMarginGames:graded.filter(x=>x.errors.v2Margin===x.errors.originalMargin).length,
   },
   calibrationStatus:graded.length>=30?"RESEARCH_EVALUABLE":"INSUFFICIENT_PROSPECTIVE_GRADES",
   scores:{originalTotalMAE:err("originalTotal"),v2TotalMAE:err("v2Total"),
     originalMarginMAE:err("originalMargin"),v2MarginMAE:err("v2Margin"),
     v2HomeMAE:err("v2Home"),v2AwayMAE:err("v2Away")},
   intervalCoverage:{total80:coverage("total80"),margin80:coverage("margin80"),
     total90:coverage("total90"),margin90:coverage("margin90")},
   games:items,canAuthorizeWager:false,changesProductionChampion:false,
   limitations:["NO_NCAA_OVERTIME","REGULATION_ONLY","NO_PLAYER_PROPS",
     "NO_UNVALIDATED_WIN_PROBABILITIES","NO_WAGER_AUTHORITY"]};
}
export async function cfbDriveCohortReport(env,{limit=80}={}){
 const db=env?.CFB_DB;
 if(!db?.prepare)throw Error("CFB_DB_UNBOUND");
 const cap=Math.min(100,Math.max(1,Number(limit)||80));
 const results=await db.prepare(
  `SELECT r.id, r.game_id, r.kickoff,r.frozen_at,
      r.training_games,r.training_drives,r.iterations,
      r.baseline_json,r.distributions_json,
      g.run_id grade_run_id,g.score_home,g.score_away,
      g.total_80_covered,g.margin_80_covered,g.total_90_covered,g.margin_90_covered,
      e.home_name,e.away_name
    FROM cfb_drive_shadow_runs r
    LEFT JOIN cfb_drive_shadow_grades g ON g.run_id=r.id
    LEFT JOIN games e ON e.id=r.game_id AND e.sport='cfb'
    WHERE r.authority='RESEARCH_SHADOW_ONLY'
      AND r.can_authorize_wager=0
      AND r.frozen_at<r.kickoff
      AND NOT EXISTS (
        SELECT 1 FROM cfb_drive_shadow_runs earlier
        WHERE earlier.game_id=r.game_id
          AND earlier.simulator_version=r.simulator_version
          AND (earlier.frozen_at<r.frozen_at OR
            (earlier.frozen_at=r.frozen_at AND earlier.id<r.id))
      )
    ORDER BY r.kickoff DESC,r.game_id ASC LIMIT ?`
 ).bind(cap).all();
 if(!Array.isArray(results?.results))throw Error("CFB_COHORT_READ_FAILED");
 return summarizeCfbDriveCohort(results.results);
}
