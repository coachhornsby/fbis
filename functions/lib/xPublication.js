/**
 * X / social publication copy + card builders.
 * Manual post workflow — no auto-post. Research labeled honestly.
 * Browser-safe: no node:crypto / research pipeline imports.
 */

function round1(v) {
  return Math.round(Number(v) * 10) / 10;
}

/** Home-perspective disagreement: fbisHomeMargin - (-marketHomeSpread). */
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
export const PUBLICATION_STATES = Object.freeze({
  NOT_PUBLISHABLE: "NOT_PUBLISHABLE",
  RESEARCH_PUBLISHABLE: "RESEARCH_PUBLISHABLE",
  PRODUCTION_PUBLISHABLE: "PRODUCTION_PUBLISHABLE",
  PUBLISHED: "PUBLISHED",
  SUPERSEDED: "SUPERSEDED",
  RETRACTED: "RETRACTED",
});

const BANNED_PHRASES = [
  /\block\b/i,
  /free money/i,
  /guaranteed/i,
  /can['']t miss/i,
  /\b100%\b/,
  /sharp play/i,
];

export function assertCleanCopy(text) {
  const s = String(text || "");
  for (const re of BANNED_PHRASES) {
    if (re.test(s)) return { ok: false, reason: `banned-phrase:${re}` };
  }
  return { ok: true };
}

function teamName(t) {
  if (!t) return "TBD";
  if (typeof t === "string") return t;
  return t.fullName || t.name || t.school || t.abbr || "TBD";
}

function teamAbbr(t) {
  if (!t) return "TBD";
  if (typeof t === "string") return t.slice(0, 3).toUpperCase();
  return t.abbr || String(t.name || t.school || "TBD").slice(0, 3).toUpperCase();
}

function fmt(n) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return Number(n).toFixed(1);
}

function sportTag(sport) {
  return String(sport || "").toUpperCase();
}

/**
 * Publication eligibility — separate from wager authority.
 */
export function publicationEligibilityForGame(game = {}) {
  const maturity = String(game.projectionMaturity || game.model?.maturity || "").toUpperCase();
  const kind = String(game.projectionKind || game.model?.projectionKind || "").toUpperCase();
  const home = Number(game.model?.projHome ?? game.projHomeScore);
  const away = Number(game.model?.projAway ?? game.projAwayScore);
  const hasScores = Number.isFinite(home) && Number.isFinite(away);
  const independent = kind === "FBIS" && hasScores && game.pureProjectionAvailable !== false;

  if (!independent) {
    return {
      eligible: false,
      status: PUBLICATION_STATES.NOT_PUBLISHABLE,
      reason: "no-independent-fbis-projection",
      canQualify: false,
      canAuthorizeWager: false,
    };
  }

  if (maturity === "RESEARCH" || game.canQualify === false || game.qualificationBlocked) {
    return {
      eligible: true,
      status: PUBLICATION_STATES.RESEARCH_PUBLISHABLE,
      reason: "research-publication-ok-wager-gated",
      canQualify: false,
      canAuthorizeWager: false,
    };
  }

  return {
    eligible: true,
    status: PUBLICATION_STATES.PRODUCTION_PUBLISHABLE,
    reason: "production-projection",
    canQualify: game.canQualify !== false,
    canAuthorizeWager: game.canAuthorizeWager === true,
  };
}

export function buildProjectionCard(game = {}, sport = null) {
  const home = Number(game.model?.projHome ?? game.projHomeScore);
  const away = Number(game.model?.projAway ?? game.projAwayScore);
  const marketSpread = Number(game.odds?.pinSpread ?? game.odds?.spread ?? game.pin?.spread?.line);
  const marketTotal = Number(game.odds?.pinTotal ?? game.odds?.total ?? game.pin?.total?.line);
  const disagreement = modelMarketDisagreement({
    projHome: home,
    projAway: away,
    marketHomeSpread: marketSpread,
    marketTotal,
  });
  const eligibility = publicationEligibilityForGame(game);
  return {
    sport: sport || game.sport || null,
    league: sport || game.sport || null,
    event: game.id || null,
    away_team: teamName(game.away),
    home_team: teamName(game.home),
    away_logo: game.away?.logo || null,
    home_logo: game.home?.logo || null,
    event_time: game.start || null,
    venue: typeof game.venue === "string" ? game.venue : game.venue?.name || null,
    model_id: game.researchProjection?.modelId || game.projectionEngine || game.modelVersion || null,
    model_version: game.researchProjection?.modelVersion || game.modelVersion || null,
    model_status: game.projectionMaturity || game.model?.maturity || "UNKNOWN",
    away_projection: Number.isFinite(away) ? away : null,
    home_projection: Number.isFinite(home) ? home : null,
    projected_margin: Number.isFinite(home) && Number.isFinite(away) ? home - away : null,
    projected_total: Number.isFinite(home) && Number.isFinite(away) ? home + away : null,
    market_spread: Number.isFinite(marketSpread) ? marketSpread : null,
    market_total: Number.isFinite(marketTotal) ? marketTotal : null,
    market_moneyline: {
      home: game.odds?.pinHomeMl ?? null,
      away: game.odds?.pinAwayMl ?? null,
    },
    model_market_side_difference: disagreement.side,
    model_market_total_difference: disagreement.total,
    uncertainty: game.model?.sigmaMargin ?? game.cfb?.sigmaMargin ?? null,
    data_quality: game.quality?.score ?? game.cfb?.dataQuality ?? null,
    publication_status: eligibility.status,
    generated_at: new Date().toISOString(),
    research_disclaimer:
      eligibility.status === PUBLICATION_STATES.RESEARCH_PUBLISHABLE
        ? "Research projection — not wager-authorized"
        : null,
  };
}

