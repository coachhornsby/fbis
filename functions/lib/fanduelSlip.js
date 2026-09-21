import { hashText, money, americanPrice, pointLine } from "./heritageSlip.js";

function clean(text){return String(text||"").replace(/\r/g,"").replace(/[•·]/g," ").replace(/\u00a0/g," ").trim();}
function ctDate(){return new Intl.DateTimeFormat("en-CA",{timeZone:"America/Chicago",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());}
function amount(re,text){const m=text.match(re);return m?money(m[1]):null;}
function priceFromProfit(risk,toWin){
  if(!(risk>0)||!(toWin>0)) return null;
  return Math.round(toWin>=risk ? (toWin/risk)*100 : -(risk/toWin)*100);
}
function parseDate(s){
  const m=s.match(/(?:placed|accepted|wagered)?\s*(?:on)?\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})/i);
  if(!m) return ctDate();
  const y=Number(m[3])<100?2000+Number(m[3]):Number(m[3]);
  return `${y}-${String(m[1]).padStart(2,"0")}-${String(m[2]).padStart(2,"0")}`;
}
function ticketId(s){return (s.match(/(?:bet|wager|ticket)\s*(?:id|#|number)?\s*[:#]?\s*([A-Z0-9-]{6,})/i)||[])[1]||null;}
function matchup(s){
  const m=s.match(/([A-Za-z0-9 .&'-]{2,40})\s+(?:@|at|vs\.?|v\.)\s+([A-Za-z0-9 .&'-]{2,40})/i);
  return m?{away:m[1].trim(),home:m[2].trim()}: {away:null,home:null};
}
function marketOf(s){
  if(/same game parlay|\bsgp\b|parlay/i.test(s)) return "PARLAY";
  if(/total|over\s*\d|under\s*\d/i.test(s)) return "TOTAL";
  if(/spread|run line|puck line|[+-]\d+(?:\.5)?\b/.test(s)) return "SPREAD";
  if(/moneyline|money line|\bml\b/i.test(s)) return "ML";
  return null;
}
function selectionOf(s,market){
  if(market==="TOTAL"){
    const m=s.match(/\b(over|under)\s*([0-9]+(?:\.[0-9]+)?)/i);
    return {selectedSide:m?.[1]?.toUpperCase()||null,selectedTeam:null,executionLine:m?pointLine(m[2]):null};
  }
  if(market==="SPREAD"){
    const m=s.match(/([A-Za-z][A-Za-z0-9 .&'-]{1,40}?)\s+([+-]\d+(?:\.\d+)?)/);
    return {selectedSide:null,selectedTeam:m?.[1]?.trim()||null,executionLine:m?pointLine(m[2]):null};
  }
  const m=s.match(/(?:moneyline|money line|\bml\b)\s*[-:]?\s*([A-Za-z][A-Za-z0-9 .&'-]{1,40})/i);
  return {selectedSide:null,selectedTeam:m?.[1]?.trim()||null,executionLine:null};
}
function legsOf(s){
  const lines=s.split(/\n+/).map(x=>x.trim()).filter(Boolean);
  return lines.filter(x=>/\b(over|under|moneyline|money line|spread|[+-]\d+(?:\.5)?\b)/i.test(x))
    .slice(0,20).map((raw,index)=>({legIndex:index+1,raw}));
}

export async function parseFanDuelSlip(text,{dateHint}={}){
  const s=clean(text); const date=dateHint||parseDate(s); const risk=amount(/(?:wager|stake|risk|bet amount)\s*\$?([0-9,.]+)/i,s);
  let payout=amount(/(?:potential payout|payout|return)\s*\$?([0-9,.]+)/i,s);
  let toWin=amount(/(?:to win|profit)\s*\$?([0-9,.]+)/i,s);
  if(toWin==null&&risk!=null&&payout!=null) toWin=Math.round((payout-risk)*100)/100;
  if(payout==null&&risk!=null&&toWin!=null) payout=Math.round((risk+toWin)*100)/100;
  const explicitPrice=(s.match(/(?:odds|price)\s*[:]?\s*([+-]\d{3,5})/i)||[])[1];
  const market=marketOf(s); const teams=matchup(s); const sel=selectionOf(s,market);
  const legs=market==="PARLAY"?legsOf(s):[];
  const digest=await hashText(`fanduel|${date}|${s}`);
  const id=ticketId(s)||`FD-${digest.slice(0,16).toUpperCase()}`;
  const price=americanPrice(explicitPrice)||priceFromProfit(risk,toWin);
  const warnings=[];
  if(!risk) warnings.push("missing wager amount");
  if(!market) warnings.push("market needs review");
  if(!ticketId(s)) warnings.push("FanDuel ticket ID not visible; content fingerprint used for duplicate protection");
  const ticket={
    externalTicketId:id,executionBook:"FanDuel",executedAt:null,timezone:"America/Chicago",date,sport:null,
    matchupText:teams.away&&teams.home?`${teams.away} @ ${teams.home}`:null,awayTeam:teams.away,homeTeam:teams.home,
    market:market||"UNCLASSIFIED",period:"FULL_GAME",...sel,executionPrice:price,riskAmount:risk,toWinAmount:toWin,
    potentialPayout:payout,currency:"USD",warnings,rawText:s,parseOk:Boolean(risk&&market),
    trackerMetadata:{importMethod:"universal-slip",legs,contentFingerprint:digest,calibrationEligibility:"PENDING - REQUIRES IMMUTABLE MODEL MATCH"}
  };
  return {tickets:[ticket],n:1,totalRisk:risk,totalToWin:toWin,entryType:market==="PARLAY"?"PARLAY":"STRAIGHT"};
}
