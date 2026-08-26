const KEY = "fbis-proj-ledger-v1";

function load() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || "{}");
    return parsed?.games && typeof parsed.games === "object" ? parsed.games : {};
  } catch {
    return {};
  }
}

function save(games) {
  localStorage.setItem(KEY, JSON.stringify({ games, savedAt: new Date().toISOString() }));
}

function rowKey(date, id) {
  return `${date}:${id}`;
}

export function captureSlate(slate) {
  if (!slate?.games) return load();
  const games = load();
  for (const g of slate.games) {
    const k = rowKey(slate.date, g.id);
    if (games[k]) continue;
    if (g.status?.live || g.status?.completed) continue;
    const projHome = g.model?.projHome;
    const projAway = g.model?.projAway;
    if (projHome == null || projAway == null) continue;
    games[k] = {
      id: String(g.id),
      sport: slate.sport,
      date: slate.date,
      matchup: `${g.away?.abbr} @ ${g.home?.abbr}`,
      awayAbbr: g.away?.abbr,
      homeAbbr: g.home?.abbr,
      awayName: g.away?.name,
      homeName: g.home?.name,
      start: g.start,
      projAway,
      projHome,
      projTotal: projAway + projHome,
      projMargin: projHome - projAway,
      engine: g.model?.recipe?.engine || "unknown",
      steps: g.model?.recipe?.steps || [],
      impliedHome: g.model?.impliedHome ?? null,
      pHome: g.model?.layers?.form ?? g.model?.impliedHome ?? null,
      pinVig: g.pin?.ml?.vig ?? null,
      frozenAt: new Date().toISOString(),
      actualAway: null,
      actualHome: null,
    };
  }
  save(games);
  return games;
}

export function mergeTrack(report) {
  const games = load();
  for (const row of report?.games || []) {
    const k = rowKey(row.date, row.id);
    const existing = games[k];
    if (!existing) {
      games[k] = row;
      continue;
    }
    if (existing.actualHome == null && row.actualHome != null) {
      games[k] = { ...existing, ...row, projHome: existing.projHome, projAway: existing.projAway, steps: existing.steps, engine: existing.engine };
    }
  }
  save(games);
  return games;
}

export function localRows(sport) {
  return Object.values(load())
    .filter((r) => !sport || sport === "all" || r.sport === sport)
    .sort((a, b) => String(b.date).localeCompare(a.date));
}
