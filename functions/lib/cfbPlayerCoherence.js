/**
 * Game ↔ player coherence for CFB-PLAYER-v1.
 * Only QB1/RB1/WR1 are modeled — residual buckets absorb the rest.
 */

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round1(n) {
  return Math.round(Number(n) * 10) / 10;
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function sideVolume(sideProj) {
  const qb = sideProj?.QB1 || {};
  const rb = sideProj?.RB1 || {};
  const wr = sideProj?.WR1 || {};
  return {
    qbAttempts: num(qb.attempts?.projection),
    qbCompletions: num(qb.completions?.projection),
    qbPassYards: num(qb.passing_yards?.projection),
    qbCarries: num(qb.carries?.projection),
    qbRushYards: num(qb.rushing_yards?.projection),
    rbCarries: num(rb.carries?.projection),
    rbRushYards: num(rb.rushing_yards?.projection),
    wrReceptions: num(wr.receptions?.projection),
    wrRecYards: num(wr.receiving_yards?.projection),
    wrTargets: num(wr.receptions?.expectedTargets ?? wr.receiving_yards?.expectedTargets),
  };
}

/**
 * Reconcile player volumes against team opportunity environment.
 * Does not force perfect accounting — creates OTHER_RUSHING / OTHER_RECEIVING residuals.
 */
export function reconcileGamePlayerCoherence(game = {}, sideOut = {}) {
  const diagnostics = { away: null, home: null, ok: true, violations: [] };
  let qualityAcc = 0;
  let qualityN = 0;

  for (const side of ["away", "home"]) {
    const block = sideOut[side];
    if (!block) continue;
    const env = block.environment || {};
    const vol = sideVolume(block);
    const expectedPlays = num(env.expectedPlays);
    const expectedDropbacks = num(env.expectedDropbacks);
    const expectedRush = num(env.expectedRushAttempts);

    const modeledRushCarries = (vol.qbCarries || 0) + (vol.rbCarries || 0);
    const otherRushingCarries =
      expectedRush != null ? round1(Math.max(0, expectedRush - modeledRushCarries)) : null;
    const otherRushingYards =
      otherRushingCarries != null
        ? round1(otherRushingCarries * 4.2) // residual bucket default YPC — diagnostic only
        : null;

    const wrTargets = vol.wrTargets ?? (vol.wrReceptions != null ? vol.wrReceptions / 0.62 : null);
    const otherReceivingTargets =
      expectedDropbacks != null && wrTargets != null
        ? round1(Math.max(0, expectedDropbacks - wrTargets))
        : null;
    const otherReceivingYards =
      otherReceivingTargets != null ? round1(otherReceivingTargets * 7.2) : null;

    const violations = [];
    // Soft checks — impossible volumes
    if (expectedPlays != null && vol.qbAttempts != null && vol.qbAttempts > expectedPlays * 1.15) {
      violations.push("qb-attempts-exceed-team-plays");
    }
    if (expectedRush != null && modeledRushCarries > expectedRush * 1.2) {
      violations.push("modeled-rush-exceeds-team-rush");
    }
    if (vol.qbCompletions != null && vol.qbAttempts != null && vol.qbCompletions > vol.qbAttempts + 0.05) {
      violations.push("completions-exceed-attempts");
    }
    if (vol.wrReceptions != null && vol.qbCompletions != null && vol.wrReceptions > vol.qbCompletions * 0.85) {
      violations.push("wr1-receptions-implausible-vs-completions");
    }
    if (vol.qbAttempts != null && vol.qbPassYards != null && vol.qbAttempts > 0) {
      const ypa = vol.qbPassYards / vol.qbAttempts;
      if (ypa < 3 || ypa > 14) violations.push("qb-ypa-incoherent");
    }
    if (vol.rbCarries != null && vol.rbRushYards != null && vol.rbCarries > 0) {
      const ypc = vol.rbRushYards / vol.rbCarries;
      if (ypc < 1.5 || ypc > 9) violations.push("rb-ypc-incoherent");
    }

    const sideDiag = {
      side,
      expectedPlays,
      expectedDropbacks,
      expectedRushAttempts: expectedRush,
      modeled: vol,
      OTHER_RUSHING: {
        carries: otherRushingCarries,
        yards: otherRushingYards,
      },
      OTHER_RECEIVING: {
        targets: otherReceivingTargets,
        yards: otherReceivingYards,
      },
      violations,
      ok: violations.length === 0,
    };
    diagnostics[side] = sideDiag;
    if (violations.length) {
      diagnostics.ok = false;
      diagnostics.violations.push(...violations.map((v) => `${side}:${v}`));
    }
    qualityAcc += sideDiag.ok ? 1 : 0.5;
    qualityN += 1;
  }

  return {
    ...diagnostics,
    dataQuality: qualityN ? round2(qualityAcc / qualityN) : 0.5,
    method: "residual-buckets-qb1-rb1-wr1",
    note: "Perfect accounting not required — only primary roles modeled",
  };
}

/**
 * Assert market inputs cannot alter player projection means.
 */
export function assertMarketIndependence(baseProjection, mutatedGame) {
  const again = mutatedGame;
  const markets = ["pass_attempts", "completions", "passing_yards", "rb_carries", "rb_rushing_yards", "receptions", "receiving_yards"];
  const diffs = [];
  for (const side of ["away", "home"]) {
    for (const role of ["QB1", "RB1", "WR1"]) {
      const a = baseProjection.players?.[side]?.[role] || {};
      const b = again.players?.[side]?.[role] || {};
      for (const m of Object.keys(a)) {
        if (num(a[m]?.projection) !== num(b[m]?.projection)) {
          diffs.push(`${side}.${role}.${m}`);
        }
      }
    }
  }
  return { ok: diffs.length === 0, diffs, marketsChecked: markets };
}
