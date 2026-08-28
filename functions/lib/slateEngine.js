/** Shared slate builder — used by Pages Functions and local Vite middleware. */

import { BASEBALL, EXECUTION_BOOK, runLine } from "./books.js";
import { fetchBallparkPal, mergeBallparkPal, palSlateView } from "./ballparkpal.js";
import { fetchParlayOdds, mergeParlay } from "./parlay.js";
import { fetchSavantSlate } from "./savant.js";
import { MODEL_VERSION, pinMarkets, priceSelection, tagFromEv } from "./pricing.js";
import { DEFAULT_WEIGHTS } from "./weights.js";
import { applyCfbModel, cfbSpreadProb, cfbTotalProb, cfbWinProb, CFB_BLOCKED_MESSAGE } from "./cfbModel.js";
import { loadCbbdRatings } from "./cfbd.js";
import { enrichGameTeams } from "./teams.js";
import { attachMarketLabels, TEAM_MATCH_UNRESOLVED } from "./marketLabels.js";
import { attachCfbChallengers, attachCbbChallengers } from "./collegeApply.js";
import { SHADOW_BLOCK_REASONS } from "./collegeModels.js";

export const SPORTS = {
  cbb: {
    id: "cbb",
    label: "CBB",
    name: "College Basketball",
    espn: "basketball/mens-college-basketball",
    k: 4.6,
    totalK: 8.5,
    minSpreadEdge: 3.0,
    minMlEdge: 0.03,
    minEv: 0.03,
    maxProb: 0.72,
  },
  mlb: {
    id: "mlb",
    label: "MLB",
    name: "MLB",
    espn: "baseball/mlb",
    k: 2.0,
    totalK: 3.6,
    minSpreadEdge: 0.35,
    minMlEdge: 0.025,
    minEv: 0.03,
    maxProb: 0.75,
  },
  nba: {
    id: "nba",
    label: "NBA",
    name: "NBA",
    espn: "basketball/nba",
    k: 11,
    totalK: 14,
    minSpreadEdge: 3.0,
    minMlEdge: 0.03,
    minEv: 0.03,
    maxProb: 0.72,
  },
  nfl: {
    id: "nfl",
    label: "NFL",
    name: "NFL",
    espn: "football/nfl",
    k: 7.0,
    totalK: 9.5,
    minSpreadEdge: 2.5,
    minMlEdge: 0.03,
    minEv: 0.03,
    maxProb: 0.72,
  },
  cfb: {
    id: "cfb",
    label: "CFB",
    name: "College Football",
    espn: "football/college-football",
    k: 8.0,
    totalK: 11,
    minSpreadEdge: 3.0,
    minMlEdge: 0.03,
    minEv: 0.03,
    maxProb: 0.72,
  },
};

export const BOARD_SPORTS = ["mlb", "nba", "nfl", "cfb", "cbb"];

export function todayCT() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function dateStamp(isoDate) {
  return (isoDate || todayCT()).replaceAll("-", "");
}

export function shiftDateCT(isoDate, deltaDays) {
  const [y, m, d] = String(isoDate || todayCT()).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return dt.toISOString().slice(0, 10);
}

export function lastNDatesCT(n, from = todayCT()) {
  return Array.from({ length: n }, (_, i) => shiftDateCT(from, -i));
}

/** Parlay-backed slate dates stay near today so cache-key variation cannot drain credits. */
export function resolveSlateDate(raw, { maxPast = 2, maxFuture = 1 } = {}) {
  const today = todayCT();
  const value = String(raw || "").trim();
  if (!value) return { date: today, ok: true };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { date: today, ok: false, error: "date must be YYYY-MM-DD" };
  }
  const min = shiftDateCT(today, -maxPast);
  const max = shiftDateCT(today, maxFuture);
  if (value < min || value > max) {
    return { date: today, ok: false, error: `date must be between ${min} and ${max}` };
  }
  return { date: value, ok: true };
}

export function recordWinPct(rec) {
  const m = String(rec || "").match(/(\d+)\s*-\s*(\d+)/);
  if (!m) return null;
  const w = Number(m[1]);
  const l = Number(m[2]);
  if (w + l <= 0) return null;
  return w / (w + l);
}

export function americanToImplied(american) {
  const n = Number(american);
  if (!Number.isFinite(n) || n === 0) return null;
  if (n > 0) return 100 / (n + 100);
  return Math.abs(n) / (Math.abs(n) + 100);
}

export function stripVig(pHome, pAway) {
  if (pHome == null || pAway == null) return { home: pHome, away: pAway };
  const s = pHome + pAway;
  if (s <= 0) return { home: pHome, away: pAway };
  return { home: pHome / s, away: pAway / s };
}

