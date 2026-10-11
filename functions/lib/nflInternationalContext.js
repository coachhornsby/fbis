/**
 * NFL international venue evidence. Context-only (no fitted travel coefficient).
 * Strong venue/country signals may identify a non-domestic site; no ESPN home
 * designation is treated as a true home-field advantage overseas.
 */
const SITES = [
  {match:/tottenham hotspur|wembley|twickenham/i,city:"London",country:"GB",tz:"Europe/London"},
  {match:/deutsche bank park|waldstadion/i,city:"Frankfurt",country:"DE",tz:"Europe/Berlin"},
  {match:/allianz arena/i,city:"Munich",country:"DE",tz:"Europe/Berlin"},
  {match:/olympiastadion berlin/i,city:"Berlin",country:"DE",tz:"Europe/Berlin"},
  {match:/santiago bernab[eé]u|metropolitano stadium/i,city:"Madrid",country:"ES",tz:"Europe/Madrid"},
  {match:/croke park/i,city:"Dublin",country:"IE",tz:"Europe/Dublin"},
  {match:/estadio azteca|estadio banorte/i,city:"Mexico City",country:"MX",tz:"America/Mexico_City"},
  {match:/neo qu[ií]mica arena|arena corinthians/i,city:"São Paulo",country:"BR",tz:"America/Sao_Paulo"},
  {match:/melbourne cricket ground/i,city:"Melbourne",country:"AU",tz:"Australia/Melbourne"},
];
const COUNTRIES = {UK:"GB",GB:"GB",ENGLAND:"GB",UNITEDKINGDOM:"GB",GERMANY:"DE",DE:"DE",SPAIN:"ES",ES:"ES",IRELAND:"IE",IE:"IE",MEXICO:"MX",MX:"MX",BRAZIL:"BR",BR:"BR",AUSTRALIA:"AU",AU:"AU"};
const CITIES = [
  {match:/^london$/i,city:"London",country:"GB",tz:"Europe/London"},
  {match:/^frankfurt$/i,city:"Frankfurt",country:"DE",tz:"Europe/Berlin"},
  {match:/^munich$/i,city:"Munich",country:"DE",tz:"Europe/Berlin"},
  {match:/^madrid$/i,city:"Madrid",country:"ES",tz:"Europe/Madrid"},
  {match:/^dublin$/i,city:"Dublin",country:"IE",tz:"Europe/Dublin"},
  {match:/^são paulo$|^sao paulo$/i,city:"São Paulo",country:"BR",tz:"America/Sao_Paulo"},
  {match:/^mexico city$/i,city:"Mexico City",country:"MX",tz:"America/Mexico_City"},
  {match:/^melbourne$/i,city:"Melbourne",country:"AU",tz:"Australia/Melbourne"},
];
const US = new Set(["US","USA","UNITEDSTATES","UNITEDSTATESOFAMERICA"]);
const clean = (x) => String(x || "").trim().replace(/[^A-Za-z]/g,"").toUpperCase();
function arrival(evidence,side,start,now){
  const x=evidence?.[side];
  const observed=Date.parse(x?.observedAt || "");
  const arrived=Date.parse(x?.arrivalAt || "");
  const kickoff=Date.parse(start || "");
  const check=Date.parse(now || "");
  if(!x?.source || !Number.isFinite(observed) || !Number.isFinite(arrived) ||
     !Number.isFinite(kickoff) || !Number.isFinite(check) ||
     observed > check || observed > kickoff || arrived > observed || arrived > kickoff) return null;
  return {arrivalAt:new Date(arrived).toISOString(),observedAt:new Date(observed).toISOString(),source:x.source,
    leadHours:Math.round((kickoff-arrived)/3600000*10)/10};
}
export function detectNflInternationalSite(game={}){
  if(String(game?.sport||"nfl").toLowerCase()!=="nfl") return null;
  const venue=String(game?.venue||game?.venueName||"");
  const city=String(game?.venueCity||"").trim();
  const countryCode=clean(game?.venueCountry || game?.venueAddress?.country);
  if(US.has(countryCode)) return null;
  const known=SITES.find(x=>x.match.test(venue));
  const cityMatch=CITIES.find(x=>x.match.test(city));
  const country=COUNTRIES[countryCode] || (countryCode.length===2 && !US.has(countryCode)?countryCode:null);
  const hit=known||cityMatch;
  if(!hit && !country) return null;
  if(hit && country && country!==hit.country) return null; // contradicting venue evidence
  return {city:hit?.city||city||null,country:hit?.country||country,
    timeZone:hit?.tz||null,venue:venue||null,
    source:known?"venue-name":country?"espn-venue-country":"venue-city"};
}
export function enrichNflInternationalGame(game={},asOf=new Date().toISOString()){
  const site=detectNflInternationalSite(game);
  if(!site) return game;
  const evidence=game?.nflInternationalTravelEvidence;
  const home=arrival(evidence,"home",game.start,asOf);
  const away=arrival(evidence,"away",game.start,asOf);
  const missing=["home","away"].filter(s=>!(s==="home"?home:away));
  return {...game,neutralSite:true,nflInternationalContext:{
    version:"NFL-INTERNATIONAL-CONTEXT-v1",international:true,site,
    homeDesignation:"schedule-only-not-home-field",homeArrival:home,awayArrival:away,
    missingTravelEvidence:missing,arrivalEvidenceComplete:missing.length===0,
    adjustmentPoints:null,adjustmentValidated:false,canQualify:false,canAuthorizeWager:false,
    modelInfluence:"none",observedAt:asOf,
  }};
}
export function attachNflInternationalContext(games=[],asOf=new Date().toISOString()){
  return (games||[]).map(g=>enrichNflInternationalGame(g,asOf));
}
