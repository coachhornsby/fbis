// Publication/input validation only. Never correct an old projection by relabeling it.
const key = v => String(v || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const parse = v => { try { return typeof v === "string" ? JSON.parse(v) : v; } catch { return null; } };
const instant = v => v ? Date.parse(v) : NaN;
export function validateTennisEvent(row, event, { projection = false } = {}) {
  const fail = reason => ({ valid: false, reason });
  if (!event?.match_id || !event.player1_id || !event.player2_id || !event.source) return fail("OFFICIAL_EVENT_MISSING");
  if (!/^(WTA|ATP)_OFFICIAL$/.test(event.source)) return fail("OFFICIAL_EVENT_SOURCE_UNVERIFIED");
  if (key(row.tour) !== key(event.tour)) return fail("TOUR_MISMATCH");
  const players = [event.p1, event.p2];
  const p1 = players.find(p => key(p?.display_name) === key(row.player1));
  const p2 = players.find(p => key(p?.display_name) === key(row.player2));
  if (!p1 || !p2 || p1.fbis_player_id === p2.fbis_player_id || ![p1,p2].every(p => key(p.tour) === key(row.tour))) return fail("PLAYER_IDENTITY_MISMATCH");
  if (!Number.isFinite(instant(row.event_start_time)) || instant(row.event_start_time) !== instant(event.match_time)) return fail("EVENT_START_MISMATCH");
  if (!event.tournament_name || !["hard", "clay", "grass", "carpet"].includes(key(event.surface))) return fail("EVENT_CONTEXT_MISSING");
  if (row.surface && key(row.surface) !== key(event.surface)) return fail("SURFACE_MISMATCH");
  if (row.tournament && key(row.tournament) !== key(event.tournament_name)) return fail("TOURNAMENT_MISMATCH");
  if (instant(event.match_time) <= Date.now() || !["SCHEDULED", "NOT_STARTED", "UPCOMING"].includes(String(event.completion_state).toUpperCase())) return fail("EVENT_NOT_UPCOMING");
  if (projection) {
    const proof = parse(row.context_json)?.eventProof;
    if (!proof || proof.matchId !== event.match_id || proof.source !== event.source || proof.player1Id !== p1.fbis_player_id || proof.player2Id !== p2.fbis_player_id || instant(proof.startTime) !== instant(event.match_time) || key(proof.surface) !== key(event.surface) || key(proof.tournament) !== key(event.tournament_name)) return fail("PROJECTION_EVENT_PROVENANCE_MISMATCH");
    if (!Number.isFinite(instant(row.decision_timestamp)) || instant(row.decision_timestamp) >= instant(event.match_time) || !Number.isFinite(instant(proof.observedAt)) || instant(proof.observedAt) > instant(row.decision_timestamp)) return fail("PROJECTION_CUTOFF_MISMATCH");
    if (row.pure_p1 == null || !Number.isFinite(Number(row.pure_p1)) || Number(row.pure_p1) <= 0 || Number(row.pure_p1) >= 1) return fail("PROJECTION_PROBABILITY_MISSING");
  }
  return { valid: true, p1, p2, event, proof: { matchId: event.match_id, source: event.source, observedAt: event.observed_at, player1Id: p1.fbis_player_id, player2Id: p2.fbis_player_id, startTime: event.match_time, tournament: event.tournament_name, surface: event.surface } };
}
export async function proveTennisEvent(db, row, options = {}) {
  try {
    // An Action fallback ID is not canonical. Only an explicit identity link can resolve it.
    const matches = (await db.prepare(`SELECT m.*, p1.fbis_player_id AS p1_id,p1.canonical_name AS p1_name,p1.tour AS p1_tour,p1.country_code AS p1_country,p1.current_rank AS p1_rank,p1.ranking_points AS p1_points,p1.official_headshot_url AS p1_headshot,p1.official_effective_at AS p1_rank_date,p1.official_source AS p1_rank_source,
      p2.fbis_player_id AS p2_id,p2.canonical_name AS p2_name,p2.tour AS p2_tour,p2.country_code AS p2_country,p2.current_rank AS p2_rank,p2.ranking_points AS p2_points,p2.official_headshot_url AS p2_headshot,p2.official_effective_at AS p2_rank_date,p2.official_source AS p2_rank_source
      FROM tennis_official_matches m
      JOIN tennis_players p1 ON p1.fbis_player_id=m.player1_id
      JOIN tennis_players p2 ON p2.fbis_player_id=m.player2_id
      WHERE m.match_id=? OR m.match_id IN (SELECT canonical_event_id FROM action_event_identity_links WHERE match_confidence='EXACT' AND (canonical_event_id=? OR (provider_event_id=? AND lower(sport)=?)))`).bind(row.canonical_event_id,row.canonical_event_id,String(row.canonical_event_id || "").replace(/^tennis:action:/,""),key(row.tour)).all())?.results || [];
    if (matches.length !== 1) return { valid: false, reason: matches.length ? "OFFICIAL_EVENT_AMBIGUOUS" : "OFFICIAL_EVENT_MISSING" };
    const e = matches[0];
    for (const side of ["p1", "p2"]) e[side] = { fbis_player_id:e[`${side}_id`],display_name:e[`${side}_name`],tour:e[`${side}_tour`],country:e[`${side}_country`],rank:e[`${side}_rank`],points:e[`${side}_points`],headshot:e[`${side}_headshot`],rankDate:e[`${side}_rank_date`],rankSource:e[`${side}_rank_source`] };
    return validateTennisEvent(row,e,options);
  } catch { return { valid: false, reason: "OFFICIAL_EVENT_EVIDENCE_UNAVAILABLE" }; }
}