export function logistic(x, k) {
  return 1 / (1 + Math.exp(-x / k));
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function competitor(comp, side) {
  return (comp.competitors || []).find((c) => c.homeAway === side) || null;
}

function parseOdds(comp, sport) {
  const raw = Array.isArray(comp.odds) ? comp.odds[0] : null;
  if (!raw) {
    return {
      spread: null,
      total: null,
      homeMl: null,
      awayMl: null,
      details: "",
      book: EXECUTION_BOOK,
    };
  }
  const homeOdds = raw.homeTeamOdds || {};
  const awayOdds = raw.awayTeamOdds || {};
  const spread = runLine(sport, num(raw.spread));
  return {
    spread,
    total: num(raw.overUnder),
    homeMl: num(homeOdds.moneyLine ?? raw.homeTeamOdds?.moneyLine),
    awayMl: num(awayOdds.moneyLine ?? raw.awayTeamOdds?.moneyLine),
    details: raw.details || "",
    book: EXECUTION_BOOK,
  };
}

function statusInfo(comp) {
  const t = comp.status?.type || {};
  const state = t.state || "pre";
  return {
    state,
    detail: t.shortDetail || t.detail || t.description || "",
    completed: state === "post" || t.completed === true,
    live: state === "in",
  };
}

function teamPayload(c) {
  if (!c) return { name: "TBD", abbr: "—", logo: "", score: null, rank: null, record: "" };
  const rec = (c.records || []).find((r) => r.type === "total")?.summary || "";
  return {
    name: c.team?.displayName || c.team?.name || "TBD",
    abbr: c.team?.abbreviation || "—",
    logo: c.team?.logo || "",
    score: num(c.score),
    rank: num(c.curatedRank?.current) && c.curatedRank.current < 99 ? c.curatedRank.current : null,
    record: rec,
  };
}

export function projectGame(sport, game) {
  const cfg = SPORTS[sport];
  const homeSpread = game.odds.spread; // ESPN: home team spread
  const marketHome =
    homeSpread != null ? logistic(-homeSpread, cfg.k) : americanToImplied(game.odds.homeMl);
  const marketAway =
    homeSpread != null ? 1 - marketHome : americanToImplied(game.odds.awayMl);
  let vigFree = stripVig(marketHome, marketAway);
  if (game.fairHomeMl != null) {
    const fairHome = americanToImplied(game.fairHomeMl);
    const fairAway = americanToImplied(game.fairAwayMl) ?? (fairHome != null ? 1 - fairHome : null);
    vigFree = stripVig(fairHome, fairAway);
  }

  const espnHome = game.espnHomeWinPct;
  const espnAway = espnHome != null ? 1 - espnHome : null;

  const projHome = sport === "nfl" ? null : game.projHomeScore;
  const projAway = sport === "nfl" ? null : game.projAwayScore;
  const projMargin = projHome != null && projAway != null ? projHome - projAway : null;
  const palMargin =
    game.bpp?.homeRuns != null && game.bpp?.awayRuns != null ? game.bpp.homeRuns - game.bpp.awayRuns : null;
  const palHome =
    game.bpp?.pHome != null
      ? game.bpp.pHome
      : palMargin != null
        ? logistic(palMargin, cfg.k)
        : null;
  const scoreHome =
    sport === "cfb" && game.cfb?.sigmaMargin != null && projMargin != null
      ? cfbWinProb(projMargin, game.cfb.sigmaMargin)
      : projMargin != null
        ? logistic(projMargin, cfg.k)
        : null;
  const homePct = recordWinPct(game.home?.record);
  const awayPct = recordWinPct(game.away?.record);
  const recordForm =
    homePct != null && awayPct != null && homePct + awayPct > 0 ? homePct / (homePct + awayPct) : null;
  const formHome = recordForm != null ? recordForm : game.modelHint?.formHome ?? null;

  const layers = {
    market: vigFree.home,
    espn: espnHome,
    score: scoreHome,
    pal: palHome,
    form: formHome,
  };
  const model = {
    layers,
    marketAway: vigFree.away,
    espnAway,
    scoreAway: scoreHome != null ? 1 - scoreHome : null,
    palAwayProb: palHome != null ? 1 - palHome : null,
    formAway: formHome != null ? 1 - formHome : null,
    impliedHome: vigFree.home,
    impliedAway: vigFree.away,
    pHomeFinal: blendWinProb(layers),
    projHome,
    projAway,
    projTotal: projHome != null && projAway != null ? projHome + projAway : null,
    projMargin,
    palHome: game.bpp?.homeRuns ?? null,
    palAway: game.bpp?.awayRuns ?? null,
    marketProjHome: game.marketProjHome ?? null,
    marketProjAway: game.marketProjAway ?? null,
    pOver:
      sport === "cfb" && game.cfb?.sigmaTotal != null && game.odds?.total != null && projHome != null && projAway != null
        ? cfbTotalProb(projHome + projAway, game.odds.total, game.cfb.sigmaTotal, true)
        : null,
    pSpreadHome:
      sport === "cfb" && game.cfb?.sigmaMargin != null && game.odds?.spread != null && projMargin != null
        ? cfbSpreadProb(projMargin, game.odds.spread, game.cfb.sigmaMargin)
        : null,
    heuristicTotalProb: true,
    projectionKind: game.projectionKind || (sport === "nfl" ? "PINNACLE_IMPLIED" : sport === "cfb" ? "FBIS" : null),
    projectionState: game.cfb?.projectionState || game.projectionState || null,
  };
  model.recipe = projectionRecipe(sport, game, model);
  return model;
}

export function projectionRecipe(sport, game, model) {
  const steps = [];
  let engine = "none";
  const projHome = model?.projHome ?? game.projHomeScore;
  const projAway = model?.projAway ?? game.projAwayScore;
  const fmt = (n) => (n == null || Number.isNaN(Number(n)) ? "—" : Number(n).toFixed(1));
  const fmt2 = (n) => (n == null || Number.isNaN(Number(n)) ? "—" : Number(n).toFixed(2));

  if (sport === "mlb") {
    const sv = game.savant || {};
    const hasPal = game.bpp?.homeRuns != null && game.bpp?.awayRuns != null;
    engine = hasPal ? "Savant + Ballpark Pal" : sv.source === "Savant" ? "Baseball Savant" : sv.source ? "MLB Stats" : "MLB form";
    const homePitcher = game.homeSp?.last || game.homeSp?.name || "TBD SP";
    const awayPitcher = game.awaySp?.last || game.awaySp?.name || "TBD SP";
    steps.push(
      `FBIS proprietary (Savant): ${game.away?.abbr || "Away"} ${fmt2(sv.awayRpg)} RPG vs ${homePitcher} → ${fmt(projAway)}; ${game.home?.abbr || "Home"} ${fmt2(sv.homeRpg)} RPG vs ${awayPitcher} × 1.04 → ${fmt(projHome)}.`
    );
    if (hasPal) {
      steps.push(
        `Ballpark Pal independent: ${game.away.abbr} ${fmt(game.bpp.awayRuns)} @ ${game.home.abbr} ${fmt(game.bpp.homeRuns)}.`
      );
      if (game.bpp.f5?.total != null) {
        steps.push(`Pal F5 ${fmt(game.bpp.f5.awayRuns)}–${fmt(game.bpp.f5.homeRuns)} (tot ${fmt(game.bpp.f5.total)}).`);
      }
    }
    steps.push("Pal is an independent model, never a sportsbook price. Savant is not overwritten by Pal.");
  } else if (sport === "cfb" && game.cfb) {
    const c = game.cfb;
    engine = "CFB prior + season evidence";
    steps.push(
      `Preseason prior ${c.priorVersion || "cfb-prior-v1"} (${c.projectionState || "n/a"}). Home rank ${c.homeEst?.rank ?? "unranked"} prior ${c.homeEst?.teamSpecificPrior ? "team-specific" : "missing"}; away ${c.awayEst?.rank ?? "unranked"} prior ${c.awayEst?.teamSpecificPrior ? "team-specific" : "missing"}.`
    );
    if (!c.bettingAllowed) {
      steps.push(c.blockReason || CFB_BLOCKED_MESSAGE);
    }
    steps.push(
      `Current-season weight n/(n+${c.constants?.priorGames ?? 6}): home ${c.homeEst?.n || 0} games w=${Number(c.homeEst?.w || 0).toFixed(2)}, away ${c.awayEst?.n || 0} games w=${Number(c.awayEst?.w || 0).toFixed(2)}.`
    );
    steps.push(
      `HFA ${c.hfa} pts${game.neutralSite ? " (neutral)" : ""}. Scores ${fmt(projAway)}–${fmt(projHome)} (tot ${fmt(c.total)}, mgn ${fmt(c.margin)}).`
    );
    steps.push(
      `Win/spread/total probabilities use Normal(σ_margin=${c.sigmaMargin}, σ_total=${c.sigmaTotal}) — labeled heuristic, not a fitted probability model.`
    );
    const homeFeatures = c.features?.summary?.homeUsed || c.homeEst?.featureVector?.used || [];
    const awayFeatures = c.features?.summary?.awayUsed || c.awayEst?.featureVector?.used || [];
    const homeQb = c.homeEst?.featureVector?.qb;
    const awayQb = c.awayEst?.featureVector?.qb;
    steps.push(
      `Feature stack (CFBD+ESPN): home [${homeFeatures.join(", ") || "none"}] · away [${awayFeatures.join(", ") || "none"}].`
    );
    if (homeQb?.starterKnown || awayQb?.starterKnown) {
      steps.push(
        `QB continuity: ${game.home?.abbr || "HOME"} ${homeQb?.starterName || "unknown"}${homeQb?.starterTransfer ? " (transfer)" : ""}; ${game.away?.abbr || "AWAY"} ${awayQb?.starterName || "unknown"}${awayQb?.starterTransfer ? " (transfer)" : ""}.`
      );
    }
    if (c.flags?.includes("feature_sparse")) {
      steps.push("Some EPA/transfer/QB/coaching inputs were unavailable at runtime; absent features are omitted, not zero-filled.");
    }
  } else if (sport === "nfl") {
    engine = "Pinnacle implied score";
    const mh = game.marketProjHome;
    const ma = game.marketProjAway;
    if (mh != null && ma != null) {
      steps.push(`PINNACLE IMPLIED SCORE ${fmt(ma)}–${fmt(mh)} from total/spread split.`);
      steps.push("This is not an independent FBIS projection. Circular market-derived scores cannot qualify.");
    } else {
      steps.push("FBIS projection unavailable. No independent NFL model is wired.");
    }
  } else if (projHome != null && projAway != null && game.odds?.total != null && game.odds?.spread != null) {
    const pin = game.odds.pinPresent !== false;
    engine = pin ? "Pinnacle line-implied" : "Board line-implied";
    const tot = game.odds.total;
    const sp = game.odds.spread;
    steps.push(`${pin ? "Pinnacle" : "Board"} total ${tot}, home spread ${sp > 0 ? "+" : ""}${sp}.`);
    steps.push(`Away ${fmt(projAway)} = ${tot}/2 + (${sp})/2.`);
    steps.push(`Home ${fmt(projHome)} = ${tot}/2 − (${sp})/2.`);
    steps.push("This is the market's implied score, not an independent team sim.");
  } else if (projHome != null && projAway != null) {
    engine = "Form estimate";
    steps.push(`Projected ${fmt(projAway)}–${fmt(projHome)} from team form / baseline.`);
  } else {
    engine = "Win-prob only";
    steps.push("No score projection yet. Recs use the win-probability blend until a total and spread post.");
  }

  const layers = model?.layers || {};
  const parts = ["market", "espn", "score", "pal", "form"].filter((k) => layers[k] != null);
  if (parts.length) {
    steps.push(
      `Win-prob layers (${parts.join(" / ")}): market ${fmt2(layers.market)} · ESPN ${fmt2(layers.espn)} · score ${fmt2(layers.score)} · Pal ${fmt2(layers.pal)} · form ${fmt2(layers.form)}.`
    );
  }
  return { engine, steps };
}

export function blendWinProb(layers, weights = DEFAULT_WEIGHTS) {
  const w = { ...DEFAULT_WEIGHTS, ...(weights || {}) };
  const parts = [];
  if (layers.market != null) parts.push([layers.market, w.market]);
  if (layers.espn != null) parts.push([layers.espn, w.espn]);
  if (layers.score != null) parts.push([layers.score, w.score]);
  if (layers.pal != null) parts.push([layers.pal, w.pal]);
  if (layers.form != null) parts.push([layers.form, w.form]);
  if (!parts.length) return null;
  const wsum = parts.reduce((s, [, wt]) => s + wt, 0);
  if (wsum <= 0) return parts[0][0];
  return parts.reduce((s, [p, wt]) => s + p * (wt / wsum), 0);
}

function shrinkToMarket(pModel, pMarket, wMarket = 0.65) {
  if (pModel == null) return pMarket;
  if (pMarket == null || !Number.isFinite(pMarket)) return pModel;
  return pModel * (1 - wMarket) + pMarket * wMarket;
}

/** EV must exist and clear the sport floor. Missing price is not a pass. */
export function isQualifiedTicket(cfg, priced) {
  if (!priced?.marketComplete) return false;
  if (priced.pinPrice == null || priced.ev == null) return false;
  if (priced.fair != null && cfg.maxProb != null && (priced.fair > cfg.maxProb || priced.fair < 1 - cfg.maxProb)) {
    return false;
  }
  return priced.ev >= cfg.minEv;
}

function withinProbCap(cfg, priced) {
  if (priced?.fair == null || cfg.maxProb == null) return true;
  return priced.fair <= cfg.maxProb && priced.fair >= 1 - cfg.maxProb;
}

function stampTicket(game, rec, priced, { qualified, lean }) {
  const heritageListed = Boolean(game.odds?.heritageListed);
  return {
    ...rec,
    ...priced,
    qualified,
    lean,
    tag: qualified ? tagFromEv(priced.ev, priced.probEdge) : "LEAN",
    book: EXECUTION_BOOK,
    executionBook: EXECUTION_BOOK,
    executionPrice: rec.executionPrice ?? null,
    benchmarkBook: "Pinnacle",
    priceSource: heritageListed && rec.executionPrice != null ? "Heritage" : "Pinnacle (shop Heritage)",
    modelVersion: MODEL_VERSION,
  };
}

function sortTickets(recs) {
  return recs.sort((a, b) => (b.ev ?? -99) - (a.ev ?? -99) || (b.edge ?? 0) - (a.edge ?? 0));
}

export function recommendBundle(sport, game, model, weights) {
  const cfg = SPORTS[sport];
  if (sport === "cfb" && game.cfb && !game.cfb.bettingAllowed) {
    return {
      qualified: null,
      lean: null,
      blocked: true,
      blockReason: game.cfb.blockReason || CFB_BLOCKED_MESSAGE,
    };
  }
  if (game.selectedChallenger && game.selectedChallenger.role === "shadow") {
    return {
      qualified: null,
      lean: null,
      blocked: true,
      blockReason: SHADOW_BLOCK_REASONS.shadow,
    };
  }
  if (sport === "nfl" && game.projectionKind !== "FBIS") {
    return {
      qualified: null,
      lean: null,
      blocked: true,
      blockReason: "FBIS projection unavailable — no independent NFL model",
    };
  }
  if (game.marketUnresolved) {
    return {
      qualified: null,
      lean: null,
      blocked: true,
      blockReason: TEAM_MATCH_UNRESOLVED,
    };
  }
  if (!model?.layers) return { qualified: null, lean: null };
  const homeP = blendWinProb(model.layers, weights);
  if (homeP == null) return { qualified: null, lean: null };
  const awayP = 1 - homeP;
  const recs = [];
  const pin = game.pin || pinMarkets(game);

  pushMl(recs, cfg, game, "HOME", game.home.name, priceSelection({ pWin: homeP, twoWay: pin.ml, side: "A" }));
  pushMl(recs, cfg, game, "AWAY", game.away.name, priceSelection({ pWin: awayP, twoWay: pin.ml, side: "B" }));

  if (homeSpreadValid(game) && model.projMargin != null) {
    const homeSpread = game.odds.spread;
    const coverHome = model.projMargin + homeSpread;
    const spreadEdge = Math.abs(coverHome);
    if (spreadEdge >= cfg.minSpreadEdge) {
      const side = coverHome > 0 ? "HOME" : "AWAY";
      let pCoverRaw = logistic(side === "HOME" ? coverHome : -coverHome, cfg.k);
      if (sport === "cfb" && game.cfb?.sigmaMargin != null) {
        const pHomeCover = cfbSpreadProb(model.projMargin, homeSpread, game.cfb.sigmaMargin);
        pCoverRaw = side === "HOME" ? pHomeCover : pHomeCover != null ? 1 - pHomeCover : null;
      }
      const pMarket = side === "HOME" ? pin.spread?.noVigA : pin.spread?.noVigB;
      const pCover = shrinkToMarket(pCoverRaw, pMarket);
      const priced = priceSelection({
        pWin: pCover,
        twoWay: pin.spread,
        side: side === "HOME" ? "A" : "B",
        pinPrice: side === "HOME" ? game.odds.pinSpreadHomePrice : game.odds.pinSpreadAwayPrice,
      });
      const base = {
        market: "SPREAD",
        side,
        pick: `${side === "HOME" ? (game.home.school || game.home.name) : (game.away.school || game.away.name)} ${fmtSpread(side === "HOME" ? homeSpread : -homeSpread)}`,
        line: side === "HOME" ? homeSpread : -homeSpread,
        executionPrice: heritageSpreadPrice(game, side),
        edge: priced.probEdge ?? spreadEdge,
      };
      pushPriced(recs, cfg, game, base, priced, true);
    }
  }

  if (game.odds.total != null && model.projTotal != null) {
    const diff = model.projTotal - game.odds.total;
    if (Math.abs(diff) >= cfg.minSpreadEdge) {
      const over = diff > 0;
      const pRaw =
        sport === "cfb" && game.cfb?.sigmaTotal != null
          ? cfbTotalProb(model.projTotal, game.odds.total, game.cfb.sigmaTotal, over)
          : logistic(Math.abs(diff), cfg.totalK);
      const pMarket = over ? pin.total?.noVigA : pin.total?.noVigB;
      const p = shrinkToMarket(pRaw, pMarket);
      const priced = priceSelection({
        pWin: p,
        twoWay: pin.total,
        side: over ? "A" : "B",
        pinPrice: over ? game.odds.pinOverPrice : game.odds.pinUnderPrice,
      });
      const base = {
        market: "TOTAL",
        side: over ? "OVER" : "UNDER",
        pick: `${over ? "Over" : "Under"} ${game.odds.total}`,
        line: game.odds.total,
        executionPrice: heritageTotalPrice(game, over),
        edge: priced.probEdge ?? Math.abs(diff),
      };
      pushPriced(recs, cfg, game, base, priced, true);
    }
  }

  pushF5Recs(sport, game, recs, cfg, pin);

  if (sport === "cfb" && game.cfb?.projectionState === "PRIOR_ONLY") {
    const priorOnly = sortTickets(recs.map((r) => ({
      ...r,
      qualified: false,
      lean: true,
      tag: "LEAN",
      reason: "PRIOR_ONLY CFB projection — value signal only; not eligible for a qualified or CONVICTION ticket",
    })));
    return { qualified: null, lean: priorOnly[0] || null };
  }

  const qualified = sortTickets(recs.filter((r) => r.qualified));
  const leans = sortTickets(recs.filter((r) => r.lean && !r.qualified));
  return { qualified: qualified[0] || null, lean: leans[0] || null };
}

export function recommend(sport, game, model, weights) {
  return recommendBundle(sport, game, model, weights).qualified;
}

function pushPriced(recs, cfg, game, base, priced, extraOk) {
  if (!extraOk || !withinProbCap(cfg, priced)) return;
  const qualified = isQualifiedTicket(cfg, priced);
  if (qualified) {
    recs.push(stampTicket(game, base, priced, { qualified: true, lean: false }));
    return;
  }
  if (priced.ev != null && priced.ev < 0) return;
  recs.push(stampTicket(game, base, priced, { qualified: false, lean: true }));
}

function pushMl(recs, cfg, game, side, pick, priced) {
  const hasPin = priced.implied != null;
  const edge = hasPin ? priced.probEdge : (priced.fair - 0.5) * 100;
  if (hasPin) {
    if (priced.probEdge == null || priced.probEdge / 100 < cfg.minMlEdge) return;
  } else if (priced.fair == null || priced.fair < 0.5 + cfg.minMlEdge) return;
  pushPriced(
    recs,
    cfg,
    game,
    {
      market: "ML",
      side,
      pick,
      line: null,
      executionPrice: heritageMlPrice(game, side),
      implied: priced.implied ?? null,
      edge: edge ?? 0,
    },
    priced,
    true
  );
}

function heritageMlPrice(game, side) {
  if (!game.odds?.heritageListed) return null;
  return side === "HOME" ? game.odds.heritageHomeMl ?? null : game.odds.heritageAwayMl ?? null;
}

function heritageSpreadPrice(game, side) {
  if (!game.odds?.heritageListed) return null;
  return side === "HOME" ? game.odds.heritageSpreadHomePrice ?? null : game.odds.heritageSpreadAwayPrice ?? null;
}

function heritageTotalPrice(game, over) {
  if (!game.odds?.heritageListed) return null;
  return over ? game.odds.heritageOverPrice ?? null : game.odds.heritageUnderPrice ?? null;
}

function pushF5Recs(sport, game, recs, cfg, pin) {
  if (!BASEBALL.has(sport)) return;
  const f5Odds = game.odds?.f5;
  if (!f5Odds) return;
  const formHome = game.bpp?.f5?.homeWin ?? game.bpp?.matchupForm;
  const formAway = game.bpp?.f5?.awayWin ?? (formHome != null ? 1 - formHome : null);

  if (formHome != null && (f5Odds.homeMl != null || f5Odds.awayMl != null)) {
    const homePriced = priceSelection({ pWin: formHome, twoWay: pin?.f5ml, side: "A", pinPrice: f5Odds.homeMl });
    const awayPriced = priceSelection({ pWin: formAway, twoWay: pin?.f5ml, side: "B", pinPrice: f5Odds.awayMl });
    if (homePriced.probEdge != null && homePriced.probEdge / 100 >= cfg.minMlEdge) {
      pushPriced(
        recs,
        cfg,
        game,
        { market: "F5 ML", side: "HOME", pick: `${game.home.name} F5`, line: null, executionPrice: null, edge: homePriced.probEdge },
        homePriced,
        true
      );
    }
    if (formAway != null && awayPriced.probEdge != null && awayPriced.probEdge / 100 >= cfg.minMlEdge) {
      pushPriced(
        recs,
        cfg,
        game,
        { market: "F5 ML", side: "AWAY", pick: `${game.away.name} F5`, line: null, executionPrice: null, edge: awayPriced.probEdge },
        awayPriced,
        true
      );
    }
  }

  const palTotal = game.bpp?.f5?.total;
  if (palTotal != null && f5Odds.total != null) {
    const line = f5Odds.total;
    const diff = palTotal - line;
    if (Math.abs(diff) >= cfg.minSpreadEdge) {
      const over = diff > 0;
      const pF5Raw = logistic(Math.abs(diff), cfg.totalK);
      const pF5Mkt = over ? pin?.f5total?.noVigA : pin?.f5total?.noVigB;
      const priced = priceSelection({
        pWin: shrinkToMarket(pF5Raw, pF5Mkt),
        twoWay: pin?.f5total,
        side: over ? "A" : "B",
        pinPrice: over ? f5Odds.overPrice : f5Odds.underPrice,
      });
      const base = {
        market: "F5 TOTAL",
        side: over ? "OVER" : "UNDER",
        pick: `${over ? "Over" : "Under"} ${line} F5`,
        line,
        executionPrice: null,
        edge: priced.probEdge ?? Math.abs(diff),
      };
      if (isQualifiedTicket(cfg, priced)) {
        recs.push(stampTicket(game, base, priced, { qualified: true, lean: false }));
      } else {
        recs.push(
          stampTicket(game, base, priced, { qualified: false, lean: true })
        );
      }
    }
  }
}

function homeSpreadValid(game) {
  return game.odds.spread != null;
}

function fmtSpread(n) {
  if (n == null) return "";
  return n > 0 ? `+${n}` : String(n);
}

function espnWinPct(event, home) {
  const fromComp = num(home?.probability?.winPercentage) ?? num(home?.gameProjection);
  if (fromComp != null) return fromComp > 1 ? fromComp / 100 : fromComp;
  const hp = num(event.competitions?.[0]?.odds?.[0]?.homeTeamOdds?.winPercentage);
  if (hp != null) return hp > 1 ? hp / 100 : hp;
  return null;
}

export function mapEvent(sport, event) {
  const comp = event.competitions?.[0] || {};
  const homeC = competitor(comp, "home");
  const awayC = competitor(comp, "away");
  const home = teamPayload(homeC);
  const away = teamPayload(awayC);
  home.espnId = homeC?.team?.id || homeC?.id || null;
  away.espnId = awayC?.team?.id || awayC?.id || null;
  home.conference = homeC?.team?.conferenceId || null;
  away.conference = awayC?.team?.conferenceId || null;
  const odds = parseOdds(comp, sport);
  const status = statusInfo(comp);
  const espnHomeWinPct = espnWinPct(event, homeC);
  const notes = (event.notes || []).map((n) => n.headline).filter(Boolean);
  const neutralSite = Boolean(comp.neutralSite) || notes.some((n) => /neutral/i.test(n));

  let projHome = null;
  let projAway = null;
  let marketProjHome = null;
  let marketProjAway = null;
  let projectionKind = "UNAVAILABLE";
  if (odds.total != null && odds.spread != null) {
    const homeSpread = odds.spread;
    marketProjHome = odds.total / 2 - homeSpread / 2;
    marketProjAway = odds.total / 2 + homeSpread / 2;
  }
  if (BASEBALL.has(sport)) {
    projectionKind = "UNAVAILABLE";
  } else if (sport === "nfl") {
    projectionKind = marketProjHome != null ? "PINNACLE_IMPLIED" : "UNAVAILABLE";
  } else if (sport === "cfb") {
    projectionKind = "UNAVAILABLE";
  } else if (marketProjHome != null) {
    projHome = marketProjHome;
    projAway = marketProjAway;
    projectionKind = "PINNACLE_IMPLIED";
  } else if (odds.spread != null) {
    const base = sport === "nba" ? 112 : sport === "cbb" ? 72 : 24;
    projHome = base - odds.spread / 2;
    projAway = base + odds.spread / 2;
    projectionKind = "PINNACLE_IMPLIED";
  }

  const mapped = {
    id: event.id,
    sport,
    start: event.date,
    status,
    home,
    away,
    odds,
    espnHomeWinPct,
    projHomeScore: projHome,
    projAwayScore: projAway,
    marketProjHome,
    marketProjAway,
    projectionKind,
    venue: comp.venue?.fullName || "",
    broadcast: (comp.broadcasts || []).map((b) => b.names?.[0] || b.market).filter(Boolean).join(", "),
    notes,
    week: num(event.week?.number) ?? num(event.season?.week) ?? null,
    neutralSite,
    conference: home.conference || away.conference || null,
  };
  return attachMarketLabels(enrichGameTeams(sport, mapped));
}

export async function fetchEspnScoreboard(sport, date) {
  const cfg = SPORTS[sport] || SPORTS.cbb;
  const stamp = dateStamp(date);
  const url = `https://site.api.espn.com/apis/site/v2/sports/${cfg.espn}/scoreboard?dates=${stamp}&limit=300`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        Accept: "application/json,text/plain,*/*",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: "https://www.espn.com/",
        Origin: "https://www.espn.com",
      },
    });
    if (res.ok) return res.json();
    if (sport !== "cfb") throw new Error(`ESPN ${cfg.label} ${res.status}`);
  } catch (err) {
    if (sport !== "cfb") throw err;
  }
  // CFB-specific fallback: site.api is intermittently geo/edge-blocked; cdn endpoint stays public.
  const fallback = `https://cdn.espn.com/core/college-football/scoreboard?xhr=1&dates=${stamp}&limit=300`;
  const fb = await fetch(fallback, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
      Accept: "application/json,text/plain,*/*",
      Referer: "https://www.espn.com/",
    },
  });
  if (fb.ok) {
    const json = await fb.json();
    return { ...(json || {}), events: json?.events || json?.content?.sbData?.events || [] };
  }
  const core = await fetchCfbCoreScoreboard(stamp);
  if (core.events?.length) return core;
  throw new Error(`ESPN ${cfg.label} ${fb.status}`);
}

