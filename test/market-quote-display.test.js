import test from "node:test";
import assert from "node:assert/strict";
import { decimalToAmerican, contractPriceToAmerican, marketDisplayAmerican, marketDisplayImplied, signedAmerican } from "../src/lib/marketQuoteDisplay.js";

test("PinnOdds decimal moneyline converts to American without changing market authority", () => {
  assert.equal(decimalToAmerican(2.2), 120);
  assert.equal(decimalToAmerican(1.735), -136);
  assert.equal(marketDisplayAmerican({ source: "PinnOdds", decimalOdds: 1.735 }), -136);
  assert.equal(Math.round(marketDisplayImplied({ decimalOdds: 2.2 }) * 10000) / 100, 45.45);
});
test("Polymarket ask is shown as a raw cost-implied percentage and American equivalent", () => {
  const quote = { source: "Polymarket US WebSocket", contractPrice: 0.5675 };
  assert.equal(marketDisplayImplied(quote), 0.5675);
  assert.equal(contractPriceToAmerican(0.5675), -131);
  assert.equal(marketDisplayAmerican(quote), -131);
  assert.equal(signedAmerican(marketDisplayAmerican(quote)), "-131");
});
test("Invalid and incomplete quotes do not create fake implied prices", () => {
  for (const value of [null, undefined, 0, 1, -0.1, 1.1]) assert.equal(contractPriceToAmerican(value), null);
  assert.equal(decimalToAmerican(1), null);
  assert.equal(marketDisplayImplied({ contractPrice: null }), null);
  assert.equal(marketDisplayAmerican({}), null);
});
test("Existing valid American odds take precedence", () => {
  assert.equal(marketDisplayAmerican({ americanOdds: -110, decimalOdds: 2.5 }), -110);
  assert.equal(signedAmerican(120), "+120");
});
