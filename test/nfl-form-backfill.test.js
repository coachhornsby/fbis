import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseEspnNflFinals, backfillNflTeamForm } from "../functions/lib/nflFormBackfill.js";
import { projectNflFormV0, NFL_SHADOW_ID } from "../functions/lib/nflModel.js";

describe("nfl form backfill", () => {
  it("parses completed ESPN week finals with espnIds", () => {
    const games = parseEspnNflFinals({
      events: [
        {
          id: "401671789",
          date: "2025-09-05T00:20:00Z",
          competitions: [
            {
              status: { type: { completed: true, state: "post" } },
              competitors: [
                {
                  homeAway: "home",
                  score: "24",
                  team: { id: "21", abbreviation: "PHI", displayName: "Philadelphia Eagles" },
                },
                {
                  homeAway: "away",
                  score: "20",
                  team: { id: "6", abbreviation: "DAL", displayName: "Dallas Cowboys" },
                },
              ],
            },
          ],
        },
        {
          id: "401671790",
          date: "2025-09-07T17:00:00Z",
          competitions: [
            {
              status: { type: { completed: false, state: "pre" } },
              competitors: [
                {
                  homeAway: "home",
                  score: "0",
                  team: { id: "12", abbreviation: "KC", displayName: "Kansas City Chiefs" },
                },
                {
                  homeAway: "away",
                  score: "0",
                  team: { id: "17", abbreviation: "NE", displayName: "New England Patriots" },
                },
              ],
            },
          ],
        },
      ],
    });
    assert.equal(games.length, 1);
    assert.equal(games[0].gameId, "401671789");
    assert.equal(games[0].home.espnId, "21");
    assert.equal(games[0].away.espnId, "6");
    assert.equal(games[0].homeScore, 24);
    assert.equal(games[0].awayScore, 20);
    assert.equal(games[0].season, 2025);
  });

  it("writes team_form for each completed final via applyFinalToForm", async () => {
    const formRows = [];
    const env = {
      DB: {
        prepare(sql) {
          return {
            _sql: sql,
            bind(...args) {
              this._args = args;
              return this;
            },
            async run() {
              if (/INSERT OR IGNORE INTO team_form_games/.test(this._sql)) {
                return { meta: { changes: 1 } };
              }
              if (/INSERT INTO team_form/.test(this._sql)) {
                formRows.push(this._args);
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 0 } };
            },
            async all() {
              return { results: [] };
            },
          };
        },
      },
    };

    const result = await backfillNflTeamForm(env, {
      season: 2025,
      weeks: [1],
      includePostseason: false,
      fetchWeek: async () => ({
        events: [
          {
            id: "401671789",
            date: "2025-09-05T00:20:00Z",
            competitions: [
              {
                status: { type: { completed: true, state: "post" } },
                competitors: [
                  {
                    homeAway: "home",
                    score: "24",
                    team: { id: "21", abbreviation: "PHI", displayName: "Philadelphia Eagles" },
                  },
                  {
                    homeAway: "away",
                    score: "20",
                    team: { id: "6", abbreviation: "DAL", displayName: "Dallas Cowboys" },
                  },
                ],
              },
            ],
          },
        ],
      }),
    });

    assert.equal(result.finalsSeen, 1);
    assert.equal(result.formApplied, 1);
    assert.ok(formRows.length >= 2);
    const keys = formRows.map((a) => String(a[2]));
    assert.ok(keys.some((k) => k === "id:21"));
    assert.ok(keys.some((k) => k === "id:6"));
  });

  it("projects form when priors exist (canonicalId maps to espn id keys)", () => {
    const proj = projectNflFormV0(
      {
        sport: "nfl",
        home: { abbr: "MIN", canonicalId: "nfl-16", name: "Minnesota Vikings" },
        away: { abbr: "GB", canonicalId: "nfl-9", name: "Green Bay Packers" },
      },
      {
        homePrior: { games: 17, pointsFor: 350, pointsAgainst: 360 },
        awayPrior: { games: 17, pointsFor: 380, pointsAgainst: 340 },
      }
    );
    assert.equal(proj.ok, true);
    assert.equal(proj.modelId, NFL_SHADOW_ID);
    assert.ok(Number.isFinite(proj.home));
    assert.ok(Number.isFinite(proj.away));
  });
});
