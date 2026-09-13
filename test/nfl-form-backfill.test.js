import test from "node:test";
import assert from "node:assert/strict";
import {
  espnNflEvents,
  parseEspnNflFinals,
  backfillNflTeamForm,
  NFL_FORM_BACKFILL_WEEK_MAX,
} from "../functions/lib/nflFormBackfill.js";

test("espnNflEvents reads CDN content.sbData.events", () => {
  const events = espnNflEvents({
    content: {
      sbData: {
        events: [{ id: "1", competitions: [] }],
      },
    },
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].id, "1");
});

test("espnNflEvents reads site.web.api events", () => {
  const events = espnNflEvents({ events: [{ id: "2" }] });
  assert.equal(events.length, 1);
  assert.equal(events[0].id, "2");
});

test("parseEspnNflFinals extracts completed competitions", () => {
  const finals = parseEspnNflFinals({
    content: {
      sbData: {
        events: [
          {
            id: "401671789",
            date: "2025-09-07T17:00Z",
            competitions: [
              {
                status: { type: { completed: true } },
                competitors: [
                  { homeAway: "home", score: "24", team: { id: "9", abbreviation: "GB" } },
                  { homeAway: "away", score: "17", team: { id: "16", abbreviation: "MIN" } },
                ],
              },
            ],
          },
          {
            id: "401671790",
            competitions: [
              {
                status: { type: { completed: false } },
                competitors: [
                  { homeAway: "home", score: "0", team: { id: "1", abbreviation: "ATL" } },
                  { homeAway: "away", score: "0", team: { id: "2", abbreviation: "BUF" } },
                ],
              },
            ],
          },
        ],
      },
    },
  });
  assert.equal(finals.length, 1);
  assert.equal(finals[0].home.espnId, "9");
  assert.equal(finals[0].away.espnId, "16");
  assert.equal(finals[0].homeScore, 24);
  assert.equal(finals[0].awayScore, 17);
});

test("backfillNflTeamForm applies finals via CDN week payload", async () => {
  const applied = [];
  const result = await backfillNflTeamForm({}, {
    season: 2025,
    weeks: [1],
    includePostseason: false,
    fetchWeek: async (season, week, seasonType) => {
      assert.equal(season, 2025);
      assert.equal(week, 1);
      assert.equal(seasonType, 2);
      return {
        content: {
          sbData: {
            events: [
              {
                id: "401671800",
                date: "2025-09-07T20:00Z",
                competitions: [
                  {
                    status: { type: { completed: true } },
                    competitors: [
                      { homeAway: "home", score: "27", team: { id: "12", abbreviation: "KC" } },
                      { homeAway: "away", score: "20", team: { id: "22", abbreviation: "BAL" } },
                    ],
                  },
                ],
              },
            ],
          },
        },
      };
    },
    applyFinal: async (_env, row) => {
      applied.push(row);
      return { ok: true };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.finalsSeen, 1);
  assert.equal(result.formApplied, 1);
  assert.equal(applied.length, 1);
  assert.equal(applied[0].sport, "nfl");
  assert.equal(applied[0].home.espnId, "12");
  assert.equal(applied[0].away.espnId, "22");
  assert.equal(applied[0].homeScore, 27);
  assert.equal(applied[0].awayScore, 20);
});

test("NFL_FORM_BACKFILL_WEEK_MAX is eighteen", () => {
  assert.equal(NFL_FORM_BACKFILL_WEEK_MAX, 18);
});
