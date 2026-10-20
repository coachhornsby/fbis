import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { openingBoardDate } from "../src/lib/boardOpeningDate.js";

const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const view = readFileSync(new URL("../src/TodayView.jsx", import.meta.url), "utf8");

describe("Board opens on today's Chicago date", () => {
  it("ignores an October 5 URL date on a fresh board load", () => {
    assert.equal(openingBoardDate({
      route: "board",
      urlDate: "2026-10-05",
      currentDate: "2026-10-19",
    }), "2026-10-19");
  });

  it("rolls to the newly supplied CT day on the next fresh load", () => {
    assert.equal(openingBoardDate({
      route: "board",
      urlDate: "2026-10-19",
      currentDate: "2026-10-20",
    }), "2026-10-20");
  });

  it("does not erase explicit date choices on other routes", () => {
    assert.equal(openingBoardDate({
      route: "models",
      urlDate: "2026-10-05",
      currentDate: "2026-10-19",
    }), "2026-10-05");
  });

  it("defaults missing/invalid other-route dates to CT today", () => {
    for (const urlDate of [null, "", "Oct 5", "2026-10"]) {
      assert.equal(openingBoardDate({
        route: "models",
        urlDate,
        currentDate: "2026-10-19",
      }), "2026-10-19");
    }
  });

  it("reads the cold board date through the date resolver", () => {
    assert.match(app, /openingBoardDate\(\{ route: normalizedRoute, urlDate: u\.searchParams\.get\("date"\), currentDate: todayCT\(\) \}\)/);
  });

  it("does not persist historical board dates in the URL", () => {
    assert.match(app, /tab === "today" && route !== "board" && date/);
    assert.match(app, /u\.searchParams\.delete\("date"\)/);
  });

  it("resets to CT today when reopening Board, while manual navigation stays available", () => {
    assert.match(app, /if \(normalized === "board"\) \{[\s\S]*?followBoardToday\.current = true;[\s\S]*?setTodayDate\(todayCT\(\)\)/);
    assert.match(app, /followBoardToday\.current = nextDate === todayCT\(\)/);
    assert.match(app, /onDate=\{onBoardDateChange\}/);
  });

  it("refreshes the date across CT midnight only while following today", () => {
    assert.match(app, /if \(!followBoardToday\.current\) return;[\s\S]*?const current = todayCT\(\);[\s\S]*?setTodayDate/);
    assert.match(view, /onDate\(todayCT\(\)\)/);
  });
});
