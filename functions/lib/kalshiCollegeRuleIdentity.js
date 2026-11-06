import {resolveTeamExact} from './teams.js';
const clean=x=>String(x||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const months={Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12'};
const team=n=>{const row=resolveTeamExact('cbb',{name:n});return row&&clean(n)!==clean(row.nickname)?row.id:null;};
const dateOf=start=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(start));
export function collegeRuleIdentity(m,fixtures,records){
 const parse=r=>String(r.rulesPrimary||'').match(/^If (.+) wins the (.+) vs (.+) men's college basketball game originally scheduled for ([A-Z][a-z]{2}) (\d{1,2}), (\d{4}), then the market resolves to Yes\.$/);
 const p=parse(m);if(!p||!months[p[4]]||clean(p[1])!==clean(m.yesLabel)||!m.eventTicker||!m.ticker?.startsWith(m.eventTicker+'-'))return null;
 const a=team(p[2]),b=team(p[3]),winner=team(m.yesLabel);if(!a||!b||a===b||![a,b].includes(winner))return null;
 const pair=records.filter(r=>r.eventTicker===m.eventTicker&&r.status==='active'&&r.sport==='cbb');
 if(pair.length!==2||new Set(pair.map(r=>r.ticker)).size!==2||new Set(pair.map(r=>team(r.yesLabel))).size!==2||!pair.every(r=>{const q=parse(r);return q&&q.slice(2).join('|')===p.slice(2).join('|')&&team(q[1])===team(r.yesLabel)&&[a,b].includes(team(r.yesLabel));}))return null;
 const day=p[6]+'-'+months[p[4]]+'-'+p[5].padStart(2,'0');
 const hits=fixtures.filter(g=>{const h=team(g.home_name),v=team(g.away_name);return dateOf(g.start)===day&&h&&v&&((h===a&&v===b)||(h===b&&v===a));});
 if(hits.length!==1)return null;return {fixture:hits[0],side:team(hits[0].home_name)===winner?'home':'away'};
}
