/**
 * Heritage soccer wagering universe.
 * Provider IDs are resolved dynamically by name/aliases; they are not hard-coded here.
 * Futures are tracked separately from match projection markets.
 */
export const HERITAGE_SOCCER_COMPETITIONS = Object.freeze([
  { key:"arg.copa", name:"Argentina Copa Argentina", country:"ARG", type:"cup", calendar:"calendar", aliases:["Copa Argentina"] },
  { key:"arg.1", name:"Argentina Liga Profesional", country:"ARG", type:"league", calendar:"calendar", aliases:["Liga Profesional","Liga Profesional de Fútbol","Argentine Primera División"] },
  { key:"bel.1", name:"Belgium Jupiler League", country:"BEL", type:"league", calendar:"fall-spring", aliases:["Jupiler Pro League","Belgian Pro League"] },
  { key:"bra.1", name:"Brazil Serie A", country:"BRA", type:"league", calendar:"calendar", aliases:["Brasileirão Série A","Serie A Brazil"] },
  { key:"conmebol.sudamericana", name:"CONMEBOL Copa Sudamericana", country:"INTL", type:"continental-cup", calendar:"calendar", aliases:["Copa Sudamericana"] },
  { key:"conmebol.libertadores", name:"Copa Libertadores", country:"INTL", type:"continental-cup", calendar:"calendar", aliases:["CONMEBOL Libertadores","Copa Libertadores"] },
  { key:"den.1", name:"Denmark Superligaen", country:"DEN", type:"league", calendar:"fall-spring", aliases:["Danish Superliga","Superliga"] },
  { key:"eng.2", name:"England Championship", country:"ENG", type:"league", calendar:"fall-spring", aliases:["Championship","EFL Championship"] },
  { key:"eng.league_cup", name:"England EFL Cup", country:"ENG", type:"cup", calendar:"fall-spring", aliases:["EFL Cup","League Cup","Carabao Cup"] },
  { key:"eng.fa_cup", name:"England FA Cup", country:"ENG", type:"cup", calendar:"fall-spring", aliases:["FA Cup"] },
  { key:"eng.1", name:"England Premier League", country:"ENG", type:"league", calendar:"fall-spring", aliases:["Premier League"] },
  { key:"fra.1", name:"France Ligue 1", country:"FRA", type:"league", calendar:"fall-spring", aliases:["Ligue 1"] },
  { key:"ger.1", name:"Germany Bundesliga", country:"GER", type:"league", calendar:"fall-spring", aliases:["Bundesliga"] },
  { key:"ger.pokal", name:"Germany DFB Pokal", country:"GER", type:"cup", calendar:"fall-spring", aliases:["DFB Pokal","DFB-Pokal"] },
  { key:"intl.club_friendly", name:"International Club Friendlies Soccer", country:"INTL", type:"friendly", calendar:"mixed", aliases:["Club Friendly","Club Friendlies"] },
  { key:"intl.friendly", name:"International Friendlies National Teams", country:"INTL", type:"international-friendly", calendar:"mixed", aliases:["International Friendly","Friendlies"] },
  { key:"uefa.conference", name:"International UEFA Conference League", country:"INTL", type:"continental-cup", calendar:"fall-spring", aliases:["UEFA Conference League","Conference League"] },
  { key:"uefa.nations", name:"International UEFA Nations League", country:"INTL", type:"international-cup", calendar:"cycle", aliases:["UEFA Nations League","Nations League"] },
  { key:"ita.1", name:"Italy Serie A", country:"ITA", type:"league", calendar:"fall-spring", aliases:["Serie A"] },
  { key:"usa.1", name:"Major League Soccer", country:"USA", type:"league", calendar:"calendar", aliases:["MLS","Major League Soccer"] },
  { key:"mex.1", name:"Mexico Liga MX", country:"MEX", type:"league", calendar:"split", aliases:["Liga MX"] },
  { key:"ned.1", name:"Netherlands Eredivisie", country:"NED", type:"league", calendar:"fall-spring", aliases:["Eredivisie"] },
  { key:"por.1", name:"Portugal Primeira Liga", country:"POR", type:"league", calendar:"fall-spring", aliases:["Primeira Liga","Liga Portugal"] },
  { key:"sco.1", name:"Scotland Premiership", country:"SCO", type:"league", calendar:"fall-spring", aliases:["Scottish Premiership","Premiership"] },
  { key:"esp.1", name:"Spain La Liga", country:"ESP", type:"league", calendar:"fall-spring", aliases:["LaLiga","La Liga"] },
  { key:"tur.1", name:"Turkey Super Lig", country:"TUR", type:"league", calendar:"fall-spring", aliases:["Süper Lig","Super Lig"] },
  { key:"uefa.champions", name:"UEFA Champions League", country:"INTL", type:"continental-cup", calendar:"fall-spring", aliases:["Champions League","UEFA Champions League"] },
  { key:"uefa.europa", name:"UEFA Europa League", country:"INTL", type:"continental-cup", calendar:"fall-spring", aliases:["Europa League","UEFA Europa League"] },
  { key:"usa.usl_championship", name:"United States USL Championship", country:"USA", type:"league", calendar:"calendar", aliases:["USL Championship"] },
]);

export const HERITAGE_SOCCER_FUTURES = Object.freeze([
 "Belgium Jupiler League Futures","Brazil Serie A Futures","Denmark Superligaen Futures","England Championship Futures",
 "England FA Cup Futures","England Premier League Futures","Euro 2028 Futures","France Ligue 1 Futures","Germany Bundesliga Futures",
 "Germany DFB Pokal Futures","International Copa Libertadores Futures","International Copa Sudamericana Futures",
 "International FIFA World Cup Futures","International UEFA Europa League Futures","International UEFA Nations League Futures",
 "Italy Serie A Futures","Mexico Liga MX 2026 Futures","Scotland Premiership Futures","Spain La Liga Futures",
 "UEFA Champions League Futures","UEFA Conference League Futures","United States MLS Futures"
]);

export const SOCCER_COMPETITION_POLICY = Object.freeze({
  league: { matchModel:true, crossCompetitionPrior:false, uncertaintyFloor:"LOW" },
  cup: { matchModel:true, crossCompetitionPrior:true, uncertaintyFloor:"MEDIUM" },
  "continental-cup": { matchModel:true, crossCompetitionPrior:true, uncertaintyFloor:"MEDIUM" },
  "international-cup": { matchModel:true, crossCompetitionPrior:true, uncertaintyFloor:"MEDIUM" },
  friendly: { matchModel:true, crossCompetitionPrior:true, uncertaintyFloor:"HIGH", starCap:2 },
  "international-friendly": { matchModel:true, crossCompetitionPrior:true, uncertaintyFloor:"HIGH", starCap:2 },
});

export function heritageSoccerCompetition(keyOrName){
  const q=String(keyOrName||"").toLowerCase().trim();
  return HERITAGE_SOCCER_COMPETITIONS.find(c=>c.key.toLowerCase()===q||c.name.toLowerCase()===q||c.aliases.some(a=>a.toLowerCase()===q))||null;
}

export function isHeritageSoccerMatchCompetition(v){return Boolean(heritageSoccerCompetition(v));}
