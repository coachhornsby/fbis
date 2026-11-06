// Explicit venue-label aliases; no ticker-only inference or expiration-as-tipoff.
const names={ATL:'Atlanta',BOS:'Boston',BKN:'Brooklyn',CHA:'Charlotte',CHI:'Chicago',CLE:'Cleveland',DAL:'Dallas',DEN:'Denver',DET:'Detroit',GS:'Golden State',GSW:'Golden State',HOU:'Houston',IND:'Indiana',LAC:'Los Angeles C',LAL:'Los Angeles L',MEM:'Memphis',MIA:'Miami',MIL:'Milwaukee',MIN:'Minnesota',NO:'New Orleans',NOP:'New Orleans',NY:'New York',NYK:'New York',OKC:'Oklahoma City',ORL:'Orlando',PHI:'Philadelphia',PHX:'Phoenix',POR:'Portland',SAC:'Sacramento',SA:'San Antonio',SAS:'San Antonio',TOR:'Toronto',UTAH:'Utah',UTA:'Utah',WSH:'Washington',WAS:'Washington'};
const clean=x=>String(x||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const months={Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12'};
const day=start=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(start));
export function nbaRuleIdentity(m,fixtures,records){
 const parse=r=>String(r.rulesPrimary||'').match(/^If (.+) wins the (.+) vs (.+) Pro Basketball game originally scheduled for ([A-Z][a-z]{2}) (\d{1,2}), (\d{4}), then the market resolves to Yes\.$/);
 const rule=parse(m);if(!rule||!months[rule[4]]||clean(rule[1])!==clean(m.yesLabel)||!m.eventTicker||!m.ticker?.startsWith(m.eventTicker+'-'))return null;
 const date=rule[6]+'-'+months[rule[4]]+'-'+rule[5].padStart(2,'0'),a=clean(rule[2]),b=clean(rule[3]);
 if(a===b)return null;
 const pair=records.filter(r=>r.eventTicker===m.eventTicker&&r.status==='active'&&r.sport==='nba').map(r=>({r,p:parse(r)}));
 if(pair.length!==2||new Set(pair.map(x=>x.r.ticker)).size!==2||!pair.every(x=>x.p&&x.p.slice(2).join('|')===rule.slice(2).join('|')&&clean(x.r.yesLabel)===clean(x.p[1]))||new Set(pair.map(x=>clean(x.r.yesLabel))).size!==2||![a,b].every(n=>pair.some(x=>clean(x.r.yesLabel)===n)))return null;
 const candidates=fixtures.filter(g=>{if(day(g.start)!==date)return false;const h=clean(names[g.home_abbr]),v=clean(names[g.away_abbr]);return h&&v&&h!==v&&((a===h&&b===v)||(a===v&&b===h));});
 if(candidates.length!==1)return null;const fixture=candidates[0];return {fixture,side:clean(m.yesLabel)===clean(names[fixture.home_abbr])?'home':'away'};
}
