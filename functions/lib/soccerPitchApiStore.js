export function normalizeSoccerName(v=""){
  return String(v||"").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"")
    .replace(/\b(fc|cf|sc|afc|club|de|futbol|football|soccer)\b/g," ")
    .replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," ");
}
function n(v){const x=Number(v);return Number.isFinite(x)?x:null;}
function now(){return new Date().toISOString();}
function json(v){return v==null?null:JSON.stringify(v);}
export async function persistPitchApiBundle(env,bundle={}){
  const db=env?.DB;if(!db?.prepare)return{ok:false,reason:"d1-unbound"};
  const m=bundle.match||{}, f=bundle.features||{}, ts=bundle.observedAt||now(), created=now();
  if(!m.id||!bundle.leagueKey||!m.date||!m.homeTeam?.id||!m.awayTeam?.id)return{ok:false,reason:"invalid-bundle"};
  await db.prepare(`INSERT INTO soccer_pitchapi_match_features(
    pitch_match_id,fbis_event_id,league_key,pitch_league_id,pitch_league_name,season,match_date,start_time,status,
    home_team_id,home_team_name,away_team_id,away_team_name,home_score,away_score,
    home_xg,away_xg,home_xgot,away_xgot,home_shots,away_shots,home_sot,away_sot,home_big_chances,away_big_chances,
    home_ppda,away_ppda,home_field_tilt,away_field_tilt,home_final_third_entries,away_final_third_entries,
    home_box_entries,away_box_entries,home_high_turnovers,away_high_turnovers,home_counterpress_regains,away_counterpress_regains,
    home_ball_recovery_time,away_ball_recovery_time,home_xt,away_xt,home_vaep,away_vaep,
    home_progressive_passes,away_progressive_passes,home_progressive_carries,away_progressive_carries,
    home_xag,away_xag,home_possession,away_possession,home_passes_per_sequence,away_passes_per_sequence,
    home_direct_speed,away_direct_speed,source_observed_at,raw_advanced_json,raw_stats_json,raw_shots_json,created_at,updated_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(pitch_match_id) DO UPDATE SET
    fbis_event_id=COALESCE(excluded.fbis_event_id,soccer_pitchapi_match_features.fbis_event_id),
    season=COALESCE(excluded.season,soccer_pitchapi_match_features.season),
    match_date=excluded.match_date,
    start_time=COALESCE(excluded.start_time,soccer_pitchapi_match_features.start_time),
    status=excluded.status,
    home_team_name=COALESCE(excluded.home_team_name,soccer_pitchapi_match_features.home_team_name),
    away_team_name=COALESCE(excluded.away_team_name,soccer_pitchapi_match_features.away_team_name),
    home_score=COALESCE(excluded.home_score,soccer_pitchapi_match_features.home_score),
    away_score=COALESCE(excluded.away_score,soccer_pitchapi_match_features.away_score),
    home_xg=COALESCE(excluded.home_xg,soccer_pitchapi_match_features.home_xg),away_xg=COALESCE(excluded.away_xg,soccer_pitchapi_match_features.away_xg),
    home_xgot=COALESCE(excluded.home_xgot,soccer_pitchapi_match_features.home_xgot),away_xgot=COALESCE(excluded.away_xgot,soccer_pitchapi_match_features.away_xgot),
    home_shots=COALESCE(excluded.home_shots,soccer_pitchapi_match_features.home_shots),away_shots=COALESCE(excluded.away_shots,soccer_pitchapi_match_features.away_shots),
    home_sot=COALESCE(excluded.home_sot,soccer_pitchapi_match_features.home_sot),away_sot=COALESCE(excluded.away_sot,soccer_pitchapi_match_features.away_sot),
    home_big_chances=COALESCE(excluded.home_big_chances,soccer_pitchapi_match_features.home_big_chances),away_big_chances=COALESCE(excluded.away_big_chances,soccer_pitchapi_match_features.away_big_chances),
    home_ppda=COALESCE(excluded.home_ppda,soccer_pitchapi_match_features.home_ppda),away_ppda=COALESCE(excluded.away_ppda,soccer_pitchapi_match_features.away_ppda),
    home_field_tilt=COALESCE(excluded.home_field_tilt,soccer_pitchapi_match_features.home_field_tilt),away_field_tilt=COALESCE(excluded.away_field_tilt,soccer_pitchapi_match_features.away_field_tilt),
    home_final_third_entries=COALESCE(excluded.home_final_third_entries,soccer_pitchapi_match_features.home_final_third_entries),
    away_final_third_entries=COALESCE(excluded.away_final_third_entries,soccer_pitchapi_match_features.away_final_third_entries),
    home_box_entries=COALESCE(excluded.home_box_entries,soccer_pitchapi_match_features.home_box_entries),away_box_entries=COALESCE(excluded.away_box_entries,soccer_pitchapi_match_features.away_box_entries),
    home_high_turnovers=COALESCE(excluded.home_high_turnovers,soccer_pitchapi_match_features.home_high_turnovers),away_high_turnovers=COALESCE(excluded.away_high_turnovers,soccer_pitchapi_match_features.away_high_turnovers),
    home_counterpress_regains=COALESCE(excluded.home_counterpress_regains,soccer_pitchapi_match_features.home_counterpress_regains),
    away_counterpress_regains=COALESCE(excluded.away_counterpress_regains,soccer_pitchapi_match_features.away_counterpress_regains),
    home_ball_recovery_time=COALESCE(excluded.home_ball_recovery_time,soccer_pitchapi_match_features.home_ball_recovery_time),
    away_ball_recovery_time=COALESCE(excluded.away_ball_recovery_time,soccer_pitchapi_match_features.away_ball_recovery_time),
    home_xt=COALESCE(excluded.home_xt,soccer_pitchapi_match_features.home_xt),away_xt=COALESCE(excluded.away_xt,soccer_pitchapi_match_features.away_xt),
    home_vaep=COALESCE(excluded.home_vaep,soccer_pitchapi_match_features.home_vaep),away_vaep=COALESCE(excluded.away_vaep,soccer_pitchapi_match_features.away_vaep),
    home_progressive_passes=COALESCE(excluded.home_progressive_passes,soccer_pitchapi_match_features.home_progressive_passes),
    away_progressive_passes=COALESCE(excluded.away_progressive_passes,soccer_pitchapi_match_features.away_progressive_passes),
    home_progressive_carries=COALESCE(excluded.home_progressive_carries,soccer_pitchapi_match_features.home_progressive_carries),
    away_progressive_carries=COALESCE(excluded.away_progressive_carries,soccer_pitchapi_match_features.away_progressive_carries),
    home_xag=COALESCE(excluded.home_xag,soccer_pitchapi_match_features.home_xag),away_xag=COALESCE(excluded.away_xag,soccer_pitchapi_match_features.away_xag),
    home_possession=COALESCE(excluded.home_possession,soccer_pitchapi_match_features.home_possession),away_possession=COALESCE(excluded.away_possession,soccer_pitchapi_match_features.away_possession),
    home_passes_per_sequence=COALESCE(excluded.home_passes_per_sequence,soccer_pitchapi_match_features.home_passes_per_sequence),
    away_passes_per_sequence=COALESCE(excluded.away_passes_per_sequence,soccer_pitchapi_match_features.away_passes_per_sequence),
    home_direct_speed=COALESCE(excluded.home_direct_speed,soccer_pitchapi_match_features.home_direct_speed),
    away_direct_speed=COALESCE(excluded.away_direct_speed,soccer_pitchapi_match_features.away_direct_speed),
    source_observed_at=excluded.source_observed_at,raw_advanced_json=COALESCE(excluded.raw_advanced_json,soccer_pitchapi_match_features.raw_advanced_json),
    raw_stats_json=COALESCE(excluded.raw_stats_json,soccer_pitchapi_match_features.raw_stats_json),
    raw_shots_json=COALESCE(excluded.raw_shots_json,soccer_pitchapi_match_features.raw_shots_json),updated_at=excluded.updated_at`).bind(
      m.id,bundle.fbisEventId||null,bundle.leagueKey,m.league?.id||bundle.pitchLeagueId||null,m.league?.name||bundle.pitchLeagueName||null,bundle.season||null,m.date,m.startTime||m.timeUtc||null,m.status||null,
      m.homeTeam.id,m.homeTeam.name,m.awayTeam.id,m.awayTeam.name,n(m.homeScore),n(m.awayScore),
      n(f.homeXg),n(f.awayXg),n(f.homeXgot),n(f.awayXgot),n(f.homeShots),n(f.awayShots),n(f.homeSot),n(f.awaySot),n(f.homeBigChances),n(f.awayBigChances),
      n(f.homePpda),n(f.awayPpda),n(f.homeFieldTilt),n(f.awayFieldTilt),n(f.homeFinalThirdEntries),n(f.awayFinalThirdEntries),
      n(f.homeBoxEntries),n(f.awayBoxEntries),n(f.homeHighTurnovers),n(f.awayHighTurnovers),n(f.homeCounterpressRegains),n(f.awayCounterpressRegains),
      n(f.homeBallRecoveryTime),n(f.awayBallRecoveryTime),n(f.homeXt),n(f.awayXt),n(f.homeVaep),n(f.awayVaep),
      n(f.homeProgressivePasses),n(f.awayProgressivePasses),n(f.homeProgressiveCarries),n(f.awayProgressiveCarries),
      n(f.homeXag),n(f.awayXag),n(f.homePossession),n(f.awayPossession),n(f.homePassesPerSequence),n(f.awayPassesPerSequence),
      n(f.homeDirectSpeed),n(f.awayDirectSpeed),ts,json(bundle.rawAdvanced),json(bundle.rawStats),json(bundle.rawShots),created,created
    ).run();

  await db.prepare(`UPDATE soccer_pitchapi_match_features SET
    home_npxg=COALESCE(?,home_npxg),away_npxg=COALESCE(?,away_npxg),
    home_xg_open_play=COALESCE(?,home_xg_open_play),away_xg_open_play=COALESCE(?,away_xg_open_play),
    home_xg_set_play=COALESCE(?,home_xg_set_play),away_xg_set_play=COALESCE(?,away_xg_set_play),
    home_xg_per_shot=COALESCE(?,home_xg_per_shot),away_xg_per_shot=COALESCE(?,away_xg_per_shot),
    home_pass_accuracy=COALESCE(?,home_pass_accuracy),away_pass_accuracy=COALESCE(?,away_pass_accuracy),
    home_passes_into_box=COALESCE(?,home_passes_into_box),away_passes_into_box=COALESCE(?,away_passes_into_box),
    home_key_passes=COALESCE(?,home_key_passes),away_key_passes=COALESCE(?,away_key_passes),
    home_through_balls=COALESCE(?,home_through_balls),away_through_balls=COALESCE(?,away_through_balls),
    home_progressive_pass_distance=COALESCE(?,home_progressive_pass_distance),away_progressive_pass_distance=COALESCE(?,away_progressive_pass_distance),
    home_carries_into_final_third=COALESCE(?,home_carries_into_final_third),away_carries_into_final_third=COALESCE(?,away_carries_into_final_third),
    home_carries_into_box=COALESCE(?,home_carries_into_box),away_carries_into_box=COALESCE(?,away_carries_into_box),
    home_avg_defensive_action_x=COALESCE(?,home_avg_defensive_action_x),away_avg_defensive_action_x=COALESCE(?,away_avg_defensive_action_x),
    home_buildup_attacks=COALESCE(?,home_buildup_attacks),away_buildup_attacks=COALESCE(?,away_buildup_attacks),
    home_direct_attacks=COALESCE(?,home_direct_attacks),away_direct_attacks=COALESCE(?,away_direct_attacks),
    home_network_centralization=COALESCE(?,home_network_centralization),away_network_centralization=COALESCE(?,away_network_centralization)
    WHERE pitch_match_id=?`).bind(
      n(f.homeNpxg),n(f.awayNpxg),n(f.homeXgOpenPlay),n(f.awayXgOpenPlay),n(f.homeXgSetPlay),n(f.awayXgSetPlay),
      n(f.homeXgPerShot),n(f.awayXgPerShot),n(f.homePassAccuracy),n(f.awayPassAccuracy),n(f.homePassesIntoBox),n(f.awayPassesIntoBox),
      n(f.homeKeyPasses),n(f.awayKeyPasses),n(f.homeThroughBalls),n(f.awayThroughBalls),
      n(f.homeProgressivePassDistance),n(f.awayProgressivePassDistance),n(f.homeCarriesIntoFinalThird),n(f.awayCarriesIntoFinalThird),
      n(f.homeCarriesIntoBox),n(f.awayCarriesIntoBox),n(f.homeAvgDefensiveActionX),n(f.awayAvgDefensiveActionX),
      n(f.homeBuildupAttacks),n(f.awayBuildupAttacks),n(f.homeDirectAttacks),n(f.awayDirectAttacks),
      n(f.homeNetworkCentralization),n(f.awayNetworkCentralization),m.id
    ).run();

  let players=0,lineups=0;
  for(const p of bundle.players||[]){
    if(!p?.playerId||!p?.teamId)continue;
    await db.prepare(`INSERT INTO soccer_pitchapi_player_match(
      id,pitch_match_id,league_key,match_date,team_id,player_id,player_name,minutes_played,actions,xt_total,vaep_total,xag,xg_chain,xg_buildup,
      progressive_passes,progressive_carries,chances_created,shots,source_observed_at,raw_json,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(pitch_match_id,player_id) DO UPDATE SET
      minutes_played=COALESCE(excluded.minutes_played,soccer_pitchapi_player_match.minutes_played),
      actions=COALESCE(excluded.actions,soccer_pitchapi_player_match.actions),xt_total=COALESCE(excluded.xt_total,soccer_pitchapi_player_match.xt_total),
      vaep_total=COALESCE(excluded.vaep_total,soccer_pitchapi_player_match.vaep_total),xag=COALESCE(excluded.xag,soccer_pitchapi_player_match.xag),
      xg_chain=COALESCE(excluded.xg_chain,soccer_pitchapi_player_match.xg_chain),xg_buildup=COALESCE(excluded.xg_buildup,soccer_pitchapi_player_match.xg_buildup),
      progressive_passes=COALESCE(excluded.progressive_passes,soccer_pitchapi_player_match.progressive_passes),
      progressive_carries=COALESCE(excluded.progressive_carries,soccer_pitchapi_player_match.progressive_carries),
      chances_created=COALESCE(excluded.chances_created,soccer_pitchapi_player_match.chances_created),
      shots=COALESCE(excluded.shots,soccer_pitchapi_player_match.shots),source_observed_at=excluded.source_observed_at,
      raw_json=COALESCE(excluded.raw_json,soccer_pitchapi_player_match.raw_json),updated_at=excluded.updated_at`).bind(
        `${m.id}:${p.playerId}`,m.id,bundle.leagueKey,m.date,p.teamId,p.playerId,p.playerName||null,n(p.minutesPlayed),n(p.actions),n(p.xtTotal),n(p.vaepTotal),n(p.xag),n(p.xgChain),n(p.xgBuildup),
        n(p.progressivePasses),n(p.progressiveCarries),n(p.chancesCreated),n(p.shots),ts,json(p.raw||p),created,created
      ).run();
    await db.prepare(`UPDATE soccer_pitchapi_player_match SET
      vaep_offensive=COALESCE(?,vaep_offensive),vaep_defensive=COALESCE(?,vaep_defensive),pv_total=COALESCE(?,pv_total),
      goals=COALESCE(?,goals),assists=COALESCE(?,assists),expected_goals=COALESCE(?,expected_goals),expected_assists=COALESCE(?,expected_assists),
      saves=COALESCE(?,saves),claims=COALESCE(?,claims),claims_won=COALESCE(?,claims_won),sweeper_actions=COALESCE(?,sweeper_actions),
      distribution_accuracy=COALESCE(?,distribution_accuracy),avg_pass_length=COALESCE(?,avg_pass_length)
      WHERE pitch_match_id=? AND player_id=?`).bind(
        n(p.vaepOffensive),n(p.vaepDefensive),n(p.pvTotal),n(p.goals),n(p.assists),n(p.expectedGoals),n(p.expectedAssists),
        n(p.saves),n(p.claims),n(p.claimsWon),n(p.sweeperActions),n(p.distributionAccuracy),n(p.avgPassLength),m.id,p.playerId
      ).run();players++;
  }
  for(const l of bundle.lineups||[]){
    if(!l?.teamId)continue;
    const observed=new Date(ts).getTime(),kick=new Date(m.startTime||m.timeUtc||"").getTime();
    const pre=Number.isFinite(observed)&&Number.isFinite(kick)&&observed<kick?1:0;
    const post=pre?0:1;
    await db.prepare(`INSERT OR REPLACE INTO soccer_pitchapi_lineup_observations(
      id,pitch_match_id,league_key,team_id,side,kickoff_time,observed_at,confirmed,lineup_type,formation,starters_json,subs_json,coach_name,pre_match,post_match,raw_json,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
      `${m.id}:${l.side}:${ts}`,m.id,bundle.leagueKey,l.teamId,l.side,m.startTime||m.timeUtc||null,ts,l.confirmed?1:0,l.lineupType||null,l.formation||null,
      json(l.starters||[]),json(l.subs||[]),l.coachName||null,pre,post,json(l.raw||l),created
    ).run();lineups++;
  }
  return{ok:true,match:1,players,lineups};
}
export async function refreshPitchApiCompetitionCoverage(env,{leagueKey}={}){
  const db=env?.DB;if(!db?.prepare||!leagueKey)return{ok:false,reason:"d1-unbound-or-league-missing"};
  const row=await db.prepare(`SELECT
      COUNT(*) AS pitch_match_count,
      SUM(CASE WHEN
        status='finished' AND
        home_score IS NOT NULL AND away_score IS NOT NULL AND
        home_xg IS NOT NULL AND away_xg IS NOT NULL AND
        home_ppda IS NOT NULL AND away_ppda IS NOT NULL AND
        home_field_tilt IS NOT NULL AND away_field_tilt IS NOT NULL AND
        home_network_centralization IS NOT NULL AND away_network_centralization IS NOT NULL
      THEN 1 ELSE 0 END) AS advanced_rows,
      MIN(match_date) AS history_start,
      MAX(match_date) AS history_end
    FROM soccer_pitchapi_match_features
    WHERE league_key=?`).bind(leagueKey).first();
  const total=Math.max(0,Number(row?.pitch_match_count)||0);
  const advanced=Math.max(0,Number(row?.advanced_rows)||0);
  const coverage=total>0?advanced/total:null;
  const updated=now();
  await db.prepare(`UPDATE soccer_competition_coverage
    SET pitch_match_count=?,advanced_rows=?,advanced_coverage=?,history_start=?,history_end=?,last_ingested_at=?
    WHERE heritage_key=?`).bind(
      total,advanced,coverage,row?.history_start||null,row?.history_end||null,updated,leagueKey
    ).run();
  return{ok:true,leagueKey,pitchMatchCount:total,advancedRows:advanced,advancedCoverage:coverage,historyStart:row?.history_start||null,historyEnd:row?.history_end||null};
}

export async function loadPitchApiHistory(env,{leagueKey,beforeDate,startDate="2021-01-01"}={}){
  const db=env?.DB;if(!db?.prepare||!leagueKey)return[];
  const r=await db.prepare(`SELECT * FROM soccer_pitchapi_match_features
    WHERE league_key=? AND match_date>=? AND match_date<? AND status='finished'
    ORDER BY match_date,pitch_match_id`).bind(leagueKey,startDate,beforeDate||"9999-12-31").all();
  return r?.results||[];
}
export async function loadEligiblePitchApiLineups(env,{pitchMatchId,cutoff}={}){
  const db=env?.DB;if(!db?.prepare||!pitchMatchId)return[];
  const r=await db.prepare(`SELECT * FROM soccer_pitchapi_lineup_observations
    WHERE pitch_match_id=? AND pre_match=1 AND observed_at<? ORDER BY observed_at DESC`).bind(pitchMatchId,cutoff||now()).all();
  return r?.results||[];
}

export async function findPitchApiFixture(env,{leagueKey,date,homeName,awayName}={}){
  const db=env?.DB;if(!db?.prepare||!leagueKey||!date)return null;
  const r=await db.prepare(`SELECT * FROM soccer_pitchapi_match_features
    WHERE league_key=? AND match_date=? ORDER BY source_observed_at DESC`).bind(leagueKey,date).all();
  const h=normalizeSoccerName(homeName),a=normalizeSoccerName(awayName);
  return (r?.results||[]).find(x=>normalizeSoccerName(x.home_team_name)===h&&normalizeSoccerName(x.away_team_name)===a)||null;
}
export async function loadPitchApiPlayerHistory(env,{playerIds=[],beforeDate,startDate="2021-01-01"}={}){
  const db=env?.DB;if(!db?.prepare||!playerIds.length)return[];
  const ids=playerIds.map(String).slice(0,30),qs=ids.map(()=>"?").join(",");
  const r=await db.prepare(`SELECT * FROM soccer_pitchapi_player_match
    WHERE player_id IN (${qs}) AND match_date>=? AND match_date<? ORDER BY match_date`).bind(...ids,startDate,beforeDate||"9999-12-31").all();
  return r?.results||[];
}

export function pitchApiRowToGame(row={}){
  return {
    id:String(row.pitch_match_id||""),
    date:row.match_date||null,
    start:row.start_time||row.match_date||null,
    status:row.status||null,
    soccerLeague:String(row.league_key||""),
    league:String(row.league_key||""),
    source:"pitchapi:d1",
    // Explicit null market shell: generic board projection code expects an odds
    // object even when a PitchAPI-only fixture has no executable market yet.
    // Nulls preserve market/model separation and never fabricate a price.
    odds:{spread:null,total:null,homeMl:null,awayMl:null,details:"",book:null},
    home:{id:row.home_team_id,name:row.home_team_name,displayName:row.home_team_name},
    away:{id:row.away_team_id,name:row.away_team_name,displayName:row.away_team_name},
    homeScore:n(row.home_score),awayScore:n(row.away_score),
    homeShotsOnTarget:n(row.home_sot),awayShotsOnTarget:n(row.away_sot),
    homePossession:n(row.home_possession),awayPossession:n(row.away_possession),
    homeXg:n(row.home_xg),awayXg:n(row.away_xg),
    homePpda:n(row.home_ppda),awayPpda:n(row.away_ppda),
    pitchLeagueId:row.pitch_league_id||null,pitchLeagueName:row.pitch_league_name||null,
  };
}
export async function loadPitchApiBoardFixtures(env,{date}={}){
  const db=env?.DB;if(!db?.prepare||!date)return[];
  const r=await db.prepare(`SELECT f.* FROM soccer_pitchapi_match_features f
    JOIN soccer_competition_coverage c ON c.heritage_key=f.league_key
    WHERE f.match_date=? AND c.discovery_status='MATCHED' AND c.model_eligible=1
    ORDER BY f.start_time,f.pitch_match_id`).bind(String(date).slice(0,10)).all();
  return (r?.results||[]).map(pitchApiRowToGame);
}
export function pitchApiHistoryToGames(rows=[]){
  return rows.map(pitchApiRowToGame).filter(g=>g.id&&g.date);
}
