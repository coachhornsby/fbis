import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  LOGO_SIZES,
  SUPPORTED_LOGO_SPORTS,
  buildTeamIdentity,
  galleryTeamSamples,
  listRegistryCoverage,
  logoSizePx,
  resolveTeamLogo,
  teamIdentityFromTeam,
} from "../functions/lib/teamIdentity.js";
import { enrichTeam, resolveTeam } from "../functions/lib/teams.js";

describe("team identity / logo resolver", () => {
  it("resolves known MLB teams by abbreviation to registry logos", () => {
    const cle = buildTeamIdentity({ sport: "mlb", abbr: "CLE" });
    const chw = buildTeamIdentity({ sport: "mlb", abbr: "CHW" });
    assert.equal(cle.canonicalTeamId, "mlb-5");
    assert.equal(chw.canonicalTeamId, "mlb-4");
    assert.equal(cle.abbreviation, "CLE");
    assert.equal(chw.abbreviation, "CHW");
    assert.equal(cle.logo.available, true);
    assert.equal(cle.logo.source, "registry");
    assert.match(cle.logo.primaryUrl, /espncdn\.com.*\/cle\.png/i);
    assert.match(chw.logo.primaryUrl, /espncdn\.com.*\/chw\.png/i);
    assert.ok(cle.colors.primary);
  });

  it("prefers canonical id over abbreviation", () => {
    const pit = resolveTeam("nfl", { name: "Pittsburgh Steelers" });
    assert.ok(pit?.id);
    const byId = resolveTeamLogo({ canonicalTeamId: pit.id });
    assert.equal(byId.source, "registry");
    assert.equal(byId.sourceId, pit.id);
    assert.equal(byId.abbr, "PIT");
  });

  it("keeps sports isolated for shared city names", () => {
    const mlbChi = buildTeamIdentity({ sport: "mlb", abbr: "CHW" });
    const nbaChi = buildTeamIdentity({ sport: "nba", abbr: "CHI" });
    assert.ok(mlbChi.canonicalTeamId);
    assert.ok(nbaChi.canonicalTeamId);
    assert.notEqual(mlbChi.canonicalTeamId, nbaChi.canonicalTeamId);
    assert.match(mlbChi.logo.primaryUrl, /\/mlb\//);
    assert.match(nbaChi.logo.primaryUrl, /\/nba\//);
  });

  it("resolves college teams by school name with ncaa CDN path", () => {
    const duke = buildTeamIdentity({ sport: "cbb", name: "Duke" });
    const ohio = buildTeamIdentity({ sport: "cfb", name: "Ohio State" });
    assert.ok(duke.canonicalTeamId);
    assert.ok(ohio.canonicalTeamId);
    assert.equal(duke.logo.available, true);
    assert.equal(ohio.logo.available, true);
    assert.match(duke.logo.primaryUrl, /\/ncaa\/500\//);
    assert.match(ohio.logo.primaryUrl, /\/ncaa\/500\//);
  });

  it("returns empty logo for NHL until a registry exists", () => {
    const bos = resolveTeamLogo({ sport: "nhl", abbr: "BOS" });
    assert.equal(bos.url, "");
    assert.equal(bos.source, "none");
    const identity = buildTeamIdentity({ sport: "nhl", abbr: "BOS", name: "Boston Bruins" });
    assert.equal(identity.logo.available, false);
  });

  it("does not invent logos for unresolved names", () => {
    const miss = buildTeamIdentity({ sport: "mlb", name: "Springfield Isotopes" });
    assert.equal(miss.canonicalTeamId, null);
    assert.equal(miss.logo.available, false);
    assert.equal(miss.logo.primaryUrl, "");
  });

  it("rejects untrusted remote logo hosts when no registry hit", () => {
    const onlyEvil = resolveTeamLogo({
      sport: "nhl",
      logo: "https://evil.example/bos.png",
    });
    assert.equal(onlyEvil.url, "");
    assert.equal(onlyEvil.source, "none");
  });

  it("falls back from team object via teamIdentityFromTeam", () => {
    const enriched = enrichTeam("nba", { name: "Boston Celtics" });
    const identity = teamIdentityFromTeam(enriched, "nba");
    assert.equal(identity.abbreviation, "BOS");
    assert.equal(identity.logo.available, true);
  });

  it("exposes stable size tokens", () => {
    assert.equal(logoSizePx("hero"), LOGO_SIZES.hero);
    assert.equal(logoSizePx("card"), LOGO_SIZES.card);
    assert.equal(logoSizePx("compact"), LOGO_SIZES.compact);
    assert.equal(logoSizePx("micro"), LOGO_SIZES.micro);
    assert.equal(logoSizePx(40), 40);
  });

  it("reports registry coverage for supported sports", () => {
    const coverage = listRegistryCoverage();
    for (const sport of SUPPORTED_LOGO_SPORTS) {
      assert.ok(coverage[sport].teams > 0, sport);
      assert.equal(coverage[sport].withLogo, coverage[sport].teams, sport);
    }
    assert.equal(coverage.nhl.teams, 0);
  });

  it("gallery samples resolve without fabricating NHL rows", () => {
    const samples = galleryTeamSamples();
    assert.ok(samples.mlb.length >= 6);
    assert.ok(samples.nfl.length >= 2);
    assert.ok(samples.cfb.length >= 2);
    assert.ok(samples.cbb.length >= 2);
    assert.equal(samples.nhl.length, 0);
    for (const team of samples.mlb) {
      assert.equal(team.logo.available, true);
      assert.ok(team.abbreviation);
    }
  });
});
