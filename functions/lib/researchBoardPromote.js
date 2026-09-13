/**
 * Promote legitimate research projections onto the public board.
 *
 * Research ≠ production champion.
 * Research may: RUN / DISPLAY / FREEZE / PUBLISH / GRADE
 * Research may NOT: qualify or authorize wagers
 */

import {
  projectNflPureChallenger,
  NFL_PURE_CHALLENGER_ID,
} from "./nflPureChallenger.js";
import {
  projectCbbPureChallenger,
  CBB_PURE_CHALLENGER_ID,
  CBB_PURE_CHALLENGER_VERSION,
} from "./cbbPureChallenger.js";
import { NFL_SHADOW_ID } from "./nflModel.js";
import { lookupCbbdRating } from "./cbbRatingsSafe.js";

function round1(v) {
  return Math.round(Number(v) * 10) / 10;
}

function scoresFrom(proj) {
  if (!proj) return null;
  const home = Number(
    proj.home ?? proj.projectedHome ?? proj.contract?.projectedHome ?? proj.projHome
  );
  const away = Number(
    proj.away ?? proj.projectedAway ?? proj.contract?.projectedAway ?? proj.projAway
  );
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
  return {
    home: round1(home),
    away: round1(away),
    margin: round1(home - away),
    total: round1(home + away),
  };
}

/**
 * Side disagreement (home perspective):
 *   fbisHomeMargin - (-marketHomeSpread)
 * Positive → FBIS makes home stronger than the market implies.
 * Totals: fbisTotal - marketTotal
 * These are MODEL DISAGREEMENT values — not calibrated edges.
 */
export function modelMarketDisagreement({
  projHome,
  projAway,
  marketHomeSpread,
  marketTotal,
} = {}) {
  const home = Number(projHome);
  const away = Number(projAway);
  if (!Number.isFinite(home) || !Number.isFinite(away)) {
    return {
      side: null,
      total: null,
      convention: "fbis_home_margin - (-market_home_spread); fbis_total - market_total",
    };
  }
  const margin = home - away;
  const total = home + away;
  const spread = Number(marketHomeSpread);
  const mktTotal = Number(marketTotal);
  return {
    side: Number.isFinite(spread) ? round1(margin - -spread) : null,
    total: Number.isFinite(mktTotal) ? round1(total - mktTotal) : null,
    convention: "fbis_home_margin - (-market_home_spread); fbis_total - market_total",
    fbisHomeMargin: round1(margin),
    fbisTotal: round1(total),
    marketHomeSpread: Number.isFinite(spread) ? spread : null,
    marketTotal: Number.isFinite(mktTotal) ? mktTotal : null,
  };
}

function stampResearchBoard(game, {
  modelId,
  modelVersion,
  scores,
  displayLabel = "FBIS RESEARCH PROJECTION",
  underlying = null,
  researchNote = null,
}) {
  const disagreement = modelMarketDisagreement({
    projHome: scores.home,
    projAway: scores.away,
    marketHomeSpread:
      game.odds?.pinSpread ?? game.odds?.spread ?? game.pin?.spread?.line ?? null,
    marketTotal:
      game.odds?.pinTotal ?? game.odds?.total ?? game.pin?.total?.line ?? null,
  });
  const challengerRow = {
    home: scores.home,
    away: scores.away,
    margin: scores.margin,
    total: scores.total,
    ok: true,
    modelId,
    version: modelVersion,
    role: "research",
    family: "pure",
    independent: true,
    marketInformed: false,
    canQualify: false,
    canAuthorize: false,
    maturity: "RESEARCH",
    projectionKind: "FBIS",
  };
  return {
    ...game,
    projHomeScore: scores.home,
    projAwayScore: scores.away,
    model: {
      ...(game.model || {}),
      projHome: scores.home,
      projAway: scores.away,
      projMargin: scores.margin,
      projTotal: scores.total,
      projectionKind: "FBIS",
      recipe: `${modelId}@${modelVersion}`,
      maturity: "RESEARCH",
      canQualify: false,
      canAuthorize: false,
      canShowCalibratedEv: false,
    },
    modelVersion,
    projectionKind: "FBIS",
    projectionEngine: modelId,
    projectionMaturity: "RESEARCH",
    projectionDisplayLabel: displayLabel,
    pureProjectionAvailable: true,
    qualificationBlocked: true,
    canQualify: false,
    canAuthorizeWager: false,
    publicationStatus: "RESEARCH_PUBLISHABLE",
    bettingAuthority: "NOT_ELIGIBLE",
    modelDisagreement: disagreement,
    researchProjection: {
      modelId,
      modelVersion,
      maturity: "RESEARCH",
      displayLabel,
      home: scores.home,
      away: scores.away,
      margin: scores.margin,
      total: scores.total,
      underlying,
      note: researchNote,
      canQualify: false,
      canAuthorize: false,
      generatedAt: new Date().toISOString(),
    },
    challengers: {
      ...(game.challengers || {}),
      [modelId]: challengerRow,
    },
  };
}

