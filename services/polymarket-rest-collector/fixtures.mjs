import {beginJobExecution} from '../account-budget/jobScope.mjs';
import {archiveCollectedFixtures} from '../../functions/lib/polymarketFixtureArchive.js';
import {scoreboardGames,boardDate,shiftBoardDate} from '../../functions/lib/publicBoardSnapshot.js';
export const FIXTURE_REFRESH_JOB='services/polymarket-rest-collector/fixtures.mjs';
const paths={nfl:'football/nfl',cfb:'football/college-football',cbb:'basketball/mens-college-basketball',nba:'basketball/nba',nhl:'hockey/nhl'};
export async function refreshExchangeFixtures(original,{sport,slot,now=Date.now(),fetchImpl=fetch}={}){
 if(!paths[sport])throw Error('UNSUPPORTED_EXCHANGE_FIXTURE_SCOPE');
 const path='/apis/site/v2/sports/'+paths[sport]+'/scoreboard';
 const env=await beginJobExecution(original,FIXTURE_REFRESH_JOB,{reservationId:'exchange-fixtures-'+sport+'-'+slot,fetchImpl,network:{origin:'https://site.api.espn.com',path}});
 const date=boardDate(new Date(now).toISOString());
 // Football's next scheduled games may be several days away. Keep one
 // bounded request and the same response/fixture caps, but cover the existing
 // 72-hour market horizon rather than silently skipping empty weekdays.
 const dates=(sport==='nfl'||sport==='cfb')?[0,1,2,3].map(n=>shiftBoardDate(date,n)):[date];
 const range=dates.length>1?date.replaceAll('-','')+'-'+dates.at(-1).replaceAll('-',''):date.replaceAll('-','');
 const response=await env.FBIS_JOB_FETCH('https://site.api.espn.com'+path+'?dates='+range+'&limit=499'+(sport==='cfb'?'&groups=80':sport==='cbb'?'&groups=50':''));
 if(!response.ok)throw Error('FIXTURE_SOURCE_HTTP_'+response.status);
 const payload=await response.json();
 const games=dates.flatMap(day=>scoreboardGames(payload,{sport,date:day,capturedAt:new Date(now).toISOString()}));
 // Bounded research coverage; never claim this subset covers a larger slate.
 const relevant=games.filter(g=>['scheduled','live'].includes(g.status)&&Date.parse(g.start)<=now+72*3600000).sort((a,b)=>a.start.localeCompare(b.start));
 if(relevant.length>100)throw Error('EXCHANGE_FIXTURE_CAPACITY_EXCEEDED');
 return archiveCollectedFixtures(original,{sport,games:relevant,now});
}
