import {cbbTorvikRatingsV1} from '../../functions/lib/cbbRatings.js';
// Direct current-season bulk inputs. Default off; caller must explicitly admit
// both requests into its source budget. No retries, redirects or fallback hosts.
import {createHash} from 'node:crypto';
import {normalizeTorvikTeamRows,parseCsvLine,indexTorvikRows,lookupTorvikRating} from '../../functions/lib/torvikCbb.js';
export function torvikRecoveryUrls(season){
 if(!Number.isInteger(season)||season<2020||season>2100)throw Error('TORVIK_INVALID_ENDING_SEASON');
 return [`https://barttorvik.com/${season}_team_results.csv`,`https://barttorvik.com/${season}_fffinal.csv`];
}
export function parseRecoveryFactors(raw){
 const lines=raw.trim().split(/\r?\n/),key=s=>s.toLowerCase().replace(/[^a-z0-9]/g,'');
 const expected=['TeamName','eFG%','Rk','eFG% Def','Rk','FTR','Rk','FTR Def','Rk','OR%','Rk','DR%','Rk','TO%','Rk','TO% Def.','Rk','3P%','Rk','3pD%','Rk','2p%','Rk','2p%D','Rk'].map(key);
 const header=parseCsvLine(lines[0]).map(key);
 if(JSON.stringify(header)!==JSON.stringify(expected))throw Error('TORVIK_FACTOR_SCHEMA_UNVERIFIED');
 const fields=['efgPct','efgPctD','ftr','ftrD','orbRate','drbRate','tovRate','tovRateD','threePtPct','threePtPctD','twoPtPct','twoPtPctD'];
 return lines.slice(1).map(line=>{const c=parseCsvLine(line);if(c.length!==25||!c[0].trim())throw Error('TORVIK_FACTOR_SCHEMA_UNVERIFIED');
  const row={team:c[0].trim()};for(let j=0;j<fields.length;j++){
   const raw=c[1+j*2].trim(),n=Number(raw),rank=Number(c[2+j*2]);
   if(!raw||!Number.isFinite(n)||n<0||n>(fields[j].startsWith('ftr')?200:100)||!Number.isInteger(rank)||rank<1||rank>400)throw Error('TORVIK_FACTOR_SCALE_INVALID');
   row[fields[j]]=n/100; // This specific bulk schema reports percentage points.
  }return row;});
}
async function readCsv(url,{fetchFn,reserve,now}){
 reserve('Torvik');
 const r=await fetchFn(url,{redirect:'manual',headers:{Accept:'text/csv,text/plain'},signal:AbortSignal.timeout(18000)});
 if(r.status>=300&&r.status<400)throw Error('TORVIK_REDIRECT_BLOCKED');
 if(!r.ok)throw Error(`TORVIK_HTTP_${r.status}`);
 if(r.redirected||(r.url&&r.url!==url))throw Error('TORVIK_UNEXPECTED_URL');
 const type=(r.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
 if(!['text/csv','text/plain','application/csv','application/octet-stream'].includes(type))throw Error('TORVIK_NOT_CSV');
 const max=2*1024*1024;if(Number(r.headers.get('content-length')||0)>max)throw Error('TORVIK_TOO_LARGE');
 if(!r.body?.getReader)throw Error('TORVIK_STREAM_REQUIRED');
 const reader=r.body.getReader(),chunks=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max)throw Error('TORVIK_TOO_LARGE');chunks.push(value);}}finally{await reader.cancel();}
 const bytes=Buffer.concat(chunks),raw=bytes.toString('utf8');
 if(/^\s*(?:<!doctype|<html|<head|<body)/i.test(raw))throw Error('TORVIK_HTML');
 return {raw,receipt:{url,httpStatus:r.status,bytes:size,sha256:createHash('sha256').update(bytes).digest('hex'),retrievedAt:new Date(now()).toISOString(),providerUpdatedAt:null}};
}
export async function captureTorvikRecovery({admitted=false,season=2027,fetchFn=fetch,reserve,now=Date.now}={}){
 if(!admitted)return {ok:false,state:'NOT_ADMITTED',requests:0};
 if(typeof reserve!=='function')throw Error('TORVIK_SOURCE_BUDGET_REQUIRED');
 const urls=torvikRecoveryUrls(season),receipts=[];
 try{
  const ratings=await readCsv(urls[0],{fetchFn,reserve,now});receipts.push(ratings.receipt);
  const rows=normalizeTorvikTeamRows(ratings.raw),names=new Set(rows.map(r=>r.team));
  if(rows.length<330||rows.length>400||names.size!==rows.length)throw Error('TORVIK_RATINGS_COVERAGE_INVALID');
  if(rows.some(r=>![r.adjOe,r.adjDe,r.tempo].every(Number.isFinite)||r.adjOe<60||r.adjOe>150||r.adjDe<60||r.adjDe>150||r.tempo<40||r.tempo>110))throw Error('TORVIK_RATINGS_SCALE_INVALID');
  const index=indexTorvikRows(rows,season-1);
  if(index.matched!==rows.length||Object.keys(index.byCanonicalId).length!==rows.length)throw Error('TORVIK_IDENTITY_INCOMPLETE');
  const factors=await readCsv(urls[1],{fetchFn,reserve,now});receipts.push(factors.receipt);
  const four=parseRecoveryFactors(factors.raw),byName=new Map(four.map(r=>[r.team,r]));
  if(four.length!==rows.length||byName.size!==four.length||rows.some(r=>!byName.has(r.team)))throw Error('TORVIK_FACTOR_COVERAGE_INVALID');
  for(const row of four)for(const [key,value] of Object.entries(row))if(key!=='team'&&(!Number.isFinite(value)||value<0||value>2))throw Error('TORVIK_FACTOR_SCALE_INVALID');
  const merged=rows.map(r=>({...r,...byName.get(r.team)}));
  return {ok:true,state:'PRIVATE_RESEARCH_INPUT',season,rows:merged,index:indexTorvikRows(merged,season-1),receipts,providerUpdatedAt:null,canQualify:false,canAuthorizeWager:false};
 }catch(e){return {ok:false,state:'UNAVAILABLE',error:String(e.message||e),receipts,canAuthorizeWager:false};}
}

export function torvikRecoveryComparison(g,capture,{now=Date.now()}={}){
 if(!Number.isFinite(now)||now>=Date.parse(g.start)||!capture?.ok||capture.receipts?.length!==2||g.status!=='scheduled'||typeof g.neutralSite!=='boolean'||!capture.receipts.every(r=>Number.isFinite(Date.parse(r.retrievedAt))&&Date.parse(r.retrievedAt)<=now&&now-Date.parse(r.retrievedAt)<6*3600000&&Date.parse(r.retrievedAt)<Date.parse(g.start)))return null;
 const h=lookupTorvikRating(capture.index,g.home),a=lookupTorvikRating(capture.index,g.away);
 if(!h||!a||h.canonicalId===a.canonicalId)return null;
 const p=cbbTorvikRatingsV1(g,{homeAdjOe:h.adjOe,homeAdjDe:h.adjDe,homeTempo:h.tempo,awayAdjOe:a.adjOe,awayAdjDe:a.adjDe,awayTempo:a.tempo});
 return p.ok?{generatedAt:new Date(now).toISOString(),home:p.home,away:p.away,margin:p.margin,total:p.total,attribution:'Torvik '+capture.season+' ratings + FBIS formula; research comparison only; provider update time unknown',comparisonOnly:true,canAuthorizeWager:false}:null;
}
