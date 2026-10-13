/**
 * Independent CT-date schedule verification for free-odds collectors.
 * Odds emptiness alone must never be labeled EMPTY_SLATE — games can exist
 * while free providers return no usable prices.
 */

const CT_YMD = (value) => {
  const t = Date.parse(value || "");
  return Number.isFinite(t)
    ? new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Chicago",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(t))
    : null;
};

async function fetchJson(url, fetchImpl, { label, shapeCheck } = {}) {
  const res = await fetchImpl(url, {
    headers: {
      Accept: "application/json,text/plain,*/*",
      "User-Agent": "Mozilla/5.0 (compatible; FBIS/1.0)",
    },
  });
  if (!res.ok) throw new Error(`${label || "schedule"} HTTP ${res.status}`);
  const body = await res.json();
  if (shapeCheck && !shapeCheck(body)) throw new Error(`${label || "schedule"} unexpected shape`);
  return body;
}

async function countMlbScheduled(date, fetchImpl) {
  const url =
    `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${encodeURIComponent(date)}` +
    `&hydrate=team`;
  const json = await fetchJson(url, fetchImpl, {
    label: "MLB Stats schedule",
    shapeCheck: (b) => Array.isArray(b?.dates),
  });
  const games = (json.dates || []).flatMap((d) => d.games || []);
  return { scheduledGames: games.length, scheduleSource: "mlb-statsapi" };
}

async function countNhlScheduled(date, fetchImpl) {
  try {
    const url = `https://api-web.nhle.com/v1/schedule/${encodeURIComponent(date)}`;
    const json = await fetchJson(url, fetchImpl, {
      label: "NHL official schedule",
      shapeCheck: (b) => Array.isArray(b?.gameWeek),
    });
    const target = (json.gameWeek || []).find((row) => String(row?.date || "").slice(0, 10) === date);
    return {
      scheduledGames: Array.isArray(target?.games) ? target.games.length : 0,
      scheduleSource: "nhl-official-schedule",
    };
  } catch {
    const stamp = String(date || "").replace(/-/g, "");
    const url =
      `https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard?dates=${stamp}&limit=300`;
    const json = await fetchJson(url, fetchImpl, {
      label: "ESPN NHL scoreboard",
      shapeCheck: (b) => Array.isArray(b?.events) || Array.isArray(b?.content?.sbData?.events),
    });
    const events = json?.events || json?.content?.sbData?.events || [];
    return { scheduledGames: events.length, scheduleSource: "espn-nhl-scoreboard" };
  }
}

/** @returns {{ok:true,scheduledGames:number,scheduleSource:string}|{ok:false,error:string,scheduledGames:null,scheduleSource:null}} */
export async function verifyCtScheduleGameCount(sport, date, { fetchImpl = fetch } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) {
    return { ok: false, error: "invalid-date", scheduledGames: null, scheduleSource: null };
  }
  const id = String(sport || "").toLowerCase();
  try {
    if (id === "mlb") return { ok: true, ...(await countMlbScheduled(date, fetchImpl)) };
    if (id === "nhl") return { ok: true, ...(await countNhlScheduled(date, fetchImpl)) };
    return { ok: false, error: "unsupported-sport", scheduledGames: null, scheduleSource: null };
  } catch (error) {
    return {
      ok: false,
      error: String(error?.message || error),
      scheduledGames: null,
      scheduleSource: null,
    };
  }
}

/**
 * Classify collector outcome after independent schedule verification + odds fetch.
 * EMPTY_SLATE only when schedule verification succeeded with zero games.
 */
export function classifyFreeOddsSlate({
  scheduleOk,
  scheduledGames,
  pairedMoneylines,
  persistedMoneylineRows,
} = {}) {
  if (!scheduleOk) {
    return {
      kind: "SCHEDULE_UNVERIFIED",
      httpStatus: 503,
      ok: false,
      skipped: false,
      skipReason: null,
      signalClass: "SCHEDULE_UNVERIFIED",
    };
  }
  const scheduled = Number(scheduledGames) || 0;
  const paired = Number(pairedMoneylines) || 0;
  const persisted = Number(persistedMoneylineRows) || 0;
  if (scheduled === 0) {
    return {
      kind: "EMPTY_SLATE",
      httpStatus: 200,
      ok: true,
      skipped: true,
      skipReason: "EMPTY_SLATE",
      signalClass: "EXPECTED_EMPTY_SLATE",
    };
  }
  if (paired <= 0 || persisted < paired * 2) {
    return {
      kind: "COVERAGE_GAP",
      httpStatus: 503,
      ok: false,
      skipped: false,
      skipReason: null,
      signalClass: "NON_EMPTY_SLATE_NO_PAIRED_QUOTES",
    };
  }
  return {
    kind: "OK",
    httpStatus: 200,
    ok: true,
    skipped: false,
    skipReason: null,
    signalClass: "QUOTES_PERSISTED",
  };
}

export function emptySlateReadbackValidated() {
  // No DB write occurred — do not claim verification.
  return null;
}

export { CT_YMD as chicagoDayFromIso };
