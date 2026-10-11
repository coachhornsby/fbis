/** Nonproduction D1/R2 pilot. No route, scheduler or production activation.
 * Identity verifier is mandatory and must qualify game, season-aware teams,
 * time-aware athlete memberships and participation from approved source contracts.
 * D1 batch is one transaction; pointer guards prevent concurrent lost updates.
 */
import { sha256Hex } from './sha256Hex.js';

class CfbValidationError extends Error {}
class CfbPartialSourceError extends CfbValidationError {}
const PRODUCTION_DB = 'b50c724c-903b-4241-8ce1-48d931e7a44c';
const stable = value => JSON.stringify(value, (_key, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
const time = value => {
  if (!value || !/Z$|[+-]\d\d:\d\d$/.test(value)) throw new Error('Explicit UTC offset required');
  const n = Date.parse(value); if (!Number.isFinite(n)) throw new Error('Invalid timestamp'); return n;
};
const all = async statement => (await statement.all()).results || [];
const additive = new Set(['points','plays','yards','rushes','rush_yards','pass_attempts','completions',
  'pass_yards','passing_yards','passing_attempts','passing_td','passing_interceptions','rushing_attempts','rushing_yards','rushing_td','receiving_yards','receiving_td','sacks','turnovers','penalties','penalty_yards','third_attempts','third_conversions',
  'fourth_attempts','fourth_conversions','redzone_attempts','redzone_scores','explosive_plays','field_goal_attempts','field_goals','punts','punt_yards','receptions','total_tackles','solo_tackles','tackles_for_loss','passes_defended','hurries','defensive_td','defensive_interceptions','interception_return_yards','interception_td','fumbles','fumbles_lost','fumbles_recovered','kick_returns','kick_return_yards','kick_return_td','field_goals_made','extra_points_made','extra_point_attempts','kicking_points','touchbacks','punts_inside_20','punt_returns','punt_return_yards','punt_return_td','touchdowns','epa_total']);
const maxima=new Set(['long_rushing','long_reception','long_field_goal','long_punt','long_kick_return','long_punt_return']);
export function aggregatePostgameMetrics(records) {
  const result = {};
  for (const key of new Set(records.flatMap(row => Object.keys(row)))) {
    const v = records.map(r => r[key]).filter(v => v != null);
    result[key] = { games: v.length, total: v.length && additive.has(key) ? v.reduce((a,b) => a+b,0) : null,
      mean: v.length && !maxima.has(key) ? v.reduce((a,b) => a+b,0)/v.length : null,
      maximum: v.length && maxima.has(key) ? Math.max(...v) : null,
      aggregation:maxima.has(key)?'maximum_of_available_game_values':additive.has(key)?'additive':'mean_of_available_game_values' };
  }
  for (const [key,numerator,denominator] of [['yards_per_play','yards','plays'],['completion_rate','completions','pass_attempts'],['player_completion_rate','completions','passing_attempts'],['third_down_rate','third_conversions','third_attempts'],['field_goal_rate','field_goals_made','field_goal_attempts'],['epa_per_play','epa_total','plays']]) {
    const pairs = records.filter(r => r[numerator] != null && r[denominator] != null);
    const denom = pairs.reduce((a,r) => a+r[denominator],0);
    result[key] = { games: pairs.length, value: denom ? pairs.reduce((a,r) => a+r[numerator],0)/denom : null };
  }
  return result;
}
export function validatePostgameEnvelope(p, at) {
  if (p.status !== 'FINAL' || !p.source || !p.provider_game_id || !p.game_id || !Number.isInteger(p.season)) throw new CfbValidationError('Unqualified final envelope');
  if (!(time(p.game_at) < time(p.observed_at) && time(p.observed_at) <= time(at))) throw new CfbValidationError('Invalid chronology');
  if (p.provider_final_at && !(time(p.game_at)<=time(p.provider_final_at)&&time(p.provider_final_at)<=time(p.observed_at))) throw new CfbValidationError('Invalid provider final clock');
  if (p.source_available_at && time(p.source_available_at)>time(p.observed_at)) throw new CfbValidationError('Invalid source availability clock');
  if (!['POSTGAME_OBSERVED','RETROSPECTIVE'].includes(p.temporal_class)) throw new CfbValidationError('Explicit temporal class required');
  if (p.teams?.length !== 2 || new Set(p.teams.map(t => t.team_id)).size !== 2 ||
      stable(p.teams.map(t => t.side).sort()) !== stable(['away','home'])) throw new CfbValidationError('Invalid game orientation');
  for (const t of p.teams) {
    if (!t.team_id || !t.provider_team_id || t.team_complete !== true || t.player_complete !== true || !Array.isArray(t.players)) throw new CfbPartialSourceError('Partial source');
    if (!Number.isInteger(t.metrics?.points) || t.metrics.points < 0 || t.metrics.points !== p.scores[t.side]) throw new CfbValidationError('Score reconciliation failure');
    const seen = new Set();
    for (const player of t.players) {
      if (!player.player_id || !player.provider_player_id || player.participated !== true || seen.has(player.player_id)) throw new CfbValidationError('Invalid participant');
      seen.add(player.player_id);
    }
    for (const metrics of [t.metrics, ...t.players.map(p => p.metrics)]) {
      if (!metrics || Object.values(metrics).some(v => v != null && (typeof v !== 'number' || !Number.isFinite(v)))) throw new CfbValidationError('Invalid metric');
      for (const [made,attempts] of [['completions','pass_attempts'],['third_conversions','third_attempts'],['fourth_conversions','fourth_attempts'],['field_goals_made','field_goal_attempts'],['field_goals','field_goal_attempts']]) {
        if(metrics[made]!=null&&metrics[attempts]!=null&&!(0<=metrics[made]&&metrics[made]<=metrics[attempts])) throw new CfbValidationError('Invalid attempt reconciliation');
      }
    }
  }
}
function materialize(teamId, season, games) {
  const relevant = games.filter(g => g.payload.season === season && g.payload.teams.some(t => t.team_id === teamId));
  relevant.sort((a,b) => time(a.payload.game_at)-time(b.payload.game_at) || a.version.localeCompare(b.version));
  const offense = [], defense = [], players = {}; let wins=0,losses=0,ties=0;
  for (const g of relevant) {
    const own = g.payload.teams.find(t => t.team_id === teamId), other = g.payload.teams.find(t => t.team_id !== teamId);
    offense.push(own.metrics); defense.push(other.metrics);
    wins += own.metrics.points > other.metrics.points; losses += own.metrics.points < other.metrics.points; ties += own.metrics.points === other.metrics.points;
    for (const p of own.players) (players[p.player_id] ||= []).push(p.metrics);
  }
  return {team_id:teamId,season,games:relevant.length,record:{wins,losses,ties},
    offense:aggregatePostgameMetrics(offense),defense:aggregatePostgameMetrics(defense),rolling5:aggregatePostgameMetrics(offense.slice(-5)),
    players:Object.fromEntries(Object.entries(players).map(([id,rows]) => [id,aggregatePostgameMetrics(rows)])),
    game_versions:relevant.map(g => g.version),opponent_adjusted:null,model_authority:false,wager_authority:false};
}
export async function processCfbPostgamePilot({db,archive,databaseId,mode,identityVerifier,payload,rawBody,at}) {
  if (mode !== 'nonproduction' || !databaseId || databaseId === PRODUCTION_DB) throw new Error('Pilot refuses production database');
  if (!db || !archive || typeof identityVerifier !== 'function') throw new Error('Qualified dependencies required');
  if (typeof rawBody !== 'string' || !rawBody.trim()) throw new Error('Original source bytes required');
  JSON.parse(rawBody);
  const raw = rawBody, rawHash = await sha256Hex(raw), rawKey = `cfb/postgame-pilot/raw/${rawHash}.json`;
  // Original evidence survives rejected normalization; content-addressed put is idempotent.
  await archive.put(rawKey, raw, {httpMetadata:{contentType:'application/json'}});
  const s = (sql,...values) => db.prepare(sql).bind(...values);
  const state = (value,error=null) => s('INSERT INTO cfb_postgame_jobs(game_id,state,attempts,last_error,updated_at) VALUES(?,?,1,?,?) ON CONFLICT(game_id) DO UPDATE SET state=excluded.state,attempts=cfb_postgame_jobs.attempts+1,last_error=excluded.last_error,updated_at=excluded.updated_at',payload.game_id,value,error,at).run();
  await state('VALIDATING');
  try {
    validatePostgameEnvelope(payload, at);
    if (new TextEncoder().encode(stable(payload)).length > 1_900_000) throw new Error('Payload exceeds qualified D1 row bound');
    const identity = await identityVerifier(payload,{rawBody,rawHash,rawKey});
    if (identity?.verified !== true || identity?.fbs_involving !== true) throw new CfbValidationError('Canonical identity qualification failed');
    const normalized = {...payload}; for (const key of ['observed_at','provider_final_at','source_available_at']) delete normalized[key];
    normalized.teams=normalized.teams.map(t=>({...t,players:[...t.players].sort((a,b)=>a.player_id.localeCompare(b.player_id))})).sort((a,b)=>a.side.localeCompare(b.side));
    const version = await sha256Hex(stable(normalized));
    const prior = await s('SELECT v.id,v.observed_at,v.body_json FROM cfb_postgame_game_current c JOIN cfb_postgame_game_versions v ON v.id=c.version_id WHERE c.game_id=?',payload.game_id).first();
    if (prior?.id === version) { await state('VERIFIED'); return {version,duplicate:true}; }
    if (prior && time(payload.observed_at) <= time(prior.observed_at)) throw new CfbValidationError('Out-of-order correction');
    if (prior) {
      const old=JSON.parse(prior.body_json);
      if (old.game_at !== payload.game_at || old.season !== payload.season || stable(old.teams.map(t=>t.team_id).sort()) !== stable(payload.teams.map(t=>t.team_id).sort())) throw new CfbValidationError('Game identity changed');
    }
    if (await s('SELECT id FROM cfb_postgame_game_versions WHERE id=?',version).first()) throw new CfbValidationError('Old version replay');
    // Capture pointers before reading dependent games. A concurrent commit after
    // this point must fail the transaction guard instead of publishing a stale sum.
    const expectedCards=[];
    for (const t of payload.teams) expectedCards.push(await s('SELECT version_id FROM cfb_postgame_card_current WHERE team_id=? AND season=?',t.team_id,payload.season).first());
    const existing = await all(s("SELECT v.id,v.body_json FROM cfb_postgame_game_current c JOIN cfb_postgame_game_versions v ON v.id=c.version_id WHERE v.season=? AND EXISTS (SELECT 1 FROM json_each(v.body_json,'$.teams') t WHERE json_extract(t.value,'$.team_id') IN (?,?)) LIMIT 129",payload.season,payload.teams[0].team_id,payload.teams[1].team_id));
    if (existing.length>128) throw new Error('Team season scope exceeds qualified bound');
    const games=existing.filter(r => JSON.parse(r.body_json).game_id !== payload.game_id).map(r => ({version:r.id,payload:JSON.parse(r.body_json)}));
    games.push({version,payload});
    const guards=[s("SELECT CASE WHEN COALESCE((SELECT version_id FROM cfb_postgame_game_current WHERE game_id=?),'')=? THEN 1 ELSE json('cfb_pilot_game_conflict') END",payload.game_id,prior?.id || '')];
    for (let i=0;i<2;i++) guards.push(s("SELECT CASE WHEN COALESCE((SELECT version_id FROM cfb_postgame_card_current WHERE team_id=? AND season=?),'')=? THEN 1 ELSE json('cfb_pilot_card_conflict') END",payload.teams[i].team_id,payload.season,expectedCards[i]?.version_id || ''));
    const writes=[s('INSERT INTO cfb_postgame_game_versions VALUES(?,?,?,?,?,?,?,?)',version,payload.game_id,payload.season,payload.observed_at,at,rawKey,rawHash,stable(payload)),
      s('INSERT INTO cfb_postgame_game_current VALUES(?,?) ON CONFLICT(game_id) DO UPDATE SET version_id=excluded.version_id',payload.game_id,version)];
    for (const t of payload.teams) {
      const card=materialize(t.team_id,payload.season,games), body=stable(card), cid=await sha256Hex(body);
      writes.push(s('INSERT INTO cfb_postgame_card_versions VALUES(?,?,?,?,?)',cid,t.team_id,payload.season,at,body),
        s('INSERT INTO cfb_postgame_card_current VALUES(?,?,?) ON CONFLICT(team_id,season) DO UPDATE SET version_id=excluded.version_id',t.team_id,payload.season,cid));
    }
    for (const kind of ['CACHE_INVALIDATION','MODEL_STATE_RESEARCH_REFRESH','DEPENDENT_RATINGS_RECOMPUTE']) writes.push(s('INSERT INTO cfb_postgame_outbox VALUES(?,?,?,?,NULL)',`${version}:${kind}`,kind,version,stable({game_id:payload.game_id,teams:payload.teams.map(t=>t.team_id)})));
    writes.push(s('UPDATE cfb_postgame_jobs SET state=?,last_error=NULL,updated_at=? WHERE game_id=?',prior ? 'CORRECTED':'VERIFIED',at,payload.game_id));
    await db.batch([...guards,...writes]);
    return {version,duplicate:false,production:false};
  } catch (error) {
    await state(error instanceof CfbPartialSourceError?'PARTIAL_SOURCE':error instanceof CfbValidationError?'QUARANTINED':'RETRY_PENDING',String(error.message)); throw error;
  }
}

/** Reconciliation checks card contents against the exact current game version. */
export async function cfbPostgamePilotHealth(db) {
 const states=await all(db.prepare('SELECT state,COUNT(*) AS n FROM cfb_postgame_jobs GROUP BY state').bind());
 const stale=await all(db.prepare(`SELECT c.game_id,c.version_id AS version,json_extract(t.value,'$.team_id') AS team_id
 FROM cfb_postgame_game_current c JOIN cfb_postgame_game_versions g ON g.id=c.version_id
 JOIN json_each(g.body_json,'$.teams') t
 LEFT JOIN cfb_postgame_card_current p ON p.team_id=json_extract(t.value,'$.team_id') AND p.season=g.season
 LEFT JOIN cfb_postgame_card_versions v ON v.id=p.version_id
 WHERE v.id IS NULL OR json_extract(v.body_json,'$.team_id') IS NOT p.team_id
 OR json_extract(v.body_json,'$.season') IS NOT p.season
 OR NOT EXISTS(SELECT 1 FROM json_each(v.body_json,'$.game_versions') x WHERE x.value=c.version_id)`).bind());
 return {states:Object.fromEntries(states.map(r=>[r.state,r.n])),staleCardVersions:stale.map(r=>({...r})),productionReady:false,canAuthorizeWager:false};
}
