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
function sportOf(s){
  if(/NFL|touchdown|passing yards|receiving yards|rushing yards/i.test(s)) return "nfl";
  if(/MLB|strikeouts|innings|runs\b/i.test(s)) return "mlb";
  if(/NBA|points\s*\+\s*rebounds|rebounds|assists/i.test(s)) return "nba";
  if(/NHL|shots on goal|puck line/i.test(s)) return "nhl";
  if(/NCAAF|college football/i.test(s)) return "cfb";
  if(/NCAAB|college basketball/i.test(s)) return "cbb";
  if(/WNBA/i.test(s)) return "wnba";
  if(/soccer|premier league|mls|serie a|la liga/i.test(s)) return "soccer";
  if(/tennis|sets|games won/i.test(s)) return "tennis";
  return "unknown";
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
    .filter(x=>!/odds|price|potential payout|wager|stake|risk/i.test(x))
    .slice(0,20).map((raw,index)=>{
      const prop=raw.match(/^(.+?)\s+(over|under)\s*([0-9]+(?:\.[0-9]+)?)\s+(.+)$/i);
      if(prop) return {legIndex:index+1,raw,market:"PLAYER_PROP",playerName:prop[1].trim(),selectedTeam:prop[1].trim(),selectedSide:prop[2].toUpperCase(),executionLine:Number(prop[3]),propType:prop[4].trim().toUpperCase().replace(/[^A-Z0-9]+/g,"_")};
      const total=raw.match(/\b(over|under)\s*([0-9]+(?:\.[0-9]+)?)/i);
      if(total) return {legIndex:index+1,raw,market:"TOTAL",selectedSide:total[1].toUpperCase(),executionLine:Number(total[2])};
      const spread=raw.match(/^(.+?)\s+([+-]\d+(?:\.\d+)?)/);
      if(spread) return {legIndex:index+1,raw,market:"SPREAD",selectedTeam:spread[1].trim(),executionLine:Number(spread[2])};
      if(/moneyline|money line|\bml\b/i.test(raw)) return {legIndex:index+1,raw,market:"ML",selectedTeam:raw.replace(/moneyline|money line|\bml\b/ig,"").trim()};
      return {legIndex:index+1,raw,market:"UNCLASSIFIED"};
    });
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
  const common={executionBook:"FanDuel",executedAt:null,timezone:"America/Chicago",date,sport:sportOf(s),
    matchupText:teams.away&&teams.home?`${teams.away} @ ${teams.home}`:null,awayTeam:teams.away,homeTeam:teams.home,
    period:"FULL_GAME",currency:"USD",rawText:s,entryId:id};
  const tickets=market==="PARLAY" && legs.length ? legs.map((leg,index)=>({
    ...common,externalTicketId:`${id}-L${index+1}`,market:leg.market,selectedSide:leg.selectedSide||null,
    selectedTeam:leg.selectedTeam||null,playerName:leg.playerName||null,propType:leg.propType||null,
    executionLine:leg.executionLine??null,executionPrice:index===0?price:null,riskAmount:index===0?risk:0,
    toWinAmount:index===0?toWin:0,potentialPayout:index===0?payout:null,legIndex:index+1,legCount:legs.length,
    warnings:[...warnings,`FanDuel parlay leg ${index+1}/${legs.length}: ${leg.raw}`],
    trackerMetadata:{importMethod:"universal-slip",entryId:id,entryType:"PARLAY",legIndex:index+1,legCount:legs.length,
      cardRiskAmount:risk,cardToWinAmount:toWin,cardPotentialPayout:payout,economicsOwner:index===0,
      contentFingerprint:digest,rawLeg:leg.raw,calibrationEligibility:"PENDING - REQUIRES IMMUTABLE MODEL MATCH"}
  })):[{...common,externalTicketId:id,market:market||"UNCLASSIFIED",...sel,executionPrice:price,riskAmount:risk,toWinAmount:toWin,
    potentialPayout:payout,warnings,parseOk:Boolean(risk&&market),
    trackerMetadata:{importMethod:"universal-slip",entryId:id,entryType:"STRAIGHT",legIndex:1,legCount:1,
      cardRiskAmount:risk,cardToWinAmount:toWin,cardPotentialPayout:payout,economicsOwner:true,
      contentFingerprint:digest,calibrationEligibility:"PENDING - REQUIRES IMMUTABLE MODEL MATCH"}}];
  return {tickets,n:tickets.length,totalRisk:risk,totalToWin:toWin,entryType:market==="PARLAY"?"PARLAY":"STRAIGHT",entryId:id};
}
