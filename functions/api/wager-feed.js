import { buildSlate, resolveSlateDate, recommendBundle, SPORTS } from "../lib/slateEngine.js";
import { DEFAULT_WEIGHTS } from "../lib/weights.js";
import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
import { expectedRoi, validAmericanOdds } from "../lib/pricing.js";
import { getModel } from "../lib/canonical/modelRegistry.js";

const SUPPORTED = new Set(["mlb","npb","kbo","nfl","cfb","cbb","nba","wnba","nhl","soccer"]);

export function resolveWagerAuthority(...candidates) {
  for (const candidate of candidates) {
    const raw = String(candidate || "").trim();
    if (!raw) continue;
    const modelId = raw.split("@")[0];
    const registration = getModel(modelId);
    if (registration) {
      return {
        authorized: registration.canAuthorizeWager === true,
        modelId: registration.modelId,
        source: "MODEL_REGISTRY",
      };
    }
  }
  return { authorized: false, modelId: null, source: "UNKNOWN_MODEL_FAIL_CLOSED" };
}

function finite(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function minAcceptableAmerican(p, minEv = 0.03) {
  const prob = finite(p);
  const floor = finite(minEv);
  if (prob == null || floor == null || prob <= 0 || prob >= 1) return null;
  const profitMultiple = (1 - prob + floor) / prob;
  if (!(profitMultiple > 0)) return null;
  return profitMultiple >= 1
    ? Math.ceil(profitMultiple * 100)
    : -Math.floor(100 / profitMultiple);
}

function checkpoint(start) {
  const ms = Date.parse(start || "");
  if (!Number.isFinite(ms)) return "CURRENT";
  const hours = (ms - Date.now()) / 3600000;
  if (hours <= 0) return "LIVE_OR_FINAL";
  if (hours <= 1.5) return "CLOSE";
  if (hours <= 4) return "PREGAME";
  if (hours <= 10) return "MIDDAY";
  return "MORNING";
}


async function loadWnbaDecisionFeed(db,date){
  if(!db?.prepare)return [];
  try{
    const res=await db.prepare(
      `WITH ranked AS (
         SELECT *,ROW_NUMBER() OVER (
           PARTITION BY event_id,market,side
           ORDER BY captured_at DESC
         ) rn
         FROM wnba_wager_decisions
         WHERE date(event_start,'-5 hours')=?
       )
       SELECT * FROM ranked WHERE rn=1
       ORDER BY event_start,event_id,market,side`
    ).bind(date).all();
    return res?.results||[];
  }catch{return [];}
}

function wnbaFeedRow(r){
  const edge=finite(r.probability_edge);
  const conf=finite(r.confidence);
  const authority=resolveWagerAuthority(r.model_id,r.model_version);
  const researchBet=r.decision==="BET";
  const authorizedBet=researchBet&&authority.authorized;
  return {
    generatedAt:r.captured_at,
    gameDate:r.event_start?String(r.event_start).slice(0,10):null,
    eventStart:r.event_start,
    sport:"WNBA",
    matchup:r.event_id,
    decision:authorizedBet?"BET":researchBet?"RESEARCH_CANDIDATE":r.decision,
    grade:conf==null?"UNRATED":`CONFIDENCE_${Math.round(conf)}`,
    market:r.market,
    pick:`${r.side}${r.line==null?"":` ${r.line>0?"+":""}${r.line}`}`,
    side:r.side,
    line:finite(r.line),
    qualificationBook:r.sportsbook,
    qualificationPrice:finite(r.american_price),
    executionBook:r.sportsbook,
    executionPrice:finite(r.american_price),
    modelProbability:finite(r.model_probability),
    marketNoVigProbability:finite(r.break_even_probability),
    probabilityEdgePp:edge==null?null:edge*100,
    expectedRoi:finite(r.expected_value),
    executionRoi:finite(r.expected_value),
    minimumAcceptableOdds:null,
    suggestedUnits:authorizedBet?(finite(r.stake_units)??0):0,
    confidence:conf,
    confidenceCalibrationState:r.confidence_calibration_state,
    confidenceCalibrationN:Number(r.confidence_calibration_n)||0,
    checkpoint:checkpoint(r.event_start),
    status:authorizedBet?"READY":researchBet?"RESEARCH CANDIDATE — WAGER AUTHORITY DISABLED":"PASS",
    reason:authorizedBet
      ?"WNBA game-level decision engine: positive EV and wager authority enabled"
      :researchBet
        ?"Positive-EV research decision; canonical model registry does not authorize wagering"
        :"WNBA game-level decision engine: offer did not clear EV/evidence gates",
    wagerAuthority:authority.authorized,
    wagerAuthoritySource:authority.source,
    authorityModelId:authority.modelId,
    researchDecision:r.decision,
    decisionArchitecture:"WNBA-WAGER-v2",
  };
}

function matchup(game = {}) {
  const away = game?.away?.abbr || game?.away?.name || "AWAY";
  const home = game?.home?.abbr || game?.home?.name || "HOME";
  return `${away} @ ${home}`;
}

function gameDate(start) {
  if (!start) return null;
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Chicago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(start));
  } catch {
    return String(start).slice(0,10);
  }
}

