/**
 * Enforceable data-quality severity (Model Family Standard).
 *
 * INFO / WARNING do not block.
 * QUALIFICATION_BLOCK prevents qualify/authorize.
 * MODEL_BLOCK prevents model use for the affected market.
 */

export const DQ_SEVERITY = Object.freeze({
  INFO: "INFO",
  WARNING: "WARNING",
  QUALIFICATION_BLOCK: "QUALIFICATION_BLOCK",
  MODEL_BLOCK: "MODEL_BLOCK",
});

export const DQ_REASON = Object.freeze({
  AMBIGUOUS_EVENT_IDENTITY: "AMBIGUOUS_EVENT_IDENTITY",
  AMBIGUOUS_PLAYER_IDENTITY: "AMBIGUOUS_PLAYER_IDENTITY",
  STALE_REQUIRED_MARKET: "STALE_REQUIRED_MARKET",
  MISSING_TWO_WAY_PRICE: "MISSING_TWO_WAY_PRICE",
  INVALID_PROBABILITY_PROVENANCE: "INVALID_PROBABILITY_PROVENANCE",
  MARKET_IMPLIED_AS_INDEPENDENT: "MARKET_IMPLIED_AS_INDEPENDENT",
  UNRESOLVED_CRITICAL_STARTER: "UNRESOLVED_CRITICAL_STARTER",
  COMMERCIAL_RIGHTS_BLOCK: "COMMERCIAL_RIGHTS_BLOCK",
  MISSING_OPTIONAL_FIELD: "MISSING_OPTIONAL_FIELD",
  PIT_VIOLATION: "PIT_VIOLATION",
  ARTIFACT_HASH_MISMATCH: "ARTIFACT_HASH_MISMATCH",
});

/**
 * Build a persisted DQ finding.
 */
export function buildDqFinding({
  reasonCode,
  severity,
  sport = null,
  eventId = null,
  playerId = null,
  marketType = null,
  message = null,
  details = null,
  at = null,
} = {}) {
  if (!reasonCode || !severity) {
    throw new Error("dq_finding_requires_reason_and_severity");
  }
  if (!Object.values(DQ_SEVERITY).includes(severity)) {
    throw new Error(`dq_unknown_severity:${severity}`);
  }
  return {
    reasonCode,
    severity,
    sport: sport || null,
    eventId: eventId || null,
    playerId: playerId || null,
    marketType: marketType || null,
    message: message || reasonCode,
    details: details || null,
    at: at || new Date().toISOString(),
    blocksQualification: severity === DQ_SEVERITY.QUALIFICATION_BLOCK || severity === DQ_SEVERITY.MODEL_BLOCK,
    blocksModel: severity === DQ_SEVERITY.MODEL_BLOCK,
  };
}

/**
 * Aggregate findings into an enforceable gate.
 */
export function evaluateDqGate(findings = []) {
  const list = Array.isArray(findings) ? findings : [];
  const modelBlocks = list.filter((f) => f.severity === DQ_SEVERITY.MODEL_BLOCK);
  const qualBlocks = list.filter((f) => f.severity === DQ_SEVERITY.QUALIFICATION_BLOCK);
  const warnings = list.filter((f) => f.severity === DQ_SEVERITY.WARNING);
  const infos = list.filter((f) => f.severity === DQ_SEVERITY.INFO);
  return {
    okForModel: modelBlocks.length === 0,
    okForQualification: modelBlocks.length === 0 && qualBlocks.length === 0,
    modelBlocks,
    qualificationBlocks: qualBlocks,
    warnings,
    infos,
    reasonCodes: list.map((f) => f.reasonCode),
  };
}

/**
 * Common qualification blockers — only critical defects.
 */
export function qualificationBlockersFromGame(game = {}) {
  const findings = [];
  const flags = new Set(game?.quality?.flags || []);
  const kind = String(game?.projectionKind || game?.model?.projectionKind || "").toUpperCase();

  if (flags.has("ambiguous_event_identity") || game?.identityResolved === false) {
    findings.push(
      buildDqFinding({
        reasonCode: DQ_REASON.AMBIGUOUS_EVENT_IDENTITY,
        severity: DQ_SEVERITY.QUALIFICATION_BLOCK,
        sport: game.sport,
        eventId: game.eventId || game.gameId,
        message: "Ambiguous event identity",
      })
    );
  }
  if (flags.has("ambiguous_player_identity")) {
    findings.push(
      buildDqFinding({
        reasonCode: DQ_REASON.AMBIGUOUS_PLAYER_IDENTITY,
        severity: DQ_SEVERITY.QUALIFICATION_BLOCK,
        sport: game.sport,
        playerId: game.playerId,
        message: "Ambiguous player identity",
      })
    );
  }
  if (flags.has("stale_required_market") || game?.marketFresh === false) {
    findings.push(
      buildDqFinding({
        reasonCode: DQ_REASON.STALE_REQUIRED_MARKET,
        severity: DQ_SEVERITY.QUALIFICATION_BLOCK,
        sport: game.sport,
        eventId: game.eventId || game.gameId,
        message: "Required market is stale",
      })
    );
  }
  if (flags.has("missing_two_way_price")) {
    findings.push(
      buildDqFinding({
        reasonCode: DQ_REASON.MISSING_TWO_WAY_PRICE,
        severity: DQ_SEVERITY.QUALIFICATION_BLOCK,
        sport: game.sport,
        eventId: game.eventId || game.gameId,
        message: "Missing required two-way price",
      })
    );
  }
  if (
    ["PINNACLE_IMPLIED", "PINNACLE_IMPLIED_SCORE", "MARKET_IMPLIED", "MARKET_BENCHMARK"].includes(kind) ||
    flags.has("pinnacle_implied_score")
  ) {
    findings.push(
      buildDqFinding({
        reasonCode: DQ_REASON.MARKET_IMPLIED_AS_INDEPENDENT,
        severity: DQ_SEVERITY.QUALIFICATION_BLOCK,
        sport: game.sport,
        eventId: game.eventId || game.gameId,
        message: "Market-implied projection cannot qualify as independent FBIS",
      })
    );
  }
  if (flags.has("missing_home_sp") || flags.has("missing_away_sp")) {
    findings.push(
      buildDqFinding({
        reasonCode: DQ_REASON.UNRESOLVED_CRITICAL_STARTER,
        severity: DQ_SEVERITY.QUALIFICATION_BLOCK,
        sport: game.sport,
        eventId: game.eventId || game.gameId,
        message: "Critical starter unresolved",
      })
    );
  }
  if (flags.has("commercial_rights_block")) {
    findings.push(
      buildDqFinding({
        reasonCode: DQ_REASON.COMMERCIAL_RIGHTS_BLOCK,
        severity: DQ_SEVERITY.MODEL_BLOCK,
        sport: game.sport,
        message: "Commercial rights block sold output",
      })
    );
  }
  // Optional missing fields are WARNING only — never silent qualify blocks.
  if (flags.has("missing_optional_weather")) {
    findings.push(
      buildDqFinding({
        reasonCode: DQ_REASON.MISSING_OPTIONAL_FIELD,
        severity: DQ_SEVERITY.WARNING,
        sport: game.sport,
        message: "Optional weather missing",
      })
    );
  }
  return findings;
}
