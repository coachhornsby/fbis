import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const load = (rel) => readFile(new URL(`../src/components/board/${rel}`, import.meta.url), "utf8");

test("pinnodds line-difference tiles avoid green-on-green and mark under/over", async () => {
  const [jsx, css] = await Promise.all([load("PinnoddsCardMarkets.jsx"), load("pinnoddsCardMarkets.css")]);
  assert.match(jsx, /fbis-priced-gap-value\$\{diff\.side==="under"\?" is-under"/);
  assert.match(jsx, /className="fbis-priced-team-logo"/);
  assert.match(jsx, /side="home"/);
  assert.match(jsx, /fbis-priced-tile-mark/);
  assert.match(jsx, /FBIS HOME LINE/);
  assert.match(jsx, /FBIS TOTAL/);
  assert.match(jsx, /GAP VS MARKET/);
  assert.match(jsx, /fbis-priced-projection-line/);
  assert.match(jsx, /is-side is-home/);
  assert.match(jsx, /is-side is-away/);
  assert.doesNotMatch(jsx, /FBIS PROJECTED/);
  assert.doesNotMatch(jsx, /fbis-priced-gap-logo/);
  assert.doesNotMatch(jsx, /fbis-priced-projection-logo/);
  assert.doesNotMatch(jsx, /side\.toUpperCase\(\).*HOME/);
  assert.match(css, /\.fbis-priced-gap-value\.is-under/);
  assert.match(css, /\.fbis-priced-gap-value\.is-over/);
  assert.match(css, /\.fbis-priced-model-value\.is-spread/);
  assert.match(css, /\.fbis-priced-model-value\.is-total/);
  assert.match(css, /\.fbis-priced-tile-mark/);
  assert.match(css, /place-items:center/);
  assert.match(css, /height:117%!important/);
  assert.match(css, /translateY\(-16%\)/);
  assert.match(css, /--fbis-tile-brand/);
  assert.match(css, /-webkit-text-stroke/);
  assert.match(css, /@keyframes fbis-priced-value-pulse/);
  assert.match(css, /@keyframes fbis-priced-mark-breathe/);
  assert.match(css, /@keyframes fbis-priced-mark-scale/);
  assert.match(css, /border-radius:0!important/);
  assert.match(css, /@keyframes fbis-priced-gap-pulse-under/);
  assert.match(css, /@keyframes fbis-priced-model-pulse/);
  assert.match(css, /@keyframes fbis-priced-model-pulse-total/);
  assert.match(css, /linear-gradient\(115deg,#d4f4ff/);
});

test("moneyline priceboard logos drop plates and poly copy stays high contrast", async () => {
  const [jsx, css] = await Promise.all([
    load("MoneylinePriceComparison.jsx"),
    load("moneylinePriceComparison.css"),
  ]);
  assert.match(jsx, /tone="light"/);
  assert.match(css, /\.fbis-moneyline-comparison \.team-logo-plate/);
  assert.match(css, /border-radius:0!important/);
  assert.match(css, /\.fbis-poly-intelligence dt\{[^}]*color:#f0e9ff/);
  assert.match(css, /\.fbis-poly-intelligence dd\{[^}]*color:#ffffff/);
  assert.match(css, /font-size:11px/);
});
