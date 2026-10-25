import test from "node:test";
import assert from "node:assert/strict";
import { normalizeEspnDisplayClock } from "../functions/lib/espnDisplayClock.js";

test("ESPN clock payload retains exact live time including tenths", () => {
  assert.equal(normalizeEspnDisplayClock("6:17"),"6:17");
  assert.equal(normalizeEspnDisplayClock("00:26"),"00:26");
  assert.equal(normalizeEspnDisplayClock("0:03.7"),"0:03.7");
});
test("ESPN clock rejects invalid or missing source instead of guessing", () => {
  assert.equal(normalizeEspnDisplayClock(null),null);
  assert.equal(normalizeEspnDisplayClock("CLOCK N/A"),null);
  assert.equal(normalizeEspnDisplayClock("0:92"),null);
});
