import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";
import Module from "node:module";
import fs from "node:fs";

const componentPath = new URL("../src/components/board/MlbPitchHitMatchups.jsx", import.meta.url);
const compiled = await build({
  entryPoints: [componentPath.pathname],
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  packages: "external",
  jsx: "automatic",
  loader: { ".css": "empty" },
  logLevel: "silent",
});
const componentModule = new Module(componentPath.pathname);
componentModule.paths = Module._nodeModulePaths(process.cwd());
componentModule._compile(compiled.outputFiles[0].text, componentPath.pathname);
const { default: MlbPitchHitMatchups, mlbPitchHitSides } = componentModule.exports;

const away = { abbr: "TB", name: "Rays", fullName: "Tampa Bay Rays" };
const home = { abbr: "CLE", name: "Guardians", fullName: "Cleveland Guardians" };

test("mlb pitch-hit sides prefer Statcast packet metrics and assign edge", () => {
  const game = {
    sport: "mlb",
    awaySp: { id: 1, name: "Drew Rasmussen" },
    homeSp: { id: 2, name: "Parker Messick" },
    mlbPitchMatchup: {
      homeOffense: {
        runFactor: 1.05, xwoba: 0.335, lineupKRate: 0.21, whiffPerSwing: 0.26,
        contactPerSwing: 0.74, hardHitRate: 0.4, dynamicDifficulty: 0.4, projectedKs: 5.0,
      },
      awayOffense: {
        runFactor: 0.94, xwoba: 0.295, lineupKRate: 0.27, whiffPerSwing: 0.3,
        contactPerSwing: 0.7, hardHitRate: 0.34, dynamicDifficulty: 0.9, projectedKs: 6.8,
      },
    },
  };
  const sides = mlbPitchHitSides(game, away, home);
  assert.equal(sides.length, 2);
  assert.equal(sides[0].edgeAbbr, "CLE");
  assert.equal(sides[1].edgeAbbr, "CLE");
  assert.ok(sides[0].metrics.some((m) => m.label === "RUN FACTOR" && m.value === "1.050"));
  assert.ok(sides[0].metrics.some((m) => m.label === "xwOBA"));
});

test("MlbPitchHitMatchups renders professional pitch-vs-hit panel markup", () => {
  const html = renderToStaticMarkup(React.createElement(MlbPitchHitMatchups, {
    game: {
      sport: "mlb",
      awaySp: { id: 668881, name: "Drew Rasmussen" },
      homeSp: { id: 701397, name: "Parker Messick" },
      savant: { awaySpEra: 2.67, homeSpEra: 2.56 },
      mlbPitchMatchup: {
        homeOffense: { runFactor: 1.04, xwoba: 0.33, lineupKRate: 0.22, projectedKs: 5.1, whiffPerSwing: 0.25, contactPerSwing: 0.75, hardHitRate: 0.38, dynamicDifficulty: 0.5 },
        awayOffense: { runFactor: 0.96, xwoba: 0.3, lineupKRate: 0.26, projectedKs: 5.8, whiffPerSwing: 0.28, contactPerSwing: 0.72, hardHitRate: 0.35, dynamicDifficulty: 0.8 },
      },
    },
    away,
    home,
  }));
  assert.match(html, /Pitching vs Opponent Hitting/);
  assert.match(html, /mlb-pvh-bubble/);
  assert.match(html, /RUN FACTOR/);
  assert.match(html, /xwOBA/);
  assert.match(html, /Drew Rasmussen/);
  assert.match(html, /Parker Messick/);
  assert.match(html, /STATCAST PITCH/);
});

test("PremiumGameCard MLB path uses pitch-hit panel and white-bubble starters", () => {
  const src = fs.readFileSync("src/components/board/PremiumGameCard.jsx", "utf8");
  assert.match(src, /MlbPitchHitMatchups/);
  assert.match(src, /pgc-mlb-starter-bubble/);
  assert.match(src, /pgc-mlb/);
  assert.doesNotMatch(src, /sportId !== "nhl" \? sportId === "nfl"/);
  const css = fs.readFileSync("src/components/board/premiumGameCard.css", "utf8");
  assert.match(css, /pgc-mlb-starter-bubble/);
  assert.match(css, /0 0 0 3px #fff/);
  const board = fs.readFileSync("src/components/board/DecisionBoard.jsx", "utf8");
  assert.match(board, /sport \|\| ""\)\.toLowerCase\(\) === "mlb"/);
});
