/** Read-only availability and format probe for publicly published 2026 TML CSVs.
 * No D1/R2 writes, no API key, no unsupported scraping, no result settlement.
 */
import {parseTennisCsv,selectCurrentTennisRows} from '../functions/lib/tennisFreeCurrentResearch.js';
const now=new Date(),year=now.getUTCFullYear();
const receipts=[];
for(const tour of ['atp','wta']){
 const filename=year+(tour==='wta'?'_wta':'')+'.csv';
 const url='https://stats.tennismylife.org/data/'+filename;
 const r=await fetch(url,{headers:{accept:'text/csv','user-agent':'FBIS-Tennis-Private-Research/1.0'},
  signal:AbortSignal.timeout(30000)});
 if(!r.ok)throw Error('SOURCE_HTTP_'+tour+'_'+r.status);
 const body=await r.text();
 if(body.length<1000||body.length>6000000)throw Error('SOURCE_SIZE_INVALID_'+tour);
 const rows=parseTennisCsv(body);
 if(rows.length<100)throw Error('SOURCE_TOO_FEW_MATCHES_'+tour);
 const recent=selectCurrentTennisRows(rows,{tour,now});
 if(recent.seen<1||recent.matches.length<1)throw Error('SOURCE_NO_RECENT_VALID_STATS_'+tour);
 const newest=rows.map(x=>String(x.tourney_date||'')).filter(x=>/^\d{8}$/.test(x)).sort().at(-1);
 receipts.push({tour,url,sourceRows:rows.length,currentWindow:recent.seen,
  validCurrentStats:recent.matches.length,latestSourceDateLabel:newest,
  sourceDateIsExactMatchTime:false});
 const ongoingFile=tour==='atp'?'ongoing_tourneys.csv':'wta_ongoing_tourneys.csv';
 const ongoingUrl='https://stats.tennismylife.org/data/'+ongoingFile;
 try{
  const live=await fetch(ongoingUrl,{headers:{accept:'text/csv'},
    signal:AbortSignal.timeout(25000)});
  if(!live.ok)throw Error('HTTP_'+live.status);
  const ongoingText=await live.text();
  const ongoingRows=parseTennisCsv(ongoingText);
  const ongoingValid=selectCurrentTennisRows(ongoingRows,{tour,now});
  const latest=ongoingRows.map(x=>String(x.tourney_date||''))
    .filter(x=>/^\d{8}$/.test(x)).sort().at(-1)||null;
  receipts.at(-1).ongoing={url:ongoingUrl,rows:ongoingRows.length,
    statsValidated:ongoingValid.matches.length,latestSourceDateLabel:latest,
    sameSchema:true};
 }catch(e){
  receipts.at(-1).ongoing={url:ongoingUrl,
   available:false,reason:String(e.message||'SOURCE_UNAVAILABLE')};
 }
}
process.stdout.write(JSON.stringify({ok:true,at:new Date().toISOString(),receipts},null,2)+'\n');
