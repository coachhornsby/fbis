import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveTeamLogo } from "../src/lib/resolveTeamLogo.js";
import { buildGameCardViewModel } from "../src/lib/gameCardViewModel.js";

function mlbOppositeSides(overrides = {}) {
  return {
    id: "mlb-1",
    sport: "mlb",
    start: "2026-09-14T23:40:00Z",
    venue: "Target Field",
    away: {
      abbr: "NYY",
      name: "Yankees",
      fullName: "New York Yankees",
      record: "86-63",
      logo: "https://a.espncdn.com/i/teamlogos/mlb/500/nyy.png",
    },
    home: {
      abbr: "MIN",
      name: "Twins",
      fullName: "Minnesota Twins",
      record: "70-79",
      logo: "https://a.espncdn.com/i/teamlogos/mlb/500/min.png",
    },
    model: { projAway: 4.3, projHome: 4.0, projTotal: 8.3, projMargin: -0.3 },
    projectionKind: "FBIS",
    projectionState: "COMPLETE",
    market: {
      marketAvailable: true,
      execution: {
        available: true,
        book: "FanDuel",
        spread: -1.5,
        total: 6.5,
        moneyline: { home: -150, away: 130 },
      },
    },
    actionIntel: {
      publicSplits: {
        ticketPct: 34,
        moneyPct: 66,
        moneyTicketGap: 32,
        sharpLabel: null,
        markets: [],
      },
      movement: { openingLine: -1, currentLine: -1.5, movementMagnitude: -0.5 },
      booksCount: 4,
      displayOnly: true,
      canQualify: false,
      canAuthorize: false,
    },
    publicSplits: { ticketPct: 34, moneyPct: 66, moneyTicketGap: 32 },
    awaySp: { name: "Warren", last: "Warren" },
    homeSp: { name: "Kremer", last: "Kremer" },
    savant: { awaySpEra: 4.49, homeSpEra: 4.61 },
    weather: { temperature: 78, windSpeed: 8, description: "Partly Cloudy" },
    ...overrides,
  };
}

describe("resolveTeamLogo", () => {
  it("returns ESPN logo URL when present", () => {
    const r = resolveTeamLogo({
      abbr: "NYY",
      name: "Yankees",
      logo: "https://a.espncdn.com/i/teamlogos/mlb/500/nyy.png",
    });
    assert.equal(r.available, true);
    assert.equal(r.source, "espn");
    assert.match(r.url, /nyy\.png$/);
  });

  it("falls back cleanly when logo missing", () => {
    const r = resolveTeamLogo({ abbr: "MER", name: "Mercer" });
    assert.equal(r.available, false);
    assert.equal(r.url, null);
    assert.equal(r.abbr, "MER");
  });
});

describe("buildGameCardViewModel", () => {
  it("labels opposite sides and sport-specific units", () => {
    const vm = buildGameCardViewModel(mlbOppositeSides());
    assert.equal(vm.units.shortUnit, "RUNS");
    assert.match(vm.units.projectedLabel, /RUNS/);
    assert.equal(vm.comparison.sideRelationship, "OPPOSITE_SIDES");
    assert.equal(vm.comparison.fbisSide.abbr, "NYY");
    assert.equal(vm.comparison.marketSide.abbr, "MIN");
    assert.equal(vm.comparison.sideDiff, 1.8);
    assert.equal(vm.comparison.totalDirection, "FBIS_HIGHER");
  });

  it("surfaces ACTION tickets/money with logos and never invents ACTION SHARP", () => {
    const vm = buildGameCardViewModel(mlbOppositeSides());
    assert.equal(vm.action.available, true);
    assert.notEqual(vm.action.headline?.kind, "PROVIDER_SHARP");
    assert.equal(vm.action.headline?.label, "MONEY SIGNAL");
    assert.equal(vm.action.headline?.detail, "LARGER BETS DETECTED");
    assert.equal(vm.action.tickets.awayPct, 66);
    assert.equal(vm.action.tickets.homePct, 34);
    assert.equal(vm.action.canQualify, false);
    assert.equal(vm.action.canAuthorize, false);
  });

  it("PUBLIC HEAVY headline uses the public side's line", () => {
    const vm = buildGameCardViewModel(
      mlbOppositeSides({
        sport: "nfl",
        away: { abbr: "NYG", name: "New York Giants" },
        home: { abbr: "LAR", name: "Los Angeles Rams" },
        model: { projAway: 20.9, projHome: 31.3, projTotal: 52.2, projMargin: 10.4 },
        projectionKind: "FBIS",
        market: {
          marketAvailable: true,
          execution: { available: false },
          consensus: { available: true, source: "CONSENSUS", spread: -7.5, total: 48.5 },
        },
        actionIntel: {
          collectedAt: new Date().toISOString(),
          publicSplits: { ticketPct: 30, moneyPct: 33, moneyTicketGap: 3 },
          movement: { currentLine: -7.5 },
          displayOnly: true,
          canQualify: false,
          canAuthorize: false,
        },
        publicSplits: { ticketPct: 30, moneyPct: 33, moneyTicketGap: 3 },
      })
    );
    assert.equal(vm.action.headline.kind, "PUBLIC_HEAVY");
    assert.equal(vm.action.headline.team.abbr, "NYG");
    assert.equal(vm.action.headline.lineLabel, "NYG +7.5");
    assert.equal(vm.action.headline.detail, "NYG 70% TICKETS");
  });

  it("stale ACTION snapshots are quarantined instead of shown as current", () => {
    const old = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const vm = buildGameCardViewModel(
      mlbOppositeSides({
        actionIntel: {
          collectedAt: old,
          publicSplits: { ticketPct: 30, moneyPct: 33, moneyTicketGap: 3 },
          movement: { currentLine: -1.5 },
        },
        publicSplits: null,
      })
    );
    assert.equal(vm.action.available, false);
    assert.equal(vm.action.stale, true);
    assert.match(vm.action.emptyLabel, /STALE ACTION SNAPSHOT/);
  });

  it("empty ACTION collapses to no-data state", () => {
    const vm = buildGameCardViewModel(
      mlbOppositeSides({ actionIntel: null, publicSplits: null })
    );
    assert.equal(vm.action.available, false);
    assert.match(vm.action.emptyLabel, /NO ACTION SNAPSHOT YET/);
  });

  it("research cards stay research — no EV inventing", () => {
    const vm = buildGameCardViewModel(
      mlbOppositeSides({
        projectionMaturity: "RESEARCH",
        researchProjection: true,
        publicationStatus: "RESEARCH_PUBLISHABLE",
      })
    );
    assert.equal(vm.authority.research || vm.projection.research, true);
    assert.equal(vm.status.key, "RESEARCH");
    assert.equal(vm.decision.evAvailable, false);
    assert.equal(vm.decision.ev, null);
  });

  it("keeps starter + weather context for MLB", () => {
    const vm = buildGameCardViewModel(mlbOppositeSides());
    assert.equal(vm.context.starters.away.name, "Warren");
    assert.equal(vm.context.starters.home.era, 4.61);
    assert.equal(vm.context.weather.temp, 78);
  });

  it("sanitizes SharpAPI market copy", () => {
    const vm = buildGameCardViewModel(
      mlbOppositeSides({
        market: {
          marketAvailable: true,
          execution: { available: false },
          consensus: {
            available: true,
            source: "SharpAPI",
            spread: -1.5,
            total: 6.5,
          },
        },
      })
    );
    assert.match(vm.marketCopy.primary, /CONSENSUS/i);
    assert.doesNotMatch(String(vm.marketCopy.primary), /sharpapi/i);
  });
});
