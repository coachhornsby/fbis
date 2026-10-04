/**
 * CBB-POSSESSION-v1
 *
 * Independent possession / lineup reconstruction from ESPN/SportsDataverse PBP.
 * No market data enters this layer.
 *
 * Design goals:
 * - deterministic, leakage-safe event parsing
 * - explicit QA for unresolved substitutions / lineup coverage
 * - infer shot-clock phase from possession/segment elapsed time
 * - aggregate 2-5 man combinations without requiring a third-party lineup feed
 */

export const CBB_POSSESSION_MODEL_ID = "CBB-POSSESSION-v1";
export const CBB_POSSESSION_MODEL_VERSION = "v1.0.0";

const num = (v) => {
  if (v == null || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};
const bool = (v) => v === true || ["1","true","t","yes"].includes(String(v || "").toLowerCase());
const key = (v) => String(v ?? "");
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const pct = (a,b) => b > 0 ? a / b : null;
const round = (v,d=6) => v == null ? null : Number(Number(v).toFixed(d));

export function parseClockSeconds(row = {}) {
  const direct = num(row.start_period_seconds_remaining ?? row.end_period_seconds_remaining);
  if (direct != null) return direct;
  const m = num(row.clock_minutes);
  const s = num(row.clock_seconds);
  if (m != null && s != null) return 60 * m + s;
  const display = String(row.clock_display_value ?? row.time ?? "");
  const hit = display.match(/(\d{1,2}):(\d{2})/);
  return hit ? Number(hit[1]) * 60 + Number(hit[2]) : null;
}

export function normalizeCbbPbpRow(row = {}) {
  return {
    raw: row,
    gameId: key(row.game_id),
    sequence: num(row.sequence_number ?? row.game_play_number ?? row.id) ?? 0,
    period: num(row.period_number ?? row.half) ?? 1,
    secondsRemaining: parseClockSeconds(row),
    teamId: key(row.team_id),
    homeTeamId: key(row.home_team_id),
    awayTeamId: key(row.away_team_id),
    homeTeamName: row.home_team_name ?? null,
    awayTeamName: row.away_team_name ?? null,
    athlete1: key(row.athlete_id_1),
    athlete2: key(row.athlete_id_2),
    athlete3: key(row.athlete_id_3),
    typeId: num(row.type_id),
    typeText: String(row.type_text ?? ""),
    text: String(row.text ?? row.short_description ?? ""),
    shootingPlay: bool(row.shooting_play),
    scoringPlay: bool(row.scoring_play),
    scoreValue: num(row.score_value) ?? 0,
    homeScore: num(row.home_score),
    awayScore: num(row.away_score),
    x: num(row.coordinate_x),
    y: num(row.coordinate_y),
  };
}

function words(e) {
  return (e.typeText + " " + e.text).toLowerCase();
}
function isTurnover(e) { return /turnover|lost ball|bad pass|travel|offensive foul/.test(words(e)); }
function isRebound(e) { return /rebound/.test(words(e)); }
function isOffRebound(e) { return /offensive rebound|off\. rebound|off rebound/.test(words(e)); }
function isDefRebound(e) { return isRebound(e) && !isOffRebound(e); }
function isFreeThrow(e) { return /free throw/.test(words(e)); }
function isMade(e) { return /made|makes|good/.test(words(e)) || (e.scoringPlay && e.scoreValue > 0); }
function isThree(e) {
  const w = words(e);
  return /3-?pt|three point|three-point/.test(w) || e.scoreValue === 3;
}
function isEndPeriod(e) { return /end of|end period|end of half|end of game/.test(words(e)); }
function isSub(e) { return /substitution|enters the game|checks? in|subbed in|sub in|replaces/.test(words(e)); }
function isFoul(e) { return /foul/.test(words(e)); }

function offenseTeamFromEvent(e, currentOffense) {
  if (e.teamId) {
    if (e.shootingPlay || isTurnover(e) || isOffRebound(e) || isFreeThrow(e)) return e.teamId;
    if (isDefRebound(e)) {
      if (e.teamId === e.homeTeamId) return e.awayTeamId;
      if (e.teamId === e.awayTeamId) return e.homeTeamId;
    }
  }
  return currentOffense || null;
}

function otherTeam(e, teamId) {
  if (!teamId) return null;
  if (teamId === e.homeTeamId) return e.awayTeamId;
  if (teamId === e.awayTeamId) return e.homeTeamId;
  return null;
}

function starterSet(starters, teamId) {
  const xs = starters?.[teamId] || starters?.[String(teamId)] || [];
  return new Set(xs.map(key).filter(Boolean).slice(0,5));
}

function sortEvents(rows = []) {
  return rows.map(normalizeCbbPbpRow).sort((a,b) => {
    if (a.period !== b.period) return a.period - b.period;
    const as = a.secondsRemaining == null ? -1 : a.secondsRemaining;
    const bs = b.secondsRemaining == null ? -1 : b.secondsRemaining;
    if (as !== bs) return bs - as;
    return a.sequence - b.sequence;
  });
}

function lineupArray(set) {
  return [...set].filter(Boolean).sort();
}

function combinationKey(ids) {
  return ids.slice().sort().join("-");
}
function combos(ids, n) {
  const out = [];
  const a = ids.slice().sort();
  const rec = (start, cur) => {
    if (cur.length === n) { out.push(cur.slice()); return; }
    for (let i = start; i < a.length; i++) {
      cur.push(a[i]); rec(i + 1, cur); cur.pop();
    }
  };
  rec(0, []);
  return out;
}

function emptyStat() {
  return {
    possessions:0, pointsFor:0, pointsAgainst:0,
    fga:0, fgm:0, threePa:0, threePm:0, turnovers:0,
    orb:0, drb:0, freeThrowAttempts:0,
    early:{shots:0,makes:0,turnovers:0,points:0},
    middle:{shots:0,makes:0,turnovers:0,points:0},
    late:{shots:0,makes:0,turnovers:0,points:0},
  };
}
function shotPhase(elapsed) {
  if (elapsed == null) return "unknown";
  if (elapsed <= 10) return "early";
  if (elapsed <= 20) return "middle";
  return "late";
}

function addCombo(map, ids, possession, teamId) {
  if (!ids || ids.length < 2) return;
  for (let n=2; n<=Math.min(5,ids.length); n++) {
    for (const c of combos(ids,n)) {
      const k = n + ":" + combinationKey(c);
      const s = map.get(k) || {size:n,players:c,possessions:0,pointsFor:0,pointsAgainst:0};
      s.possessions += 1;
      if (possession.offenseTeamId === teamId) {
        s.pointsFor += possession.points;
      } else {
        s.pointsAgainst += possession.points;
      }
      map.set(k,s);
    }
  }
}

function parseSubstitution(e, lineups, qa) {
  if (!isSub(e) || !e.teamId) return;
  const l = lineups.get(e.teamId);
  if (!l) { qa.subNoTeamLineup++; return; }
  const a = e.athlete1 || null;
  const b = e.athlete2 || null;
  if (!a && !b) { qa.subNoAthlete++; return; }

  // Prefer membership evidence. ESPN participant ordering is not treated as
  // authoritative when the current lineup can identify in/out safely.
  let out = null, inn = null;
  if (a && b) {
    if (l.has(a) && !l.has(b)) { out = a; inn = b; }
    else if (l.has(b) && !l.has(a)) { out = b; inn = a; }
  }

  const t = words(e);
  if (!out || !inn) {
    // Common ESPN textual convention: "X enters the game for Y".
    if (/enters the game for|checks? in for|replaces/.test(t) && a && b) {
      inn = a; out = b;
      if (l.has(a) && !l.has(b)) { inn = b; out = a; }
    }
  }

  if (!out || !inn) { qa.subUnresolved++; return; }
  if (!l.has(out)) { qa.subOutNotOnFloor++; return; }
  l.delete(out); l.add(inn);
  if (l.size !== 5) qa.lineupSizeFaults++;
  else qa.subResolved++;
}

function finalizeStat(s) {
  const efg = s.fga ? (s.fgm + 0.5 * s.threePm) / s.fga : null;
  const tovPct = s.possessions ? s.turnovers / s.possessions : null;
  const ftr = s.fga ? s.freeThrowAttempts / s.fga : null;
  const orbPctProxy = (s.orb + s.drb) ? s.orb / (s.orb + s.drb) : null;
  return {
    ...s,
    offensiveRating:s.possessions ? 100*s.pointsFor/s.possessions : null,
    defensiveRating:s.possessions ? 100*s.pointsAgainst/s.possessions : null,
    netRating:s.possessions ? 100*(s.pointsFor-s.pointsAgainst)/s.possessions : null,
    efgPct:efg,tovPct,ftr,orbPctProxy,
    threePointRate:s.fga ? s.threePa/s.fga : null,
    earlyEfgPct:s.early.shots ? s.early.makes/s.early.shots : null,
    middleEfgPct:s.middle.shots ? s.middle.makes/s.middle.shots : null,
    lateEfgPct:s.late.shots ? s.late.makes/s.late.shots : null,
    earlyTovPct:s.possessions ? s.early.turnovers/s.possessions : null,
    middleTovPct:s.possessions ? s.middle.turnovers/s.possessions : null,
    lateTovPct:s.possessions ? s.late.turnovers/s.possessions : null,
  };
}

export function reconstructCbbGame(rows = [], starters = {}) {
  const events = sortEvents(rows);
  if (!events.length) return {ok:false,reason:"empty-game"};
  const first = events[0];
  const home = first.homeTeamId, away = first.awayTeamId;
  if (!home || !away) return {ok:false,reason:"missing-team-ids"};

  const lineups = new Map([[home,starterSet(starters,home)],[away,starterSet(starters,away)]]);
  const qa = {
    events:events.length, subEvents:0, subResolved:0, subUnresolved:0,
    subNoTeamLineup:0, subNoAthlete:0, subOutNotOnFloor:0, lineupSizeFaults:0,
    lineupPossessions:0, totalPossessions:0, repeatedClock:0,
  };
  const teamStats = new Map([[home,emptyStat()],[away,emptyStat()]]);
  const comboStats = new Map([[home,new Map()],[away,new Map()]]);
  const possessions = [];

  let offense = null;
  let startSec = null;
  let segmentStartSec = null;
  let period = null;
  let pointsAtStart = {home:first.homeScore ?? 0,away:first.awayScore ?? 0};

  function openPossession(e, team) {
    offense = team;
    period = e.period;
    startSec = e.secondsRemaining;
    segmentStartSec = e.secondsRemaining;
    pointsAtStart = {home:e.homeScore ?? pointsAtStart.home,away:e.awayScore ?? pointsAtStart.away};
  }

  function closePossession(e, reason) {
    if (!offense) return;
    const defense = otherTeam(e,offense);
    const hs = e.homeScore ?? pointsAtStart.home;
    const as = e.awayScore ?? pointsAtStart.away;
    const rawPts = offense === home ? hs-pointsAtStart.home : as-pointsAtStart.away;
    // If the first observable offensive event is the made basket itself, ESPN's
    // score field is already post-event. Recover the scoring value explicitly.
    const fallbackPts = reason === "made-field-goal" ? (num(e.scoreValue) ?? (isThree(e)?3:2)) : 0;
    const pts = clamp(Number.isFinite(rawPts) && rawPts > 0 ? rawPts : fallbackPts,0,8);
    const offLineup = lineupArray(lineups.get(offense) || new Set());
    const defLineup = lineupArray(lineups.get(defense) || new Set());
    const p = {
      offenseTeamId:offense, defenseTeamId:defense, period,
      startSeconds:startSec,endSeconds:e.secondsRemaining,
      elapsed:startSec!=null&&e.secondsRemaining!=null?Math.max(0,startSec-e.secondsRemaining):null,
      points:pts,reason,offLineup,defLineup,
    };
    possessions.push(p);
    qa.totalPossessions++;
    if (offLineup.length===5 && defLineup.length===5) qa.lineupPossessions++;
    const os = teamStats.get(offense), ds = teamStats.get(defense);
    if (os) { os.possessions++; os.pointsFor += pts; }
    if (ds) { ds.possessions++; ds.pointsAgainst += pts; }
    if (offLineup.length===5) addCombo(comboStats.get(offense),offLineup,p,offense);
    if (defLineup.length===5) addCombo(comboStats.get(defense),defLineup,p,defense);
    offense=null; startSec=null; segmentStartSec=null;
  }

  for (const e of events) {
    if (isSub(e)) { qa.subEvents++; parseSubstitution(e,lineups,qa); continue; }

    if (period != null && e.period !== period && offense) closePossession(e,"period-change");

    const inferred = offenseTeamFromEvent(e,offense);
    if (!offense && inferred) openPossession(e,inferred);

    if (e.shootingPlay && e.teamId) {
      const s = teamStats.get(e.teamId);
      if (s) {
        const elapsed = segmentStartSec!=null&&e.secondsRemaining!=null?Math.max(0,segmentStartSec-e.secondsRemaining):null;
        const ph = shotPhase(elapsed);
        if (!isFreeThrow(e)) {
          s.fga++; if (isMade(e)) s.fgm++;
          if (isThree(e)) { s.threePa++; if(isMade(e)) s.threePm++; }
          if (ph !== "unknown") {
            s[ph].shots++;
            if (isMade(e)) s[ph].makes++;
            s[ph].points += isMade(e) ? (isThree(e)?3:2) : 0;
          }
        } else {
          s.freeThrowAttempts++;
        }
      }
    }

    if (isTurnover(e) && e.teamId) {
      const s=teamStats.get(e.teamId);
      if (s) {
        s.turnovers++;
        const elapsed=segmentStartSec!=null&&e.secondsRemaining!=null?Math.max(0,segmentStartSec-e.secondsRemaining):null;
        const ph=shotPhase(elapsed); if(ph!=="unknown") s[ph].turnovers++;
      }
      if (!offense) openPossession(e,e.teamId);
      closePossession(e,"turnover");
      continue;
    }

    if (isOffRebound(e) && e.teamId) {
      const s=teamStats.get(e.teamId); if(s)s.orb++;
      // NCAA men's clock resets to 20 after an offensive rebound. We model the
      // new shot-clock segment inside the same team possession.
      segmentStartSec=e.secondsRemaining;
      continue;
    }
    if (isDefRebound(e) && e.teamId) {
      const s=teamStats.get(e.teamId); if(s)s.drb++;
      if (offense) closePossession(e,"defensive-rebound");
      openPossession(e,e.teamId);
      continue;
    }

    if (isMade(e) && e.shootingPlay && !isFreeThrow(e)) {
      if (!offense && e.teamId) openPossession(e,e.teamId);
      closePossession(e,"made-field-goal");
      continue;
    }

    if (isEndPeriod(e)) {
      if (offense) closePossession(e,"end-period");
      continue;
    }

    if (isFoul(e) && !offense && e.teamId) openPossession(e,e.teamId);
  }
  if (offense) closePossession(events[events.length-1],"end-data");

  const teams = {};
  for (const teamId of [home,away]) {
    const combosOut=[...comboStats.get(teamId).values()]
      .map(x=>({...x,offensiveRating:x.possessions?100*x.pointsFor/x.possessions:null,defensiveRating:x.possessions?100*x.pointsAgainst/x.possessions:null,netRating:x.possessions?100*(x.pointsFor-x.pointsAgainst)/x.possessions:null}))
      .sort((a,b)=>b.possessions-a.possessions);
    teams[teamId] = {
      ...finalizeStat(teamStats.get(teamId)),
      combinations:combosOut,
      topFiveLineups:combosOut.filter(x=>x.size===5).slice(0,12),
    };
  }
  const lineupCoverage = qa.totalPossessions ? qa.lineupPossessions / qa.totalPossessions : 0;
  const subResolution = qa.subEvents ? qa.subResolved / qa.subEvents : 1;
  return {
    ok:true,
    modelId:CBB_POSSESSION_MODEL_ID,
    modelVersion:CBB_POSSESSION_MODEL_VERSION,
    gameId:first.gameId,
    homeTeamId:home,awayTeamId:away,
    homeTeamName:first.homeTeamName,awayTeamName:first.awayTeamName,
    teams,possessions,
    qa:{...qa,lineupCoverage:round(lineupCoverage),subResolution:round(subResolution)},
    // ESPN's historical MBB release can contain no substitution events at all.
    // Never certify reconstructed lineups unless substitution evidence exists.
    lineupReliable:qa.subEvents>0 && lineupCoverage>=0.80 && subResolution>=0.80 && qa.lineupSizeFaults===0,
    independent:true,marketInformed:false,canQualify:false,canAuthorizeWager:false,
  };
}

export function cbbPossessionGameFeatures(result) {
  if (!result?.ok) return {};
  const h=result.teams?.[result.homeTeamId], a=result.teams?.[result.awayTeamId];
  if(!h||!a)return{};
  const d=(k)=>num(h[k])!=null&&num(a[k])!=null?round(num(h[k])-num(a[k])):null;
  const s=(k)=>num(h[k])!=null&&num(a[k])!=null?round(num(h[k])+num(a[k])):null;
  const keys=["offensiveRating","defensiveRating","netRating","efgPct","tovPct","ftr","orbPctProxy","threePointRate","earlyEfgPct","middleEfgPct","lateEfgPct","earlyTovPct","middleTovPct","lateTovPct"];
  const out={};
  for(const k of keys){out[k+"Diff"]=d(k);out[k+"Sum"]=s(k);}
  out.lineupCoverage=result.qa?.lineupCoverage??null;
  out.subResolution=result.qa?.subResolution??null;
  const h5=h.topFiveLineups?.[0],a5=a.topFiveLineups?.[0];
  out.topLineupPossessionShareDiff=(h.possessions&&a.possessions&&h5&&a5)?round(h5.possessions/h.possessions-a5.possessions/a.possessions):null;
  out.topLineupNetDiff=(h5?.netRating!=null&&a5?.netRating!=null)?round(h5.netRating-a5.netRating):null;
  return out;
}
