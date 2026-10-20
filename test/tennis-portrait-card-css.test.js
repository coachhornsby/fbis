import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("tennis match headshots use a stable fixed-size cropped player frame", () => {
  const css = readFileSync(new URL("../src/components/board/tennisMatchCard.css", import.meta.url), "utf8");
  const rule = css.match(/\.tmc-compact \.tmc-headshot\.tmc-portrait-asset\s*\{([^}]*)\}/g)?.at(-1);
  assert.ok(rule, "missing explicit compact Tennis portrait override");
  assert.match(rule, /object-fit:\s*cover/);
  assert.match(rule, /object-position:\s*center 18%/);
  assert.match(css, /\.tmc \.tmc-player-visual\s*\{[^}]*overflow:\s*hidden/s);
  assert.match(css, /\.tmc \.tmc-headshot\.tmc-portrait-asset\s*\{[^}]*height:\s*100%/s);
});
