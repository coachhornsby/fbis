/**
 * ACTION collection orchestration policy.
 *
 * Goal: buy a few high-value observations around the event clock instead of
 * polling on fixed wall-clock schedules. This module never launches Apify;
 * it only decides which collection jobs are worth requesting.
 */

export const ACTION_ORCHESTRATOR_SPORTS = Object.freeze([
  "nfl",
  "mlb",
  "nba",
  "nhl",
  "cfb",
  "cbb",
]);

export const ACTION_PROP_SPORTS = Object.freeze(new Set(["nfl", "mlb", "nba", "nhl"]));

export const ACTION_ORCHESTRATOR_MAX_ITEMS = Object.freeze({
  BASE: 20,
  PLAYER_PROPS: 24,
  MOVEMENT: 20,
});

const MINUTE = 60 * 1000;

function ms(value) {
  const n = Date.parse(value || "");
  return Number.isFinite(n) ? n : null;
}

function minutesSince(value, nowMs) {
  const t = ms(value);
  if (t == null) return Infinity;
  return Math.max(0, (nowMs - t) / MINUTE);
}

function nextUpcomingEvent(events = [], nowMs = Date.now()) {
  return (events || [])
    .map((event) => ({ event, startMs: ms(event?.startTime || event?.start) }))
    .filter((x) => x.startMs != null && x.startMs > nowMs)
    .sort((a, b) => a.startMs - b.startMs)[0] || null;
}

function lastSuccess(history = [], { sport, profile, lifecycle }) {
  return (history || [])
    .filter((r) =>
      String(r?.sport || "").toLowerCase() === sport &&
      String(r?.profile || "BASE").toUpperCase() === profile &&
      String(r?.lifecycle || "pregame").toLowerCase() === lifecycle &&
      /^success/i.test(String(r?.status || ""))
    )
    .sort((a, b) => (ms(b?.finished_at || b?.started_at) || 0) - (ms(a?.finished_at || a?.started_at) || 0))[0] || null;
}

function due(history, key, cooldownMinutes, nowMs) {
  const prev = lastSuccess(history, key);
  return !prev || minutesSince(prev.finished_at || prev.started_at, nowMs) >= cooldownMinutes;
}

/**
 * Build an ordered list of paid ACTION jobs for the current event clock.
 *
 * Priority order deliberately protects mature player props and final-pregame
 * movement from lower-value early/base snapshots when spend is scarce.
 */
export function buildActionOrchestrationPlan({ slates = {}, history = [], now = new Date() } = {}) {
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const jobs = [];
  const sportState = {};

  for (const sport of ACTION_ORCHESTRATOR_SPORTS) {
    const events = Array.isArray(slates?.[sport]) ? slates[sport] : [];
    const next = nextUpcomingEvent(events, nowMs);
    if (!next) {
      sportState[sport] = { active: false, upcoming: 0, nextStart: null, minutesToStart: null };
      continue;
    }

    const upcoming = events.filter((e) => {
      const t = ms(e?.startTime || e?.start);
      return t != null && t > nowMs;
    });
    const minutesToStart = (next.startMs - nowMs) / MINUTE;
    sportState[sport] = {
      active: true,
      upcoming: upcoming.length,
      nextStart: new Date(next.startMs).toISOString(),
      minutesToStart: Math.round(minutesToStart),
    };

    // Player props: most valuable when markets have matured, roughly 45m–4h out.
    if (
      ACTION_PROP_SPORTS.has(sport) &&
      minutesToStart >= 45 &&
      minutesToStart <= 240 &&
      due(history, { sport, profile: "PLAYER_PROPS", lifecycle: "pregame" }, 180, nowMs)
    ) {
      jobs.push({
        sport,
        profile: "PLAYER_PROPS",
        lifecycle: "pregame",
        priority: 100,
        reason: "mature_player_props_window",
        maxItems: ACTION_ORCHESTRATOR_MAX_ITEMS.PLAYER_PROPS,
        nextStart: sportState[sport].nextStart,
        minutesToStart: sportState[sport].minutesToStart,
      });
    }

    // Final pregame: one movement snapshot near the first upcoming start.
    if (
      minutesToStart > 0 &&
      minutesToStart <= 60 &&
      due(history, { sport, profile: "MOVEMENT", lifecycle: "final_pregame" }, 90, nowMs)
    ) {
      jobs.push({
        sport,
        profile: "MOVEMENT",
        lifecycle: "final_pregame",
        priority: 90,
        reason: "final_pregame_window",
        maxItems: ACTION_ORCHESTRATOR_MAX_ITEMS.MOVEMENT,
        nextStart: sportState[sport].nextStart,
        minutesToStart: sportState[sport].minutesToStart,
      });
    }

    // Pregame consensus snapshot: useful but below props/final movement in priority.
    if (
      minutesToStart > 60 &&
      minutesToStart <= 360 &&
      due(history, { sport, profile: "BASE", lifecycle: "pregame" }, 240, nowMs)
    ) {
      jobs.push({
        sport,
        profile: "BASE",
        lifecycle: "pregame",
        priority: 60,
        reason: "pregame_consensus_window",
        maxItems: ACTION_ORCHESTRATOR_MAX_ITEMS.BASE,
        nextStart: sportState[sport].nextStart,
        minutesToStart: sportState[sport].minutesToStart,
      });
    }

    // Opening snapshot: only when the slate is still far away and no recent opening exists.
    if (
      minutesToStart > 360 &&
      minutesToStart <= 24 * 60 &&
      due(history, { sport, profile: "BASE", lifecycle: "opening" }, 12 * 60, nowMs)
    ) {
      jobs.push({
        sport,
        profile: "BASE",
        lifecycle: "opening",
        priority: 30,
        reason: "opening_snapshot_window",
        maxItems: ACTION_ORCHESTRATOR_MAX_ITEMS.BASE,
        nextStart: sportState[sport].nextStart,
        minutesToStart: sportState[sport].minutesToStart,
      });
    }
  }

  jobs.sort((a, b) => b.priority - a.priority || a.minutesToStart - b.minutesToStart);

  return {
    version: "ACTION_ORCHESTRATOR_V2",
    generatedAt: new Date(nowMs).toISOString(),
    jobs,
    sportState,
    policy: {
      propsSports: [...ACTION_PROP_SPORTS],
      priority: ["PLAYER_PROPS", "FINAL_PREGAME_MOVEMENT", "PREGAME_BASE", "OPENING_BASE"],
      boardReadsTriggerPaidCollection: false,
    },
  };
}
