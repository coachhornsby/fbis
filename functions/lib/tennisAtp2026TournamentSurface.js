const normalize=s=>String(s||"").normalize("NFKD")
  .replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
/** 2026 ATP Tour published calendar: display-only venue/surface reference.
 * Names, dates and ESPN source event IDs must ALL agree before use.
 * Official tournament-level surface does not verify player participation,
 * match start, model outcome, or wagering permission.
 */
const ATP_2026_EVENTS=Object.freeze({
 "708-2026":{name:"Almaty Open",city:"Almaty, Kazakhstan",surface:"hard",indoor:true,
   sourceUrl:"https://www.atptour.com/en/tournaments/almaty/9410/overview"},
 "440-2026":{name:"BNP Paribas Fortis European Open",city:"Brussels, Belgium",surface:"hard",indoor:true,
   sourceUrl:"https://www.atptour.com/en/tournaments/brussels/7485/overview"},
 "110-2026":{name:"Grand Prix Auvergne-Rhone-Alpes",city:"Lyon, France",surface:"hard",indoor:true,
   sourceUrl:"https://www.atptour.com/en/tournaments/lyon/496/overview"},
});
export function atp2026TournamentSurface(fixture,espnEvidence){
 if(String(fixture?.tour).toLowerCase()!=="atp"||!espnEvidence||
   espnEvidence.source!=="ESPN_PUBLIC_RESEARCH")return null;
 const r=ATP_2026_EVENTS[String(fixture.source_event_id||"")];
 if(!r||normalize(r.name)!==normalize(espnEvidence.tournament))return null;
 const time=Date.parse(fixture.start||"");
 if(!Number.isFinite(time)||time<Date.parse("2026-10-19T00:00:00Z")||
   time>=Date.parse("2026-10-26T12:00:00Z"))return null;
 return {source:"ATP_TOUR_2026_CALENDAR",sourceUrl:r.sourceUrl,
  tournamentName:r.name,location:r.city,surface:r.surface,indoor:r.indoor,
  category:"TOURNAMENT_SURFACE_METADATA_ONLY",
  sourceEventId:String(fixture.source_event_id),canQualify:false,canAuthorizeWager:false,
  officialMatchVerified:false};
}
