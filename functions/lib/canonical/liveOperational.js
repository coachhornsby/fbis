/**
 * LIVE_OPERATIONAL — separate from model maturity / commercial authority.
 *
 * Maturity answers: how mature is the science?
 * LIVE_OPERATIONAL answers: is the live loop actually running in production?
 *
 * FULL_LOOP_LIVE requires all seven gates with production evidence —
 * never inferred from unit tests alone.
 */

export const LIVE_OPERATIONAL = Object.freeze({
  NOT_WIRED: "NOT_WIRED",
  OFFLINE_RESEARCH: "OFFLINE_RESEARCH",
  SHADOW_LIVE: "SHADOW_LIVE",
  BOARD_LIVE: "BOARD_LIVE",
  PUBLICATION_LIVE: "PUBLICATION_LIVE",
  GRADE_LIVE: "GRADE_LIVE",
  FULL_LOOP_LIVE: "FULL_LOOP_LIVE",
});

export const LIVE_OPERATIONAL_ORDER = Object.freeze([
  LIVE_OPERATIONAL.NOT_WIRED,
  LIVE_OPERATIONAL.OFFLINE_RESEARCH,
  LIVE_OPERATIONAL.SHADOW_LIVE,
  LIVE_OPERATIONAL.BOARD_LIVE,
  LIVE_OPERATIONAL.PUBLICATION_LIVE,
  LIVE_OPERATIONAL.GRADE_LIVE,
  LIVE_OPERATIONAL.FULL_LOOP_LIVE,
]);

/**
 * @param {{
 *   wired?: boolean,
 *   offlineResearch?: boolean,
 *   liveEventDetected?: boolean,
 *   modelExecuted?: boolean,
 *   boardDisplayed?: boolean,
 *   frozenCount?: number,
 *   publicationReadyCount?: number,
 *   publishedCount?: number,
 *   gradedCount?: number,
 * }} evidence
 */
export function deriveLiveOperational(evidence = {}) {
  const frozen = Number(evidence.frozenCount || 0);
  const pubReady = Number(evidence.publicationReadyCount || 0);
  const published = Number(evidence.publishedCount || 0);
  const graded = Number(evidence.gradedCount || 0);

  const gates = {
    liveEventDetected: Boolean(evidence.liveEventDetected),
    modelExecuted: Boolean(evidence.modelExecuted),
    projectionPersisted: frozen > 0,
    boardDisplayed: Boolean(evidence.boardDisplayed),
    publicationArtifact: published > 0 || pubReady > 0,
    finalCaptured: graded > 0,
    gradeInEvidenceStore: graded > 0,
  };

  if (
    gates.liveEventDetected &&
    gates.modelExecuted &&
    gates.projectionPersisted &&
    gates.boardDisplayed &&
    gates.publicationArtifact &&
    gates.finalCaptured &&
    gates.gradeInEvidenceStore
  ) {
    return { status: LIVE_OPERATIONAL.FULL_LOOP_LIVE, gates };
  }
  if (gates.gradeInEvidenceStore && gates.projectionPersisted) {
    return { status: LIVE_OPERATIONAL.GRADE_LIVE, gates };
  }
  if (gates.publicationArtifact && gates.boardDisplayed) {
    return { status: LIVE_OPERATIONAL.PUBLICATION_LIVE, gates };
  }
  if (gates.boardDisplayed && gates.modelExecuted) {
    return { status: LIVE_OPERATIONAL.BOARD_LIVE, gates };
  }
  if (gates.liveEventDetected && gates.modelExecuted) {
    return { status: LIVE_OPERATIONAL.SHADOW_LIVE, gates };
  }
  if (evidence.offlineResearch || evidence.wired) {
    return { status: LIVE_OPERATIONAL.OFFLINE_RESEARCH, gates };
  }
  if (evidence.wired === false) {
    return { status: LIVE_OPERATIONAL.NOT_WIRED, gates };
  }
  return { status: LIVE_OPERATIONAL.NOT_WIRED, gates };
}