/** NFL research board — form-v0 baseline under NFL-FBIS-PURE. */
export function promoteNflResearchToBoard(games = []) {
  let promoted = 0;
  let skipped = 0;
  const next = (games || []).map((game) => {
    if (game.sport && game.sport !== "nfl") return game;
    const shadow = game.nflShadow || game.challengers?.[NFL_SHADOW_ID];
    let proj = null;
    let version = "research-v0-form";
    let underlying = NFL_SHADOW_ID;
    let note =
      "Independent team-scoring-form research baseline. Not a validated NFL betting model.";

    if (shadow?.ok && shadow.home != null && shadow.away != null) {
      proj = shadow;
    } else {
      const pure = projectNflPureChallenger(game, {});
      const scores = scoresFrom(pure);
      if (pure?.ok && scores) {
        proj = { ...pure, ...scores };
        version = String(pure.modelVersion || "").includes("form")
          ? "research-v0-form"
          : String(pure.modelVersion || "research-v0");
        underlying = pure.underlyingShadowId || null;
        note = pure.note || note;
      }
    }

    const scores = scoresFrom(proj);
    if (!scores) {
      skipped += 1;
      return {
        ...game,
        pureProjectionAvailable: false,
        projectionDisplayLabel: "NO INDEPENDENT FBIS PROJECTION",
        publicationStatus: "NOT_PUBLISHABLE",
        bettingAuthority: "NOT_ELIGIBLE",
        qualificationBlocked: true,
        canQualify: false,
      };
    }

    promoted += 1;
    return stampResearchBoard(game, {
      modelId: NFL_PURE_CHALLENGER_ID,
      modelVersion: version,
      scores,
      displayLabel: "FBIS RESEARCH PROJECTION",
      underlying,
      researchNote: note,
    });
  });
  return {
    games: next,
    meta: {
      modelId: NFL_PURE_CHALLENGER_ID,
      promoted,
      skipped,
      canQualify: false,
      canAuthorize: false,
      publication: "RESEARCH_PUBLISHABLE",
    },
  };
}

/** CBB research board — possessions × PPP when CBBD ratings exist. */
export function promoteCbbResearchToBoard(games = [], catalog = null) {
  let promoted = 0;
  let skipped = 0;
  const next = (games || []).map((game) => {
    if (game.sport && game.sport !== "cbb") return game;
    const home = catalog ? lookupCbbdRating(catalog, game.home) : null;
    const away = catalog ? lookupCbbdRating(catalog, game.away) : null;
    const pure = projectCbbPureChallenger({
      eventId: game.id,
      homeAdjOe: home?.adjOe,
      homeAdjDe: home?.adjDe,
      homeTempo: home?.tempo,
      awayAdjOe: away?.adjOe,
      awayAdjDe: away?.adjDe,
      awayTempo: away?.tempo,
      neutral: Boolean(game.neutralSite),
      eventStart: game.start || null,
      informationCutoff: game.researchProvenance?.ratingsAsOf || null,
    });
    const scores = scoresFrom(pure);
    if (!pure?.ok || !scores) {
      skipped += 1;
      const kind = String(game.projectionKind || game.model?.projectionKind || "").toUpperCase();
      const marketMasquerade =
        kind.includes("PINNACLE") || kind.includes("MARKET") || kind.includes("IMPLIED");
      if (marketMasquerade) {
        return {
          ...game,
          projHomeScore: null,
          projAwayScore: null,
          model: {
            ...(game.model || {}),
            projHome: null,
            projAway: null,
            projectionKind: "UNAVAILABLE",
            marketProjHome: game.model?.projHome ?? game.projHomeScore ?? null,
            marketProjAway: game.model?.projAway ?? game.projAwayScore ?? null,
          },
          projectionKind: "UNAVAILABLE",
          pureProjectionAvailable: false,
          projectionDisplayLabel: "NO INDEPENDENT FBIS PROJECTION",
          publicationStatus: "NOT_PUBLISHABLE",
          bettingAuthority: "NOT_ELIGIBLE",
          qualificationBlocked: true,
          canQualify: false,
          marketBenchmarkOnly: true,
        };
      }
      return {
        ...game,
        pureProjectionAvailable: false,
        projectionDisplayLabel: "NO INDEPENDENT FBIS PROJECTION",
        publicationStatus: "NOT_PUBLISHABLE",
        bettingAuthority: "NOT_ELIGIBLE",
        qualificationBlocked: true,
        canQualify: false,
      };
    }

    promoted += 1;
    const stamped = stampResearchBoard(game, {
      modelId: CBB_PURE_CHALLENGER_ID,
      modelVersion:
        CBB_PURE_CHALLENGER_VERSION === "research-v0"
          ? "research-v0-ratings"
          : CBB_PURE_CHALLENGER_VERSION,
      scores,
      displayLabel: "FBIS RESEARCH PROJECTION",
      researchNote:
        "Possessions × PPP research challenger from CBBD adjusted ratings. Not a production champion.",
    });
    if (
      game.model?.projectionKind === "PINNACLE_IMPLIED" ||
      game.projectionKind === "PINNACLE_IMPLIED"
    ) {
      stamped.model = {
        ...stamped.model,
        marketProjHome: game.model?.projHome ?? game.projHomeScore,
        marketProjAway: game.model?.projAway ?? game.projAwayScore,
      };
      stamped.marketProjHome = stamped.model.marketProjHome;
      stamped.marketProjAway = stamped.model.marketProjAway;
    }
    return stamped;
  });
  return {
    games: next,
    meta: {
      modelId: CBB_PURE_CHALLENGER_ID,
      promoted,
      skipped,
      canQualify: false,
      canAuthorize: false,
      publication: "RESEARCH_PUBLISHABLE",
    },
  };
}
