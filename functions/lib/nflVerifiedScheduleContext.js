/** Pure adapter for the validated complete nflverse schedule. No I/O or new coefficients. */
const DAY = 86400000;
const canon = x => ({LA:'LAR',JAC:'JAX',WSH:'WAS'}[x] || x);
const day = value => {
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return null;
  const p = new Intl.DateTimeFormat('en-US', {timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(at);
  const get = type => Number(p.find(x => x.type === type).value);
  return Date.UTC(get('year'), get('month') - 1, get('day')) / DAY;
};
export function attachVerifiedNflScheduleContext(game, checked, now = Date.now()) {
  // checked must be returned by validateVerifiedNflInput, never a raw schedule.
  if (!(checked?.gameMap instanceof Map) || !(checked?.completed instanceof Set) ||
      !Number.isFinite(checked.expiresAt) || now >= checked.expiresAt || checked.scheduleAt > now) return game;
  const target = [...checked.gameMap.values()].find(g => String(g.espnId) === String(game.id));
  if (!target || Date.parse(target.start) <= now || Date.parse(target.start) !== Date.parse(game.start) ||
      canon(game.home?.abbr) !== target.home || canon(game.away?.abbr) !== target.away ||
      Boolean(game.neutralSite) !== Boolean(target.neutralSite)) return game;
  const nflFeatures = {...game.nflFeatures};
  const sides = {};
  for (const side of ['home','away']) {
    const team = target[side];
    const prior = [...checked.gameMap.values()].filter(g => (g.home === team || g.away === team) && g.week < target.week)
      .sort((a,b) => b.week - a.week)[0];
    const verified = prior && checked.completed.has(prior.id) && Date.parse(prior.start) < now;
    const restDays = verified ? day(target.start) - day(prior.start) : null;
    const validRest = Number.isFinite(restDays) && restDays > 0 && restDays <= 28;
    const f = {...nflFeatures[side]};
    // Remove unverified carry-over context, never turn unknown travel into zero miles.
    for (const key of ['restDays','travelMiles','timeZonesCrossed']) delete f[key];
    if (validRest) f.restDays = restDays;
    nflFeatures[side] = f;
    sides[side] = {
      team, previousGameId: verified ? prior.id : null,
      restDays: validRest ? restDays : null,
      restDefinition:'Eastern calendar days between scheduled kickoffs, not full days off',
      shortWeek: validRest ? restDays < 7 : null,
      comingOffBye: validRest ? target.week - prior.week > 1 : null,
      scheduledAway: side === 'away', neutralSite:Boolean(target.neutralSite),
      travelMiles:null, travelStatus:'UNKNOWN_ITINERARY',
      missing: [...(!validRest ? ['VERIFIED_PREVIOUS_GAME'] : []), 'VERIFIED_TRAVEL_ITINERARY'],
    };
  }
  return {...game,nflFeatures,nflScheduleContext:{
    version:'NFL-VERIFIED-SCHEDULE-CONTEXT-v1',source:'nflverse-schedule',
    observedAt:new Date(checked.scheduleAt).toISOString(),...sides,
    scoreInputFields:['restDays'],travelScoreImpact:false,injuryScoreImpact:false,
    calibrationVerified:false,canQualify:false,canAuthorizeWager:false,
  }};
}
