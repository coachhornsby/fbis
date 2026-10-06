import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const models = fs.readFileSync(new URL("../src/features/models/CurrentProjectionsView.jsx", import.meta.url), "utf8");
const navigation = fs.readFileSync(new URL("../src/app/navigation.js", import.meta.url), "utf8");

test("Models route does not render player props or publish decision surfaces", () => {
  const start = app.indexOf('{route === "models" || route === "publish"');
  const end = app.indexOf(') : route === "player-props" ?', start);
  assert.ok(start >= 0 && end > start, "models route block not found");
  const block = app.slice(start, end);
  assert.match(block, /CurrentProjectionsView/);
  assert.doesNotMatch(block, /PlayerPropsBoard/);
  assert.doesNotMatch(block, /PrizePicksMarketPanel/);
  assert.doesNotMatch(block, /PublishView/);
});

test("Models operational view contains no betting stars or prop language", () => {
  assert.doesNotMatch(models, /confidenceStars/);
  assert.doesNotMatch(models, /StarRow/);
  assert.doesNotMatch(models, /★★★★★|★★★★|★★★|★★/);
  assert.match(models, /Operational status only · no bet rating/);
  assert.match(models, /Betting decisions live on Board and Player Props/);
});

test("Player Props is the named prop decision surface", () => {
  assert.match(navigation, /id: "player-props", label: "PLAYER PROPS"/);
  assert.match(navigation, /id: "models", label: "MODELS", description: "Model health, status, coverage, and readiness — no betting picks"/);
  assert.match(app, /"player-props": "PLAYER PROPS"/);
});
