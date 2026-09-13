import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  LIVE_OPERATIONAL,
  deriveLiveOperational,
} from "../functions/lib/canonical/liveOperational.js";

describe("LIVE_OPERATIONAL", () => {
  it("requires production evidence for FULL_LOOP_LIVE", () => {
    const partial = deriveLiveOperational({
      wired: true,
      offlineResearch: true,
      liveEventDetected: true,
      modelExecuted: true,
      boardDisplayed: true,
      frozenCount: 0,
    });
    assert.equal(partial.status, LIVE_OPERATIONAL.BOARD_LIVE);
    assert.equal(partial.gates.projectionPersisted, false);

    const full = deriveLiveOperational({
      liveEventDetected: true,
      modelExecuted: true,
      boardDisplayed: true,
      frozenCount: 3,
      publishedCount: 1,
      gradedCount: 2,
    });
    assert.equal(full.status, LIVE_OPERATIONAL.FULL_LOOP_LIVE);
  });

  it("escalates freeze → publication → grade", () => {
    assert.equal(
      deriveLiveOperational({
        liveEventDetected: true,
        modelExecuted: true,
        boardDisplayed: true,
        frozenCount: 1,
      }).status,
      LIVE_OPERATIONAL.BOARD_LIVE
    );
    assert.equal(
      deriveLiveOperational({
        boardDisplayed: true,
        frozenCount: 1,
        publishedCount: 1,
      }).status,
      LIVE_OPERATIONAL.PUBLICATION_LIVE
    );
    assert.equal(
      deriveLiveOperational({
        frozenCount: 1,
        gradedCount: 1,
      }).status,
      LIVE_OPERATIONAL.GRADE_LIVE
    );
  });
});
