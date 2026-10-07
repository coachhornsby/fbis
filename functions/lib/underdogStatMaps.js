import { canonicalizeProPlayerPropMarket } from "./proPlayerProps.js";

const token=v=>String(v||"").trim().toLowerCase().replace(/&/g," and ").replace(/\+/g," plus ").replace(/[^a-z0-9]+/g," ").trim();

const MAPS=Object.freeze({
  tennis:new Map([
    ["aces","aces"],["double faults","double_faults"],["total games","total_games"],
    ["games won","total_games_won"],["total games won","total_games_won"],["sets","total_sets"],
    ["total sets","total_sets"],["break points won","break_points_won"],["fantasy score","fantasy_score"],
  ]),
  nfl:new Map([
    ["passing yards","passing_yards"],["pass yards","passing_yards"],["rushing yards","rushing_yards"],
    ["rush yards","rushing_yards"],["receiving yards","receiving_yards"],["rec yards","receiving_yards"],
    ["rush plus receiving yards","rush_receiving_yards"],["rushing plus receiving yards","rush_receiving_yards"],
    ["pass plus rushing yards","pass_rushing_yards"],["passing plus rushing yards","pass_rushing_yards"],
  ]),
  mlb:new Map([
    ["hits","hits"],["total bases","total_bases"],["home runs","home_runs"],["runs","runs"],
    ["rbis","rbis"],["rbi","rbis"],["hits plus runs plus rbis","hits_runs_rbis"],
    ["h plus r plus rbi","hits_runs_rbis"],["pitcher strikeouts","strikeouts"],["strikeouts","strikeouts"],
    ["fantasy score","fantasy_score"],
  ]),
  nba:new Map([
    ["points","points"],["rebounds","rebounds"],["assists","assists"],
    ["points plus rebounds plus assists","points_rebounds_assists"],["pra","points_rebounds_assists"],
    ["3 pointers made","three_pointers_made"],["3pm","three_pointers_made"],["steals","steals"],
    ["blocks","blocks"],["turnovers","turnovers"],["fantasy score","fantasy_score"],
  ]),
  wnba:new Map([
    ["points","points"],["rebounds","rebounds"],["assists","assists"],
    ["points plus rebounds plus assists","points_rebounds_assists"],["pra","points_rebounds_assists"],
    ["3 pointers made","three_pointers_made"],["3pm","three_pointers_made"],["steals","steals"],
    ["blocks","blocks"],["turnovers","turnovers"],["fantasy score","fantasy_score"],
  ]),
  cs2:new Map([
    ["maps 1 plus 2 kills","maps_1_2_kills"],["maps 1 2 kills","maps_1_2_kills"],
    ["maps 1 plus 2 headshots","maps_1_2_headshots"],["maps 1 2 headshots","maps_1_2_headshots"],
  ]),
});

const MODEL_UNDERSTOOD=Object.freeze({
  tennis:new Set(["aces","double_faults","total_games","total_games_won","total_sets","break_points_won","fantasy_score"]),
  nfl:new Set(["passing_yards","rushing_yards","receiving_yards"]),
  mlb:new Set(["hits","total_bases","home_runs","runs","rbis","hits_runs_rbis","strikeouts","fantasy_score"]),
  nba:new Set(["points","rebounds","assists","points_rebounds_assists","three_pointers_made","steals","blocks","turnovers"]),
  wnba:new Set(["points","rebounds","assists","points_rebounds_assists","three_pointers_made","steals","blocks","turnovers"]),
  cs2:new Set(["maps_1_2_kills","maps_1_2_headshots"]),
});

export function normalizeUnderdogSport(raw){
  const t=token(raw);
  if(["atp","wta","tennis"].includes(t))return "tennis";
  if(t.includes("wnba"))return "wnba";
  if(t==="nba"||t.includes("national basketball association"))return "nba";
  if(t==="nfl"||t.includes("national football league"))return "nfl";
  if(t==="mlb"||t.includes("major league baseball"))return "mlb";
  if(t==="cs2"||t.includes("counter strike"))return "cs2";
  return null;
}

export function mapUnderdogStat(sportRaw,label){
  const sport=normalizeUnderdogSport(sportRaw)||String(sportRaw||"").toLowerCase();
  const rawToken=token(label);
  const mapped=MAPS[sport]?.get(rawToken)||canonicalizeProPlayerPropMarket(sport,label)||null;
  return {sport,rawLabel:label??null,statFamily:mapped,modelSupported:Boolean(mapped&&MODEL_UNDERSTOOD[sport]?.has(mapped))};
}

export function supportedUnderdogMappings(){
  return Object.fromEntries(Object.entries(MAPS).map(([sport,m])=>[sport,[...m.entries()].map(([label,statFamily])=>({label,statFamily,modelSupported:Boolean(MODEL_UNDERSTOOD[sport]?.has(statFamily))}))]));
}
