import test from 'node:test';
import assert from 'node:assert/strict';
import { listTeams } from '../functions/lib/teams.js';
import { BASKETBALL_PROP_SPORTS, resolveBasketballPropTeam, basketballPropWatermarkCoverage } from '../functions/lib/basketballPropTeam.js';

test('basketball coverage explicitly includes NBA, WNBA and CBB', () => {
  assert.deepEqual([...BASKETBALL_PROP_SPORTS], ['nba','wnba','cbb']);
});
test('all catalog NBA and WNBA teams resolve to their own logos', () => {
  for (const sport of ['nba', 'wnba']) {
    const teams = listTeams(sport);
    assert.ok(teams.length >= (sport === 'nba' ? 30 : 13));
    for (const team of teams) {
      const result = resolveBasketballPropTeam({ sport, team: team.abbr, player_name: 'Test' });
      assert.equal(result.status, 'resolved', sport + ' ' + team.abbr);
      assert.equal(result.canonicalId, team.id, sport + ' ' + team.abbr);
      assert.equal(result.logo, team.logo, sport + ' ' + team.abbr);
      assert.ok(result.logo.startsWith('https://'));
    }
  }
});
test('exchange NBA abbreviations map to exact canonical logos without opponent substitution', () => {
  for (const [alias, canonical] of Object.entries({
    GSW:'GS', SAS:'SA', NYK:'NY', NOP:'NO', PHO:'PHX', UTA:'UTAH',
    BRK:'BKN', WSH:'WAS',
  })) {
    const team = resolveBasketballPropTeam({ sport:'nba', team:alias, opponent:'BOS' });
    assert.equal(team.status, 'resolved', alias);
    assert.equal(team.teamAbbr, canonical, alias);
    assert.equal(team.logo, resolveBasketballPropTeam({ sport:'nba', team:canonical }).logo);
  }
});
test('WNBA aliases do not cross-wire Las Vegas, Los Angeles and New York', () => {
  assert.equal(resolveBasketballPropTeam({ sport:'wnba', team:'LV' }).teamAbbr, 'LVA');
  assert.equal(resolveBasketballPropTeam({ sport:'wnba', team:'LA' }).teamAbbr, 'LAS');
  assert.equal(resolveBasketballPropTeam({ sport:'wnba', team:'NY' }).teamAbbr, 'NYL');
});
test('college player team maps to NCAA logo using catalog ESPN team ID', () => {
  const team = listTeams('cbb').find(x => x.espnId && x.logo);
  assert.ok(team);
  const result = resolveBasketballPropTeam({sport:'cbb',team:team.abbr});
  assert.equal(result.status,'resolved');
  assert.equal(result.logo,team.logo);
});
test('no opponent or home/away guessing when player team is missing', () => {
  const r = resolveBasketballPropTeam({ sport:'nba',opponent:'BOS',home_abbr:'BOS',away_abbr:'NYK' });
  assert.equal(r.status, 'unresolved');
  assert.equal(r.logo, '');
});
test('ambiguous location, conflicting team fields and mismatched matchup fail closed', () => {
  for (const row of [
    {sport:'nba',team:'Los Angeles'},
    {sport:'nba',team:'NYK',playerTeam:'BOS'},
    {sport:'nba',team:'NYK',opponent:'NYK'},
    {sport:'nba',team:'NYK',home_abbr:'BOS',away_abbr:'DET'},
    {sport:'wnba',team:'unknown club'},
  ]) {
    const r=resolveBasketballPropTeam(row);
    assert.notEqual(r.status,'resolved',JSON.stringify(row));
    assert.equal(r.logo,'');
  }
});
test('today exchange player teams resolve, including real provider abbreviations', () => {
  for (const team of ['SAS','OKC','NYK','PHI','BOS','DET']) {
    assert.equal(resolveBasketballPropTeam({sport:'nba',team}).status,'resolved',team);
  }
});
test('coverage reports rendered cards and unresolved diagnostic rows without fabricated marks', () => {
  const report=basketballPropWatermarkCoverage([
    {sport:'nba',team:'SAS',player_name:'A'}, {sport:'nba',team:'',player_name:'B'},
    {sport:'wnba',team:'LV',player_name:'C'}, {sport:'cbb',team:'No Such Team',player_name:'D'},
    {sport:'nfl',team:'HOU',player_name:'E'},
  ]);
  assert.equal(report.total,4);
  assert.equal(report.resolved,2);
  assert.equal(report.unresolved,2);
  assert.equal(report.unresolvedRows.length,2);
  assert.equal(report.bySport.nba,2);
  assert.equal(report.bySport.wnba,1);
  assert.equal(report.bySport.cbb,1);
});
