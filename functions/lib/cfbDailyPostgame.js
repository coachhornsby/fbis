/** Daily CFBD ingestion planner. No network calls, market data, or model authority.
 * CFBD /games is seasonal; ensure the day partition is an actual Chicago game
 * date and completed status, not a relabel of all season finals.
 */
export function chicagoDate(value) {
 const t=Date.parse(String(value||""));
 if(!Number.isFinite(t))return null;
 const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/Chicago",
  year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(t));
 const part=type=>parts.find(p=>p.type===type)?.value;
 return `${part("year")}-${part("month")}-${part("day")}`;
}
const finite=v=>v==null||v===""||!Number.isFinite(Number(v))?null:Number(v);
export function cfbDailyFinals(rows,date) {
 if(!/^\d{4}-\d{2}-\d{2}$/.test(String(date)))throw Error("INVALID_CT_PARTITION");
 return (Array.isArray(rows)?rows:[]).filter(g=>{
  const started=chicagoDate(g.startDate||g.start_time||g.startTime||g.kickoff);
  if(started!==date)return false;
  const final=g.completed!==false&&(g.completed===true||g.status==="completed"||g.status==="final"||
     g.status==="STATUS_FINAL"||g.status==="STATUS_FINAL_OVERTIME");
  const scores=finite(g.homePoints??g.home_points??g.homeScore)!=null&&
     finite(g.awayPoints??g.away_points??g.awayScore)!=null;
  if(!final||!scores)return false;
  const home=String(g.homeClassification||g.home_classification||"").toLowerCase();
  const away=String(g.awayClassification||g.away_classification||"").toLowerCase();
  // A row with unknown classification cannot prove FBS-vs-FBS.
  if(home!=="fbs"||away!=="fbs")return false;
  return /^\d+$/.test(String(g.id||g.gameId||""));
 });
}
export function cfbDailyWeeks(finals,year) {
 const result=new Map();
 for(const g of finals){
  const week=Number(g.week);
  const seasonType=String(g.seasonType||g.season_type||"regular");
  if(!Number.isInteger(week)||week<0||week>25||
     !["regular","postseason"].includes(seasonType))continue;
  result.set(`${seasonType}:${week}`,{year,week,seasonType,classification:"fbs"});
 }
 return [...result.values()].slice(0,2);
}
/** CFBD /games/players requires a category; collect all three and merge by game. */
export const CFB_PLAYER_BOX_CATEGORIES = Object.freeze(["passing", "rushing", "receiving"]);

/**
 * Filter week-scoped box rows to prior-day finals.
 * @param {array} rows
 * @param {array} finals
 * @param {{ minTeams?: number }} [opts] — team boxes need 2 sides; player boxes may have 1+
 */
export function cfbDailyBoxRows(rows, finals, opts = {}) {
  const minTeams = Number.isFinite(Number(opts.minTeams)) ? Number(opts.minTeams) : 2;
  const ids = new Set(finals.map((g) => String(g.id || g.gameId)));
  const seen = new Set();
  const out = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = String(row?.id || row?.gameId || "");
    if (!ids.has(id) || seen.has(id) || !Array.isArray(row?.teams) || row.teams.length < minTeams) continue;
    seen.add(id);
    out.push(row);
  }
  return out;
}

/**
 * Merge category-scoped /games/players responses into one row per gameId.
 * Preserves nested teams/categories so flattenGamesPlayersResponse still works.
 */
export function mergeGamesPlayersByCategory(categoryBundles = []) {
  const byGame = new Map();
  for (const bundle of categoryBundles) {
    const category = String(bundle?.category || "").toLowerCase();
    for (const game of Array.isArray(bundle?.rows) ? bundle.rows : []) {
      const id = String(game?.id || game?.gameId || "");
      if (!id) continue;
      let merged = byGame.get(id);
      if (!merged) {
        merged = {
          ...game,
          id: game.id ?? game.gameId,
          teams: (game.teams || []).map((t) => ({
            ...t,
            categories: [...(t.categories || [])],
          })),
        };
        byGame.set(id, merged);
        continue;
      }
      for (const teamBlock of game.teams || []) {
        const teamKey = String(teamBlock?.team || teamBlock?.school || "").toLowerCase();
        let dest = merged.teams.find(
          (t) => String(t?.team || t?.school || "").toLowerCase() === teamKey
        );
        if (!dest) {
          dest = { ...teamBlock, categories: [...(teamBlock.categories || [])] };
          merged.teams.push(dest);
          continue;
        }
        for (const cat of teamBlock.categories || []) {
          const catName = String(cat?.name || category || "").toLowerCase();
          const existing = dest.categories.find((c) => String(c?.name || "").toLowerCase() === catName);
          if (existing) {
            existing.types = [...(existing.types || []), ...(cat.types || [])];
          } else {
            dest.categories.push({ ...cat, name: cat?.name || category });
          }
        }
      }
    }
  }
  return [...byGame.values()];
}