export function buildXGameCopy(game = {}, sport = null) {
  const card = buildProjectionCard(game, sport);
  const sp = sportTag(card.sport);
  const research = card.model_status === "RESEARCH" || card.publication_status === PUBLICATION_STATES.RESEARCH_PUBLISHABLE;
  const awayAbbr = teamAbbr(game.away);
  const homeAbbr = teamAbbr(game.home);
  const lines = [
    `FBIS Projection — ${sp}`,
    "",
    `${teamName(game.away)} at ${teamName(game.home)}`,
    "",
    `FBIS: ${awayAbbr} ${fmt(card.away_projection)}, ${homeAbbr} ${fmt(card.home_projection)}`,
  ];
  if (card.market_spread != null || card.market_total != null) {
    const spreadTxt =
      card.market_spread == null
        ? "—"
        : card.market_spread < 0
          ? `${homeAbbr} ${card.market_spread}`
          : card.market_spread > 0
            ? `${awayAbbr} ${-card.market_spread}`
            : "PICK";
    lines.push(`Market: ${spreadTxt} | ${fmt(card.market_total)}`);
  }
  lines.push("");
  lines.push(`Model: ${card.model_id || "FBIS"}`);
  if (research) {
    lines.push("Status: Research");
    if (card.model_market_side_difference != null) {
      const abs = Math.abs(card.model_market_side_difference).toFixed(1);
      const toward =
        card.model_market_side_difference > 0
          ? teamName(game.home)
          : card.model_market_side_difference < 0
            ? teamName(game.away)
            : "neither side";
      lines.push("");
      lines.push(
        `FBIS currently makes ${toward} ${abs} points stronger relative to the market spread.`
      );
    }
  } else {
    lines.push("");
    lines.push(`Projected margin: ${homeAbbr} ${card.projected_margin >= 0 ? "+" : ""}${fmt(card.projected_margin)}`);
    lines.push(`Projected total: ${fmt(card.projected_total)}`);
  }
  lines.push("");
  lines.push(`#${sp} #FBIS`);
  const text = lines.join("\n");
  const clean = assertCleanCopy(text);
  return { ok: clean.ok, text, card, eligibility: publicationEligibilityForGame(game), reason: clean.reason || null };
}

export function buildXSlateCopy(games = [], sport = null, { dateLabel = null } = {}) {
  const sp = sportTag(sport || games[0]?.sport);
  const publishable = (games || []).filter((g) => publicationEligibilityForGame(g).eligible);
  const headerDate = dateLabel || new Date().toLocaleDateString("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
  });
  const research = publishable.every(
    (g) => String(g.projectionMaturity || "").toUpperCase() === "RESEARCH" || g.canQualify === false
  );
  const lines = [
    `FBIS ${sp}${research ? " Research" : ""} Projections — ${headerDate}`,
    "",
  ];
  for (const g of publishable.slice(0, 40)) {
    const away = Number(g.model?.projAway ?? g.projAwayScore);
    const home = Number(g.model?.projHome ?? g.projHomeScore);
    lines.push(`${teamAbbr(g.away)} ${fmt(away)} – ${teamAbbr(g.home)} ${fmt(home)}`);
  }
  if (research) {
    lines.push("");
    lines.push(`All ${sp} outputs are currently research projections and are not wager-authorized.`);
  }
  lines.push("");
  lines.push(`#${sp} #FBIS`);
  const text = lines.join("\n");
  return { ok: assertCleanCopy(text).ok, text, count: publishable.length, research };
}

export function buildTopDisagreementsCopy(games = [], { limit = 10, sport = null } = {}) {
  const rows = (games || [])
    .map((g) => {
      const card = buildProjectionCard(g, sport || g.sport);
      return { game: g, card, abs: Math.abs(card.model_market_side_difference ?? 0) };
    })
    .filter((r) => r.card.publication_status !== PUBLICATION_STATES.NOT_PUBLISHABLE && r.card.model_market_side_difference != null)
    .sort((a, b) => b.abs - a.abs)
    .slice(0, limit);

  const lines = ["FBIS Top Model Disagreements", ""];
  for (const r of rows) {
    const side = r.card.model_market_side_difference;
    lines.push(
      `${teamAbbr(r.game.away)} @ ${teamAbbr(r.game.home)} · side ${side > 0 ? "+" : ""}${side.toFixed(1)} · ${r.card.model_status}`
    );
  }
  lines.push("");
  lines.push("Disagreement ≠ calibrated edge. Research projections are not wager-authorized.");
  lines.push("#FBIS");
  const text = lines.join("\n");
  return { ok: assertCleanCopy(text).ok, text, rows: rows.map((r) => r.card) };
}