export async function onRequestGet(context) {
  const auth = authorizeHarvest(context.request, context.env);
  if (!auth.ok) {
    return json(unauthorizedBody(auth.reason), 401);
  }

  const url = new URL(context.request.url);
  const sport = String(url.searchParams.get("sport") || "").toLowerCase();
  if (!SUPPORTED.has(sport)) return json({ ok:false, error:"unsupported-sport", rows:[] }, 400);

  const rawDate = url.searchParams.get("date") || "";
  const window = sport === "cfb" || sport === "cbb"
    ? { maxPast: 7, maxFuture: 14 }
    : { maxPast: 2, maxFuture: 3 };
  const resolved = resolveSlateDate(rawDate, window);
  if (rawDate && !resolved.ok) return json({ ok:false, error:resolved.error, rows:[] }, 400);

  const env = {
    PARLAY_API_KEY: context.env.PARLAY_API_KEY,
    THEODDS_API_KEY: context.env.THEODDS_API_KEY,
    SHARPAPI_API_KEY: context.env.SHARPAPI_API_KEY,
    THERUNDOWN_API_KEY: context.env.THERUNDOWN_API_KEY,
    BALLPARK_PAL_API_KEY: context.env.BALLPARK_PAL_API_KEY,
    CFBD_API_KEY: context.env.CFBD_API_KEY,
    CBBD_API_KEY: context.env.CBBD_API_KEY,
    DB: context.env.DB,
    caches: caches.default,
    parlayCacheOnly: true,
    palCacheOnly: true,
    cfbdScheduleFallback: false,
  };

  try {
    if (sport === "wnba") {
      const persisted = await loadWnbaDecisionFeed(context.env.DB, resolved.date);
      if (persisted.length) {
        const rows = persisted.map(wnbaFeedRow);
        return json({
          ok:true,
          sport,
          date:resolved.date,
          generatedAt:rows[0]?.generatedAt || new Date().toISOString(),
          minEv:finite(SPORTS.wnba?.minEv) ?? 0.03,
          rows,
          actionable:rows.filter(r=>r.decision==="BET").length,
          shop:0,
          architecture:"WNBA-WAGER-v2",
          source:"immutable_wnba_wager_decisions",
        });
      }
    }

    const slate = await buildSlate(sport, resolved.date, env);
    const generatedAt = new Date().toISOString();
    const cfg = SPORTS[sport] || {};
    const minEv = finite(cfg.minEv) ?? 0.03;
    const rows = [];

    for (const game of slate.games || []) {
      if (game?.status?.live || game?.status?.completed) continue;
      const bundle = recommendBundle(sport, game, game.model, DEFAULT_WEIGHTS);
      const rec = bundle?.qualified || null;
      if (!rec) continue;

      const modelProbability = finite(rec.modelProbability ?? rec.fair);
      const qualificationPrice = finite(rec.qualificationPrice ?? rec.pinPrice);
      const executionPrice = finite(rec.executionPrice);
      const qualificationEv = finite(rec.expectedRoi ?? rec.ev);
      const executionEv = modelProbability != null && validAmericanOdds(executionPrice)
        ? expectedRoi(modelProbability, executionPrice)
        : null;
      const priceReady = executionEv != null && executionEv >= minEv;
      const authority = resolveWagerAuthority(
        rec.modelId,
        game?.model?.modelId,
        game?.modelId,
        rec.modelVersion,
        game?.modelVersion,
        game?.championModel
      );
      const ready = priceReady && authority.authorized;
      const minOdds = minAcceptableAmerican(modelProbability, minEv);

      rows.push({
        generatedAt,
        gameDate: gameDate(game.start),
        eventStart: game.start || null,
        sport: sport.toUpperCase(),
        matchup: matchup(game),
        decision: ready ? "BET" : priceReady ? "QUALIFIED" : "SHOP",
        grade: String(rec.tag || "QUALIFIED").toUpperCase(),
        market: rec.market || null,
        pick: rec.pick || null,
        side: rec.side || null,
        line: finite(rec.executionLine ?? rec.line),
        qualificationBook: rec.qualificationBook || rec.benchmarkBook || rec.book || "Pinnacle",
        qualificationPrice,
        executionBook: rec.executionBook || null,
        executionPrice,
        modelProbability,
        marketNoVigProbability: finite(rec.marketNoVigProbability ?? rec.implied),
        probabilityEdgePp: finite(rec.probEdge),
        expectedRoi: qualificationEv,
        executionRoi: executionEv,
        minimumAcceptableOdds: minOdds,
        suggestedUnits: ready ? 1 : 0,
        wagerAuthority: authority.authorized,
        wagerAuthoritySource: authority.source,
        authorityModelId: authority.modelId,
        modelVersion: rec.modelVersion || game.modelVersion || game.championModel || null,
        checkpoint: checkpoint(game.start),
        status: ready
          ? "READY"
          : priceReady
            ? "QUALIFIED — WAGER AUTHORITY DISABLED"
            : "SHOP — EXECUTION PRICE REQUIRED",
        reason: ready
          ? "Qualified FBIS edge, executable price, and explicit wager authority"
          : priceReady
            ? "Qualified edge and executable price clear EV floor, but wager authority is disabled"
            : executionPrice == null
              ? "Qualified vs reference market; no executable price persisted"
              : `Execution price does not clear ${(minEv*100).toFixed(1)}% EV floor`,
      });
    }

    return json({
      ok:true,
      sport,
      date:resolved.date,
      generatedAt,
      minEv,
      rows,
      actionable:rows.filter((r)=>r.status==="READY").length,
      shop:rows.filter((r)=>r.decision==="SHOP").length,
    });
  } catch (err) {
    return json({ ok:false, sport, date:resolved.date, error:String(err?.message || err), rows:[] }, 502);
  }
}

function json(data, status=200) {
  return new Response(JSON.stringify(data), {
    status,
    headers:{
      "content-type":"application/json; charset=utf-8",
      "cache-control":"private, no-store, max-age=0",
    },
  });
}
