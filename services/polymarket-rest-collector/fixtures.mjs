import {beginJobExecution} from '../account-budget/jobScope.mjs';
import {archiveCollectedFixtures} from '../../functions/lib/polymarketFixtureArchive.js';
import {scoreboardGames,boardDate} from '../../functions/lib/publicBoardSnapshot.js';
export const FIXTURE_REFRESH_JOB='services/polymarket-rest-collector/fixtures.mjs';
const paths={nfl:'football/nfl',cfb:'football/college-football',cbb:'basketball/mens-college-basketball',nba:'basketball/nba',nhl:'hockey/nhl'};
export async function refreshExchangeFixtures(original,{sport,slot,now=Date.now(),fetchImpl=fetch}={}){
 if(!paths[sport])throw Error('UNSUPPORTED_EXCHANGE_FIXTURE_SCOPE');
 const path='/apis/site/v2/sports/'+paths[sport]+'/scoreboard';
 const env=await beginJobExecution(original,FIXTURE_REFRESH_JOB,{reservationId:'exchange-fixtures-'+sport+'-'+slot,fetchImpl,network:{origin:'https://site.api.espn.com',path}});
 const date=boardDate(new Date(now).toISOString());
 const response=await env.FBIS_JOB_FETCH('https://site.api.espn.com'+path+'?dates='+date.replaceAll('-','')+'&limit=499'+(sport==='cfb'?'&groups=80':sport==='cbb'?'&groups=50':''));
 if(!response.ok)throw Error('FIXTURE_SOURCE_HTTP_'+response.status);
 const payload=await response.json();
 const games=scoreboardGames(payload,{sport,date,capturedAt:new Date(now).toISOString()});
 // Bounded research coverage; never claim this subset covers a larger slate.
 const relevant=games.filter(g=>['scheduled','live'].includes(g.status)).sort((a,b)=>a.start.localeCompare(b.start));
 if(relevant.length>100)throw Error('EXCHANGE_FIXTURE_CAPACITY_EXCEEDED');
 return archiveCollectedFixtures(original,{sport,games:relevant,now});
}
