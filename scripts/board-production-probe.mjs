/**
 * Read-only diagnostic used during board-delivery review.
 * No credentials, paid APIs or DB writes. Do not publish response bodies.
 */
const base = "https://fbis-myz.pages.dev";
// One-time post-deploy read-only acceptance probe; no production writes.
const day = process.env.BOARD_PROBE_DATE || "2026-10-10";
for (const sport of ["cfb", "nhl", "nba", "all"]) {
  const url = new URL("/api/today", base);
  url.searchParams.set("date", day);
  url.searchParams.set("sport", sport);
  url.searchParams.set("_probe", String(Date.now()));
  const started = Date.now();
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(sport === "all" ? 100000 : 35000),
    });
    const body = await response.text();
    const result = {};
    try {
      const j = JSON.parse(body);
      result.ok = j.ok;
      result.count = j.counts?.games ?? null;
      result.health = j.health?.state ?? null;
      result.emptyKind = j.empty?.kind ?? null;
      result.groups = (j.groups || []).map(g=>({sport:g.sport,n:g.games?.length||0}));
      result.failedSports = Object.entries(j.feeds||{}).filter(([,f])=>f?.error)
        .map(([sport,f])=>({sport,error:String(f.error).slice(0,180)}));
      result.error = String(j.error || "").slice(0,350);
    } catch {
      result.bodyType = response.headers.get("content-type");
      result.notJsonLength = body.length;
    }
    console.log(JSON.stringify({sport,http:response.status,elapsedMs:Date.now()-started,...result}));
  } catch (error) {
    console.log(JSON.stringify({sport,elapsedMs:Date.now()-started,requestError:String(error?.message||error)}));
  }
}
