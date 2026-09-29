import { buildSlate as buildCore } from "../functions/lib/slateEngineCore.js";
import { buildSlate as buildFacade } from "../functions/lib/slateEngine.js";

const env={
  PARLAY_API_KEY:null,
  THEODDS_API_KEY:null,
  SHARPAPI_API_KEY:null,
  THERUNDOWN_API_KEY:null,
  DB:null,
  caches:null,
  parlayCacheOnly:true,
};
for (const [name,fn] of [["core",buildCore],["facade",buildFacade]]) {
  try {
    const slate=await fn("nhl","2026-09-29",env);
    console.log(name,JSON.stringify({
      sport:slate?.sport,date:slate?.date,games:slate?.games?.length,
      research:slate?.research,
      samples:(slate?.games||[]).map(g=>({
        id:g.id,away:g.away?.abbr,home:g.home?.abbr,
        projectionKind:g.projectionKind,
        maturity:g.projectionMaturity,
        model:g.model?.projectionKind,
        projAway:g.model?.projAway,projHome:g.model?.projHome,
        nhlResearch:g.nhlResearch
      }))
    }));
  } catch (err) {
    console.error(name,"ERROR",err?.stack||String(err));
  }
}
