// Presentation-only parser for the executed-wager journal.
// Do not infer missing legs, settle markets, or convert these labels into prices.
const COMBO_MARKER = /\b(?:COMBO|PARLAY|SAME[\s-]?GAME[\s-]?(?:PARLAY|COMBO)|SGP|\d+[\s-]?(?:LEG|MARKET)[\s-]+COMBO)\b/i;
const SEPARATOR = /\s+AND\s+|\s+&\s+|\s*;\s*|\s*\n+\s*/i;
const STAT_NAME = /^(?:TD|TDS|TOUCHDOWNS?|PASSING YARDS?|RUSHING YARDS?|RECEIVING YARDS?|PASS YARDS?|RUSH YARDS?|REC YARDS?|STRIKEOUTS?|KS|POINTS?|REBOUNDS?|ASSISTS?|SHOTS?(?: ON GOAL)?|SAVES?|HITS?|BASES?|TOTAL BASES?|THREES?|3-POINTERS?|3PM|GOALS?|RECEPTIONS?|CATCHES?|HOME RUNS?|HR|PITCHING OUTS?|STEALS?|BLOCKS?)$/i;

export function parseComboLeg(value) {
  const text=String(value || "").trim().replace(/\s+/g," ");
  const match=text.match(/^(.+?)\s+((?:OVER|UNDER)\s+)?(\d+(?:\.\d+)?\+?)\s+(.+)$/i);
  if (match && STAT_NAME.test(match[4].trim())) {
    return {text, player:match[1].trim(),selection:((match[2] || "")+match[3]+" "+match[4]).trim()};
  }
  return {text,player:null,selection:null};
}

export function parseComboTicket(bet) {
  if (!bet || typeof bet!=="object") return null;
  const candidates=[bet.selectedSide,bet.selectedTeam,bet.matchupText]
    .map(value=>String(value || "").trim()).filter(Boolean);
  const market=String(bet.market || "");
  if (![market,...candidates].some(value=>COMBO_MARKER.test(value))) return null;

  // Prefer explicit multi-leg descriptions over short tracker selection labels.
  const ranked=[...candidates].sort((a,b)=>{
    const score=v=>(COMBO_MARKER.test(v)?4:0)+(SEPARATOR.test(v)?10:0)+(v.match(/\s+AND\s+/gi)||[]).length*4+Math.min(v.length/100,2);
    return score(b)-score(a);
  });
  let description=ranked[0] || market || "Combo";
  description=description
    .replace(/^\s*(?:(?:\d+)[\s-]?(?:leg|market)\s+)?(?:same[\s-]?game\s+)?(?:combo|parlay|sgp)\s*(?:—|–|-|:)\s*/i,"")
    .trim();
  const parts=description.split(SEPARATOR).map(s=>s.trim()).filter(Boolean);
  const legs=parts.map(parseComboLeg);
  const isStructured=legs.length>1;
  const expected=String([market,...candidates].join(" ")).match(/\b(\d+)[\s-]?(?:LEG|MARKET)\s+COMBO\b/i);
  const advertisedCount=expected?Number(expected[1]):null;
  // "3-leg" is only used if all three actual selections are in the record.
  const title=isStructured?legs.length+"-LEG COMBO":"COMBO";
  return {title,legs,structured:isStructured,advertisedCount,description};
}
