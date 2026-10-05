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
    status=excluded.status,home_score=COALESCE(excluded.home_score,soccer_pitchapi_match_features.home_score),
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
