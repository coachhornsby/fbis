/**
 * Read-only presentation of executed game-market lines and recorded scores.
 * Never substitutes current market odds, projections, or inferred final scores.
 */
function usableScore(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : null;
}
function usableLine(value) {
  if (value === null || value === undefined || value === "") return null;
  const raw = String(value).trim();
  if (/^(?:PK|PICK(?:[' ]?EM)?)$/i.test(raw)) return "PK";
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isFinite(n) && Math.abs(n) <= 1000 ? raw : null;
}
function selectionText(bet) {
  return [bet?.selectedTeam,bet?.selectedSide].filter(v=>v!=null && v!=="").map(String);
}
function wageredLine(bet, type) {
  if (!type) return null;
  const candidates=selectionText(bet);
  const explicit=usableLine(bet.executionLine);
  if (type === "TOTAL") {
    let direction=null;
    let textLine=null;
    for (const text of candidates) {
      const match=text.match(/\b(OVER|UNDER)\s+(\d+(?:\.\d+)?)/i);
      if (match) {
        direction=match[1].toUpperCase();
        textLine=usableLine(match[2]);
        break;
      }
      const standalone=text.match(/^\s*(OVER|UNDER)\s*$/i);
      if (!direction && standalone) direction=standalone[1].toUpperCase();
    }
    const line=explicit && explicit!=="PK" ? explicit : textLine;
    if (line==null || Number(line)<0) return null;
    return {label:"Total",value:(direction ? direction+" " : "")+line};
  }
  const hasPk=candidates.some(text=>/(?:^|\s)(?:PK|PICK(?:[' ]?EM)?)(?:\s|$)/i.test(text));
  if (hasPk || explicit==="PK") return {label:"Spread",value:"PK"};
  let textLine=null;
  for (const text of candidates) {
    const match=text.trim().match(/(?:^|\s)([+-]?\d+(?:\.\d+)?)(?:\s*(?:points|pts))?$/i);
    if (match) { textLine=usableLine(match[1]); break; }
  }
  const line=explicit??textLine;
  if (line==null) return null;
  // Standard display: positive point spreads are marked with '+'.
  const value=Number(line)>0 && !String(line).startsWith("+") ? "+"+line : line;
  return {label:"Spread",value};
}
export function wagerMarketDetail(bet,{combo=false}={}) {
  const market=String(bet?.market||"").toUpperCase();
  const isProp=/PLAYER[_ ]?PROP|PLAYER STAT|PLAYER PERFORMANCE/.test(market);
  const hasSpread=/\bSPREAD\b/.test(market);
  const hasTotal=/\bTOTAL\b/.test(market);
  const type=!combo && !isProp && hasSpread!==hasTotal ? (hasSpread?"SPREAD":"TOTAL") : null;
  const isF5=/\bF5\b|FIRST[_ -]?FIVE/.test(String(bet?.period||"")+" "+market);
  const wager=!combo?wageredLine(bet,type):null;
  if (combo || isProp) return {wager:null,score:null,periodScore:null,actualTotal:null,period:null};
  const away=usableScore(bet?.finalAwayScore);
  const home=usableScore(bet?.finalHomeScore);
  const hasFinal=away!=null&&home!=null;
  const awayAbbr=String(bet?.awayIdentity?.abbr||bet?.awayTeam||"Away").trim();
  const homeAbbr=String(bet?.homeIdentity?.abbr||bet?.homeTeam||"Home").trim();
  const score=hasFinal ? awayAbbr+" "+away+" – "+homeAbbr+" "+home : null;
  const f5Away=usableScore(bet?.f5AwayScore);
  const f5Home=usableScore(bet?.f5HomeScore);
  const hasF5=f5Away!=null&&f5Home!=null;
  const periodScore=isF5 && hasF5 ? awayAbbr+" "+f5Away+" – "+homeAbbr+" "+f5Home : null;
  const actualTotal=type==="TOTAL"
    ? (isF5?(hasF5?f5Away+f5Home:null):(hasFinal?away+home:null))
    : null;
  return {
    wager,
    score,
    periodScore,
    actualTotal,
    period: isF5?"F5":"FG",
  };
}
