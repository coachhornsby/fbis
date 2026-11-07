import {resolveTeamExact} from './teams.js';
const clean=x=>String(x||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const months={Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12'};
const series={nfl:'KXNFLGAME',cfb:'KXNCAAFGAME'};
// Research identity only: two published outcomes + rule date + independent fixture.
// Never substitute expiration for kickoff or infer teams from ticker abbreviations.
export function footballRuleIdentity(m,fixtures,records,{sport,now=Date.now()}={}){
 if(!series[sport]||!Array.isArray(fixtures)||fixtures.length>100||!Array.isArray(records)||records.length>4000)return null;
 const team=n=>{const r=resolveTeamExact(sport,{name:n});return r&&clean(n)!==clean(r.nickname)?String(r.id):null;};
 const parse=r=>String(r.rulesPrimary||'').match(/^If (.+) wins the (.+) vs (.+) (Pro Football|college football) game originally scheduled for ([A-Z][a-z]{2}) (\d{1,2}), (\d{4}), then the market resolves to Yes\.$/);
 const p=parse(m),kind=sport==='nfl'?'Pro Football':'college football';
 if(!p||p[4]!==kind||!months[p[5]]||clean(p[1])!==clean(m.yesLabel)||!m.eventTicker?.startsWith(series[sport]+'-'))return null;
 const a=team(p[2]),b=team(p[3]),winner=team(m.yesLabel);if(!a||!b||a===b||![a,b].includes(winner))return null;
 const pair=records.filter(r=>r.eventTicker===m.eventTicker);
 if(pair.length!==2||new Set(pair.map(r=>r.ticker)).size!==2||!pair.includes(m)||!pair.every(r=>{
  const q=parse(r),at=Date.parse(r.fetchedAt);
  return r.sport===sport&&r.seriesTicker===series[sport]&&r.status==='active'&&r.ticker?.startsWith(m.eventTicker+'-')&&Number.isFinite(at)&&at<=now&&now-at<=900000&&q&&q.slice(2).join('|')===p.slice(2).join('|')&&clean(q[1])===clean(r.yesLabel)&&[a,b].includes(team(r.yesLabel));
 })||new Set(pair.map(r=>team(r.yesLabel))).size!==2)return null;
 const date=p[7]+'-'+months[p[5]]+'-'+p[6].padStart(2,'0');
 const hits=fixtures.filter(g=>{const at=Date.parse(g.start);if(g.sport!==sport||!g.id||!Number.isFinite(at)||Math.abs(at-now)>72*3600000)return false;const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at));const h=team(g.home_name),v=team(g.away_name);return day===date&&h&&v&&h!==v&&((h===a&&v===b)||(h===b&&v===a));});
 if(hits.length!==1)return null;
 // occurrence_datetime describes occurrence/settlement, not scheduled kickoff.
 // https://docs.kalshi.com/openapi.yaml (Market.occurrence_datetime)
 // Only explicitly sourced kickoff fields can contradict fixture kickoff.
 if(pair.some(r=>['kickoffTime','verifiedGameStartTime'].some(k=>r[k]!=null&&(!Number.isFinite(Date.parse(r[k]))||Math.abs(Date.parse(r[k])-Date.parse(hits[0].start))>900000))))return null;
 return {fixture:hits[0],side:team(hits[0].home_name)===winner?'home':'away',identityBasis:'PAIRED_RULE_DATE_AND_CANONICAL_TEAMS',providerKickoffVerified:false,researchOnly:true,canAuthorizeWager:false};
}
