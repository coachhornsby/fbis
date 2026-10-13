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

/** Shift a YYYY-MM-DD calendar day by deltaDays (UTC noon anchor avoids DST edge quirks). */
export function shiftYmd(ymd, deltaDays) {
  const [y, m, d] = String(ymd || "").split("-").map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + Number(deltaDays || 0));
  return dt.toISOString().slice(0, 10);
}

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

/**
 * Count NHL games whose startTimeUTC falls on the requested America/Chicago date.
 * Fetches adjacent official schedule days so UTC/CT midnight crossings are covered.
 * A missing requested gameWeek row is NOT a verified empty slate — falls back to ESPN
 * or throws for SCHEDULE_UNVERIFIED.
 */
async function countNhlScheduled(date, fetchImpl) {
  const adjacent = [shiftYmd(date, -1), date, shiftYmd(date, 1)].filter(Boolean);
  const byId = new Map();
  let sawRequestedCalendarRow = false;
  let officialOk = false;
  let officialError = null;

  for (const day of adjacent) {
    try {
      const url = `https://api-web.nhle.com/v1/schedule/${encodeURIComponent(day)}`;
      const json = await fetchJson(url, fetchImpl, {
        label: "NHL official schedule",
        shapeCheck: (b) => Array.isArray(b?.gameWeek),
      });
      officialOk = true;
      for (const row of json.gameWeek || []) {
        const rowDate = String(row?.date || "").slice(0, 10);
        if (rowDate === date) sawRequestedCalendarRow = true;
        for (const g of row?.games || []) {
          const ct = CT_YMD(g?.startTimeUTC);
          if (ct !== date) continue;
          const id = String(g?.id || `${g?.startTimeUTC}-${g?.homeTeam?.id}-${g?.awayTeam?.id}`);
          byId.set(id, g);
        }
      }
    } catch (error) {
      officialError = String(error?.message || error);
    }
  }

  if (officialOk && byId.size > 0) {
    return {
      scheduledGames: byId.size,
      scheduleSource: "nhl-official-schedule",
    };
  }

  // Verified empty only when the official feed included the requested calendar row
  // (possibly with zero games) after CT-normalized adjacent scan found none.
  if (officialOk && sawRequestedCalendarRow && byId.size === 0) {
    return { scheduledGames: 0, scheduleSource: "nhl-official-schedule" };
  }

  // Missing requested date in gameWeek (or official wholly unavailable) → ESPN fallback.
  try {
    const stamp = String(date || "").replace(/-/g, "");
    const url =
      `https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard?dates=${stamp}&limit=300`;
    const json = await fetchJson(url, fetchImpl, {
      label: "ESPN NHL scoreboard",
      shapeCheck: (b) => Array.isArray(b?.events) || Array.isArray(b?.content?.sbData?.events),
    });
    const events = json?.events || json?.content?.sbData?.events || [];
    const ctEvents = events.filter((ev) => {
      const start =
        ev?.date ||
        ev?.competitions?.[0]?.date ||
        ev?.competitions?.[0]?.startDate ||
        null;
      return CT_YMD(start) === date;
    });
    return {
      scheduledGames: ctEvents.length,
      scheduleSource: "espn-nhl-scoreboard",
    };
  } catch (espnError) {
    throw new Error(
      officialOk && !sawRequestedCalendarRow
        ? `nhl-schedule-date-absent:${date}`
        : `nhl-schedule-unverified:${officialError || espnError?.message || espnError}`
    );
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
