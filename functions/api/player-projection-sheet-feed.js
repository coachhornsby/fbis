import { buildSlate, resolveSlateDate } from "../lib/slateEngine.js";
import { productProjectionBoard } from "../lib/productProjection.js";

const SPORTS = new Set(["mlb","npb","kbo"]);

const HEADERS = [
  "Projection ID","Generated At","Game Date","Matchup","Pitcher","Team","Opponent","Hand",
  "Projected IP","Projected BF","Baseline K%","Adjusted K%","Baseline Ks","Count-State K Adj",
  "TTO/Fatigue K Adj","Repertoire Matchup Score","Velocity Delta","Workload Flag",
  "Catcher Framing Adj","Umpire Zone Adj","Final Projected Ks","K Line","P(Over)","P(Under)",
  "Fair Over Odds","Fair Under Odds","K Distribution ID","Pitcher Quality Model",
  "Feature Snapshot ID","Lock Status"
];

function csv(v) {
  if (v == null) return "";
  const s=String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s;
}

function ctDate(iso) {
  try {
    return new Intl.DateTimeFormat("en-CA",{timeZone:"America/Chicago",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(iso));
  } catch { return String(iso||"").slice(0,10); }
}

function opponent(card,row) {
  const team=String(row?.team||"").toUpperCase();
  const home=String(card?.home?.abbr||"").toUpperCase();
  return team===home ? (card?.away?.abbr||card?.away?.name||"") : (card?.home?.abbr||card?.home?.name||"");
}

function pitcherMeta(card,row) {
  const k=card?.subprojections?.pitcherKs||{};
  const candidates=[k.home,k.away].filter(Boolean);
  const pid=String(row?.playerId??"");
  const name=String(row?.playerName??"").toLowerCase();
  return candidates.find(x =>
    (pid && String(x?.playerId??"")===pid) ||
    (name && String(x?.playerName??"").toLowerCase()===name)
  ) || null;
}

export async function onRequestGet(context) {
  const url=new URL(context.request.url);
  const sport=String(url.searchParams.get("sport")||"mlb").toLowerCase();
  if(!SPORTS.has(sport)) return new Response("unsupported sport",{status:400});
  const rawDate=url.searchParams.get("date")||"";
  const resolved=resolveSlateDate(rawDate,{maxPast:2,maxFuture:3});
  if(rawDate&&!resolved.ok) return new Response("invalid date",{status:400});

  const env={
    PARLAY_API_KEY:context.env.PARLAY_API_KEY,
    THEODDS_API_KEY:context.env.THEODDS_API_KEY,
    SHARPAPI_API_KEY:context.env.SHARPAPI_API_KEY,
    THERUNDOWN_API_KEY:context.env.THERUNDOWN_API_KEY,
    BALLPARK_PAL_API_KEY:context.env.BALLPARK_PAL_API_KEY,
    DB:context.env.DB,caches:caches.default,parlayCacheOnly:true,palCacheOnly:false,
  };

  const slate=await buildSlate(sport,resolved.date,env);
  const board=productProjectionBoard(slate,{tier:"public"});
  const out=[HEADERS];

  for(const card of board.games||[]) {
    const rows=card?.playerProjections?.rows||[];
    for(const row of rows) {
      if(row?.market!=="strikeouts" || row?.fbisProjection==null) continue;
      const meta=pitcherMeta(card,row);
      const start=card.start||null;
      const id=[sport,card.id,row.playerId||row.playerName,"K",card.snapshot?.stage||"CURRENT"].join(":");
      out.push([
        id,
        board.generatedAt||new Date().toISOString(),
        ctDate(start),
        `${card?.away?.abbr||card?.away?.name||""} @ ${card?.home?.abbr||card?.home?.name||""}`,
        row.playerName||"",
        row.team||"",
        opponent(card,row),
        "",
        meta?.expectedInnings??"",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        meta?.expectedInnings!=null ? "MODEL_WORKLOAD" : "",
        "",
        "",
        row.fbisProjection,
        "",
        "",
        "",
        "",
        "",
        `${sport.toUpperCase()}-K-RESEARCH`,
        [
          row.source||card?.subprojections?.source||"",
          row?.externalComparison?.source && row?.externalComparison?.projection!=null
            ? `${row.externalComparison.source} K=${row.externalComparison.projection} Δ=${row.externalComparison.deltaFbisMinusExternal}`
            : ""
        ].filter(Boolean).join(" · "),
        [card.id,card.modelVersion,card.snapshot?.stage||"CURRENT"].join("|"),
        [card.snapshot?.stage||"CURRENT",card?.playerProjections?.status?.state||"UNKNOWN",row.maturity||"RESEARCH"].join(" · ")
      ]);
    }
  }

  return new Response(out.map(r=>r.map(csv).join(",")).join("\n"),{
    status:200,
    headers:{"content-type":"text/csv; charset=utf-8","cache-control":"public, max-age=300","access-control-allow-origin":"*"}
  });
}
