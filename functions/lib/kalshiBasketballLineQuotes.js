import {resolveTeamExact} from './teams.js';
import {nbaCityForAbbr} from './kalshiNbaRuleIdentity.js';
const FAMILY={nba_spread:'spread',nba_total:'total',nba_team_total:'team_total',
 cbb_spread:'spread',cbb_total:'total',cbb_team_total:'team_total'};
const SERIES={nba_spread:'KXNBASPREAD',nba_total:'KXNBATOTAL',
 nba_team_total:'KXNBATEAMTOTAL',cbb_spread:'KXNCAAMBSPREAD',
 cbb_total:'KXNCAAMBTOTAL',cbb_team_total:'KXNCAAMBTEAMTOTAL'};
const MONTHS={Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12'};
const clean=x=>String(x||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const validPrice=x=>typeof x==='number'&&Number.isFinite(x)&&x>0&&x<1;
const localDay=value=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
const sourceTeam=(sport,name)=>sport==='nba'?clean(name):(()=>{const t=resolveTeamExact('cbb',{name});return t?.id!=null?String(t.id):null;})();
const fixtureTeam=(g,sport,side)=>sport==='nba'?clean(nbaCityForAbbr(g[side+'_abbr'])):sourceTeam(sport,g[side+'_name']);

/** Parse only source-authored, full-game settlement rules. */
export function kalshiBasketballLineRule(m,sourceSport){
 const sport=sourceSport?.startsWith('nba_')?'nba':sourceSport?.startsWith('cbb_')?'cbb':null;
 const family=FAMILY[sourceSport];
 if(!sport||!family||typeof m?.rulesPrimary!=='string')return null;
 let parts,who=null,line,away,home,kind,month,day,year;
 if(family==='spread'){
  parts=m.rulesPrimary.match(/^If (.+?) wins by more than (\d+(?:\.\d+)?) points in the (.+?) vs (.+?) (Pro Basketball|men's college basketball) game originally scheduled for ([A-Z][a-z]{2}) (\d{1,2}), (\d{4}), then the market resolves to Yes\.$/);
  if(parts){who=parts[1];line=Number(parts[2]);away=parts[3];home=parts[4];kind=parts[5];month=parts[6];day=parts[7];year=parts[8];}
 }else if(family==='total'){
  parts=m.rulesPrimary.match(/^If over (\d+(?:\.\d+)?) total points are scored in the (.+?) vs (.+?) (Pro Basketball|men's college basketball) game originally scheduled for ([A-Z][a-z]{2}) (\d{1,2}), (\d{4}), then the market resolves to Yes\.$/);
  if(parts){line=Number(parts[1]);away=parts[2];home=parts[3];kind=parts[4];month=parts[5];day=parts[6];year=parts[7];}
 }else{
  parts=m.rulesPrimary.match(/^If (.+?) scores more than (\d+(?:\.\d+)?) points in the (.+?) vs (.+?) (Pro Basketball|men's college basketball) game originally scheduled for ([A-Z][a-z]{2}) (\d{1,2}), (\d{4}), then the market resolves to Yes\.$/);
  if(parts){who=parts[1];line=Number(parts[2]);away=parts[3];home=parts[4];kind=parts[5];month=parts[6];day=parts[7];year=parts[8];}
 }
 if(!parts||kind!==(sport==='nba'?'Pro Basketball':"men's college basketball")||
  !MONTHS[month]||!Number.isFinite(line)||line<=0||line>500||
  Math.round(line*2)%2===0||Math.abs(Math.round(line*2)-line*2)>1e-8||
  !away||!home||clean(away)===clean(home))return null;
 const a=sourceTeam(sport,away),h=sourceTeam(sport,home),scorer=who?sourceTeam(sport,who):null;
 if(!a||!h||a===h||(who&&scorer!==a&&scorer!==h))return null;
 return {sport,family,line,scoringTeam:scorer,opponents:[a,h],
  date:year+'-'+MONTHS[month]+'-'+day.padStart(2,'0')};
}
/** Quote is reference-only and never establishes executable price or EV. */
export function matchedKalshiBasketballLineQuotes(fixtures,snapshot,{sourceSport,now=Date.now()}={}){
 const result={},family=FAMILY[sourceSport],series=SERIES[sourceSport],
  sport=sourceSport?.split('_')[0],captured=Date.parse(snapshot?.capturedAt||'');
 if(!family||snapshot?.ok!==true||snapshot.sport!==sourceSport||
  snapshot.seriesTicker!==series||!Array.isArray(snapshot.records)||
  snapshot.records.length>4000||!Number.isFinite(captured)||
  captured>now||now-captured>1800000)return result;
 for(const m of snapshot.records){
  if(m?.sport!==sourceSport||m.seriesTicker!==series||m.status!=='active'||
   !m.eventTicker?.startsWith(series+'-')||!m.ticker?.startsWith(m.eventTicker+'-'))continue;
  const fetched=Date.parse(m.fetchedAt||'');
  if(!Number.isFinite(fetched)||fetched>now||now-fetched>900000)continue;
  const rule=kalshiBasketballLineRule(m,sourceSport);
  if(!rule)continue;
  const matches=fixtures.filter(g=>{
   if(!Number.isFinite(Date.parse(g.start||''))||localDay(g.start)!==rule.date)return false;
   const a=fixtureTeam(g,sport,'away'),h=fixtureTeam(g,sport,'home');
   return a&&h&&a!==h&&
    ((a===rule.opponents[0]&&h===rule.opponents[1])||
     (a===rule.opponents[1]&&h===rule.opponents[0]));
  });
  if(matches.length!==1)continue;
  const g=matches[0],scoring=rule.scoringTeam==null?null:
    fixtureTeam(g,sport,'home')===rule.scoringTeam?'home':'away';
  const items=[];
  const push=(side,line,ask)=>{
   if(!validPrice(ask))return;
   items.push({venue:'Kalshi',marketFamily:family,side,line,ask,
    receivedAt:m.fetchedAt,eventStart:g.start,transport:'REST',
    marketId:m.ticker,sourceSeries:series,referenceOnly:true,canAuthorizeWager:false});
  };
  if(family==='spread'){
   if(!scoring)continue;
   push(scoring,-rule.line,m.yesAskDollars);
   push(scoring==='home'?'away':'home',rule.line,m.noAskDollars);
  }else if(family==='total'){
   push('over',rule.line,m.yesAskDollars);
   push('under',rule.line,m.noAskDollars);
  }else if(scoring){
   push(scoring+'_over',rule.line,m.yesAskDollars);
   push(scoring+'_under',rule.line,m.noAskDollars);
  }
  if(items.length)(result[g.id]??=[]).push(...items);
 }
 return result;
}
