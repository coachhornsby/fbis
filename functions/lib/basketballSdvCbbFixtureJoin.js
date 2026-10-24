/**
 * Link NCAA men's basketball contest IDs to independent ESPN SDV schedule
 * observations by authentic ESPN game ID, home/away identity, completed
 * regulation format, official final scores and exact tipoff time.
 * No date-only approximations or inferred participants.
 */
const id=x=>x===null||x===undefined||x===""||x==="NA"?"":String(x);
const integer=x=>x===null||x===undefined||x===""?null:Number.isInteger(Number(x))?Number(x):null;
const clock=x=>{
 if(typeof x!=="string"||!x.trim())return null;
 const date=new Date(x.trim().replace(" ","T"));
 return Number.isFinite(date.getTime())?date.toISOString():null;
};
export function matchCbbNcaaPossessionsToEspnFixture({
 gameId,season,ncaaSchedule,firstPossession,espnFixture,fixtureSourceFingerprint
}={}){
 const reject=status=>({status,tipoff:null,evidence:null});
 if(!/^[a-f0-9]{64}$/i.test(fixtureSourceFingerprint||"")||
   !id(gameId)||!Number.isInteger(season)||!ncaaSchedule||
   !firstPossession||!espnFixture)
  return reject("CBB_INDEPENDENT_FIXTURE_ABSENT");
 const espnId=id(firstPossession.espn_game_id);
 if(!espnId||espnId!==id(espnFixture.id))
  return reject("CBB_ESPN_CROSSWALK_UNVERIFIED");
 if(id(ncaaSchedule.contest_id)!==id(gameId)||
   id(firstPossession.contest_id)!==id(gameId))
  return reject("CBB_NCAA_CONTEST_ID_MISMATCH");
 if(id(espnFixture.home_id)!==id(firstPossession.home_espn_team_id)||
   id(espnFixture.away_id)!==id(firstPossession.away_espn_team_id))
  return reject("CBB_HOME_AWAY_ESPN_ID_MISMATCH");
 const ncaaH=integer(ncaaSchedule.home_score),ncaaA=integer(ncaaSchedule.away_score);
 if(ncaaH===null||ncaaA===null||ncaaH!==integer(espnFixture.home_score)||
    ncaaA!==integer(espnFixture.away_score))
  return reject("CBB_INDEPENDENT_OFFICIAL_SCORES_MISMATCH");
 if(espnFixture.time_valid!==true||espnFixture.status_type_completed!==true||
    Number(espnFixture.format_regulation_periods)!==2||
    integer(espnFixture.season)!==season)
  return reject("CBB_ESPN_FIXTURE_NOT_FINAL_OR_TIME_UNVERIFIED");
 const tipoff=clock(espnFixture.game_date_time);
 if(!tipoff)return reject("CBB_EXACT_TIPOFF_UNAVAILABLE");
 const d=Date.parse(id(ncaaSchedule.game_date).slice(0,10)+"T00:00:00Z");
 if(!Number.isFinite(d)||Math.abs(Date.parse(tipoff)-d)>48*3600000)
  return reject("CBB_NCAA_VS_ESPN_DATE_MISMATCH");
 return{status:"INDEPENDENT_CBB_ESPN_EXACT_TIPOFF",tipoff,
  evidence:{gameId:id(gameId),espnGameId:espnId,tipoff,
   sourceFingerprint:fixtureSourceFingerprint,verified:true,
   canonicalHomeId:id(espnFixture.home_id),
   canonicalAwayId:id(espnFixture.away_id),
   canonicalHomeScore:ncaaH,canonicalAwayScore:ncaaA}};
}