async function fetchJsonRef(url) {
  if (!url) return null;
  const httpsUrl = String(url).replace(/^http:\/\//i, "https://");
  const res = await fetch(httpsUrl, { headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function coreStatusToType(statusRow) {
  const name = String(statusRow?.name || "").toLowerCase();
  if (name.includes("final")) return { state: "post", completed: true, detail: statusRow?.description || "Final" };
  if (name.includes("in")) return { state: "in", completed: false, detail: statusRow?.description || "In Progress" };
  if (name.includes("halftime")) return { state: "in", completed: false, detail: statusRow?.description || "Halftime" };
  if (name.includes("postpon")) return { state: "post", completed: false, detail: statusRow?.description || "Postponed" };
  return { state: "pre", completed: false, detail: statusRow?.description || "Scheduled" };
}

async function fetchCfbCoreScoreboard(stamp) {
  const listUrl = `https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/events?dates=${stamp}&limit=300`;
  const listRes = await fetch(listUrl, { headers: { Accept: "application/json" } });
  if (!listRes.ok) return { events: [] };
  const list = await listRes.json();
  const refs = Array.isArray(list?.items) ? list.items.map((x) => x?.$ref).filter(Boolean) : [];
  const teamCache = new Map();
  const events = [];
  for (const ref of refs) {
    const ev = await fetchJsonRef(ref);
    const compRef = ev?.competitions?.[0]?.$ref;
    const comp = await fetchJsonRef(compRef);
    if (!ev || !comp) continue;
    const status = await fetchJsonRef(comp?.status?.$ref);
    const compRows = [];
    for (const cref of comp?.competitors || []) {
      const crow = await fetchJsonRef(cref?.$ref);
      if (!crow) continue;
      const teamRef = crow?.team?.$ref;
      if (!teamRef) continue;
      let team = teamCache.get(teamRef);
      if (!team) {
        team = await fetchJsonRef(teamRef);
        if (team) teamCache.set(teamRef, team);
      }
      if (!team) continue;
      compRows.push({
        homeAway: crow.homeAway,
        score: crow.score,
        team: {
          id: team.id,
          displayName: team.displayName,
          abbreviation: team.abbreviation,
          logo: Array.isArray(team.logos) ? team.logos[0]?.href || "" : "",
          conferenceId: null,
        },
      });
    }
    if (compRows.length < 2) continue;
    const st = coreStatusToType(status?.type || {});
    events.push({
      id: ev.id,
      date: ev.date,
      week: { number: num(ev?.week?.number) ?? null },
      season: { week: num(ev?.week?.number) ?? null },
      notes: [],
      competitions: [{
        neutralSite: Boolean(comp.neutralSite),
        competitors: compRows,
        status: { type: st },
        odds: [],
        venue: { fullName: "" },
        broadcasts: [],
      }],
    });
  }
  return { events };
}


function mapPitcher(p) {
  if (!p) return null;
  const name = p.fullName || [p.firstName, p.lastName].filter(Boolean).join(" ");
  if (!name && p.id == null) return null;
  const parts = String(name).trim().split(/\s+/);
  return {
    id: p.id || null,
    name,
    last: p.lastName || parts[parts.length - 1] || "",
    hand: p.pitchHand?.code || p.pitchHand?.description || "",
  };
}

function f5FromLinescore(g) {
  const innings = g.linescore?.innings || [];
  let home = 0;
  let away = 0;
  const n = Math.min(5, innings.length);
  for (let i = 0; i < n; i++) {
    home += Number(innings[i].home?.runs) || 0;
    away += Number(innings[i].away?.runs) || 0;
  }
  return { home, away, innings: n, complete: n >= 5 };
}

function mapMlbStatsGame(g) {
  const home = g.teams?.home || {};
  const away = g.teams?.away || {};
  const ht = home.team || {};
  const at = away.team || {};
  const st = g.status || {};
  const abstract = st.abstractGameState || "";
  const detailed = String(st.detailedState || "");
  const live = abstract === "Live";
  const completed = abstract === "Final" && !/postpone|cancel|suspend/i.test(detailed);
  const postponed = /postpone/i.test(detailed);
  const canceled = /cancel/i.test(detailed);
  const suspended = /suspend/i.test(detailed);
  const homeScore = num(home.score ?? g.linescore?.teams?.home?.runs);
  const awayScore = num(away.score ?? g.linescore?.teams?.away?.runs);
  const homePct = Number(home.leagueRecord?.pct);
  const awayPct = Number(away.leagueRecord?.pct);
  const formHome =
    Number.isFinite(homePct) && Number.isFinite(awayPct) && homePct + awayPct > 0
      ? (homePct + 0.03) / (homePct + awayPct + 0.03)
      : 0.54;

  const mapped = {
    id: String(g.gamePk),
    sport: "mlb",
    start: g.gameDate,
    status: {
      state: live ? "in" : completed ? "post" : "pre",
      detail: st.detailedState || abstract || "",
      completed,
      live,
      postponed,
      canceled,
      suspended,
    },
    home: {
      name: ht.name || "Home",
      abbr: ht.abbreviation || "H",
      logo: ht.id ? `https://www.mlbstatic.com/team-logos/${ht.id}.svg` : "",
      score: homeScore,
      rank: null,
      record: home.leagueRecord ? `${home.leagueRecord.wins}-${home.leagueRecord.losses}` : "",
      mlbId: ht.id || null,
    },
    away: {
      name: at.name || "Away",
      abbr: at.abbreviation || "A",
      logo: at.id ? `https://www.mlbstatic.com/team-logos/${at.id}.svg` : "",
      score: awayScore,
      rank: null,
      record: away.leagueRecord ? `${away.leagueRecord.wins}-${away.leagueRecord.losses}` : "",
      mlbId: at.id || null,
    },
    homeSp: mapPitcher(home.probablePitcher),
    awaySp: mapPitcher(away.probablePitcher),
    f5Score: f5FromLinescore(g),
    odds: { spread: null, total: null, homeMl: null, awayMl: null, details: "", book: EXECUTION_BOOK },
    espnHomeWinPct: null,
    projHomeScore: null,
    projAwayScore: null,
    venue: g.venue?.name || "",
    broadcast: "",
    notes: [],
    modelHint: { formHome },
  };
  return attachMarketLabels(enrichGameTeams("mlb", mapped));
}

async function fetchMlbStats(date) {
  const day = date || todayCT();
  const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${day}&hydrate=team,linescore,probablePitcher`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`MLB Stats ${res.status}`);
  const json = await res.json();
  return (json.dates || []).flatMap((d) => d.games || []).map(mapMlbStatsGame);
}

function inferAbbr(name = "") {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "—";
  if (parts.length === 1) return parts[0].slice(0, 3).toUpperCase();
  const picked = [parts[0], parts[parts.length - 1]]
    .map((p) => p.replace(/[^A-Za-z]/g, ""))
    .filter(Boolean)
    .map((p) => p[0]);
  return (picked.join("") || parts[0].slice(0, 3)).toUpperCase();
}

async function fetchCfbdGamesForDate(day, apiKey) {
  if (!apiKey) return [];
  const year = Number(String(day).slice(0, 4));
  if (!Number.isFinite(year) || year < 1869) return [];
  const url = new URL("https://api.collegefootballdata.com/games");
  url.searchParams.set("year", String(year));
  url.searchParams.set("seasonType", "both");
  url.searchParams.set("classification", "fbs");
  const res = await fetch(String(url), {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`CFBD games ${res.status}`);
  const rows = await res.json();
  const list = Array.isArray(rows) ? rows : [];
  return list
    .filter((g) => String(g.startDate || g.start_date || "").slice(0, 10) === day)
    .map((g) =>
      attachMarketLabels(
        enrichGameTeams("cfb", {
          id: String(g.id),
          sport: "cfb",
          start: g.startDate || g.start_date || null,
          status: {
            state: g.completed ? "post" : "pre",
            detail: g.completed ? "Final" : "Scheduled",
            completed: Boolean(g.completed),
            live: false,
            postponed: false,
            canceled: false,
            suspended: false,
          },
          home: {
            name: g.homeTeam || "Home",
            abbr: inferAbbr(g.homeTeam || ""),
            logo: "",
            score: num(g.homePoints),
            rank: null,
            record: "",
          },
          away: {
            name: g.awayTeam || "Away",
            abbr: inferAbbr(g.awayTeam || ""),
            logo: "",
            score: num(g.awayPoints),
            rank: null,
            record: "",
          },
          odds: { spread: null, total: null, homeMl: null, awayMl: null, details: "", book: EXECUTION_BOOK },
          espnHomeWinPct: null,
          projHomeScore: null,
          projAwayScore: null,
          marketProjHome: null,
          marketProjAway: null,
          projectionKind: "UNAVAILABLE",
          venue: g.venue || "",
          broadcast: "",
          notes: [],
          week: num(g.week),
          neutralSite: Boolean(g.neutralSite),
          conference: null,
        })
      )
    );
}

export function slimFinal(game) {
  return {
    id: String(game.id),
    sport: game.sport,
    start: game.start,
    home: { name: game.home?.name, abbr: game.home?.abbr, score: game.home?.score },
    away: { name: game.away?.name, abbr: game.away?.abbr, score: game.away?.score },
    status: game.status,
    f5Score: game.f5Score || null,
  };
}

/** Scoreboard only — no Parlay, Pal, or Savant. Used to grade frozen projections. */
export async function fetchResults(sport, date) {
  const id = SPORTS[sport] ? sport : "mlb";
  const day = date || todayCT();
  if (id === "mlb") {
    try {
      const games = await fetchMlbStats(day);
      return games.map(slimFinal);
    } catch {
      /* ESPN fallback below */
    }
  }
  const json = await fetchEspnScoreboard(id, day);
  return (json.events || []).map((ev) => slimFinal(mapEvent(id, ev)));
}

export function dataQuality(sport, game) {
  const flags = [];
  if (game.odds?.pinPresent === false || (game.pin?.ml && !game.pin.ml.complete)) flags.push("incomplete_pin_ml");
  if (game.odds?.spread != null && game.pin?.spread && !game.pin.spread.complete) flags.push("incomplete_pin_spread");
  if (game.odds?.total != null && game.pin?.total && !game.pin.total.complete) flags.push("incomplete_pin_total");
  if (sport === "mlb") {
    if (!game.homeSp?.name) flags.push("missing_home_sp");
    if (!game.awaySp?.name) flags.push("missing_away_sp");
    if (!game.bpp) flags.push("missing_pal");
    else if (!game.bpp.lineupsOfficial) flags.push("lineups_unofficial");
    if (game.model?.layers?.pal != null && game.model?.layers?.score != null) {
      if (Math.abs(game.model.layers.pal - game.model.layers.score) >= 0.08) flags.push("model_disagreement");
    }
    if (game.odds?.pinTotal == null && game.odds?.pinOverPrice == null) flags.push("missing_pin_total");
    if (game.odds?.pinSpread == null && game.odds?.pinSpreadHomePrice == null) flags.push("missing_pin_spread");
  }
  if (sport === "cfb" && Array.isArray(game.cfb?.flags)) {
    for (const f of game.cfb.flags) flags.push(f);
    if (game.cfb.projectionState === "LEAGUE_AVERAGE_ONLY") {
      return { score: Math.min(12, Math.max(0, 100 - flags.length * 12)), flags };
    }
  }
  if (game.projectionKind === "PINNACLE_IMPLIED") flags.push("pinnacle_implied_score");
  if (game.marketUnresolved) flags.push("market_unresolved");
  if (!game.odds?.heritageListed) flags.push("heritage_unlisted");
  const score = Math.max(0, 100 - flags.length * 12);
  return { score, flags };
}

export async function buildSlate(sport, date, env = {}) {
  const id = SPORTS[sport] ? sport : "cbb";
  const cfg = SPORTS[id];
  const day = date || todayCT();
  let games = [];

  if (id === "mlb") {
    try {
      games = await fetchMlbStats(day);
    } catch {
      games = [];
    }
  }

  if (!games.length) {
    try {
      const json = await fetchEspnScoreboard(id, day);
      games = (json.events || []).map((ev) => {
        const game = mapEvent(id, ev);
        return { ...game, model: projectGame(id, game) };
      });
    } catch (err) {
      if (!games.length) {
        if (id === "cfb" && env.CFBD_API_KEY) {
          games = await fetchCfbdGamesForDate(day, env.CFBD_API_KEY);
        }
        // Parlay can still fill the board.
        if (!games.length && !env.PARLAY_API_KEY) throw err;
      }
    }
  }

  const parlay = await fetchParlayOdds(id, env.PARLAY_API_KEY, env.caches, { cacheOnly: Boolean(env.parlayCacheOnly) });
  games = mergeParlay(games, parlay.events, id);
  games = games.map((g) => attachMarketLabels(enrichGameTeams(id, g)));

  let pal = { games: [], meta: { enabled: false } };
  let savant = { meta: { enabled: false } };
  let cfb = { meta: { enabled: false } };
  let cbbd = { meta: { configured: false } };
  if (id === "mlb") {
    savant = await fetchSavantSlate(games, env.caches);
    games = savant.games || games;
    pal = await fetchBallparkPal(day, env.BALLPARK_PAL_API_KEY, env.caches, { cacheOnly: Boolean(env.palCacheOnly) });
    games = mergeBallparkPal(games, pal);
  }
  if (id === "cfb") {
    cfb = await applyCfbModel(games, env);
    games = cfb.games || games;
    games = await attachCfbChallengers(games, env);
  }
  if (id === "cbb") {
    cbbd = await loadCbbdRatings(env);
    const attached = await attachCbbChallengers(games, env);
    games = attached.games;
    cbbd = { ...cbbd, catalog: { matched: attached.catalog?.matched, unmatched: attached.catalog?.unmatched, n: attached.catalog?.n, error: attached.catalog?.error } };
  }

  games = games.map((game) => {
    const pin = pinMarkets(game);
    const model = projectGame(id, { ...game, pin });
    const next = { ...game, model, pin, modelVersion: MODEL_VERSION };
    return { ...next, quality: dataQuality(id, next) };
  });

  const live = games.filter((g) => g.status.live).length;
  const final = games.filter((g) => g.status.completed).length;
  const upcoming = games.length - live - final;

  const slate = {
    sport: id,
    sportName: cfg.name,
    date: day,
    generatedAt: new Date().toISOString(),
    counts: { games: games.length, live, final, upcoming },
    parlay: parlay.meta || { enabled: false },
    pal: palSlateView(pal),
    savant: savant.meta || { enabled: false },
    cfb: cfb.meta || { enabled: false },
    cbbd: id === "cbb" ? cbbd.meta || { configured: false } : undefined,
    modelVersion: MODEL_VERSION,
    games,
    ticker: games.map((g) => ({
      id: g.id,
      away: g.away.abbr,
      home: g.home.abbr,
      awayName: g.away.name,
      homeName: g.home.name,
      awayLogo: g.away.logo,
      homeLogo: g.home.logo,
      awayScore: g.away.score,
      homeScore: g.home.score,
      status: g.status.detail,
      live: g.status.live,
      completed: g.status.completed,
    })),
  };
  return slate;
}
