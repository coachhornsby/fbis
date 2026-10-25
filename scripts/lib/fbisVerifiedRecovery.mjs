/**
 * FBIS CI Auto Repair — bounded, evidence-backed production recovery.
 * Only permitted writes:
 *   (1) existing authenticated server-side prop forecast capture
 *   (2) matching an existing PinnOdds archived source snapshot to official IDs
 * No chargeable provider captures, no grade/model mutations, no retroactive lines.
 */
const CAPTURE_SPORTS = new Set(['nba','nfl','nhl','mlb']);
const ARCHIVE_SPORTS = Object.freeze({nba:3,tennis:2,nfl:5,cfb:5});
const ms = s => Date.parse(String(s||''));
const safeCode = error => String(error?.message||error||'FAILED').replace(/[^A-Za-z0-9_: -]/g,'_').slice(0,140);

export function repairWindow({now=Date.now(),event='schedule'}={}){
 if(event==='workflow_dispatch')return true;
 if(event!=='schedule')return false;
 const d=new Date(now);
 // At most one guarded recovery slot per six-hour UTC block.
 // A missed/delayed scheduler run fails closed rather than double-collecting.
 return d.getUTCHours()%6===0 && d.getUTCMinutes()<30;
}
export function planFbisRepairs(incidents=[],{now=Date.now(),event='schedule'}={}){
 if(!repairWindow({now,event}))return {eligible:false,forecasts:[],archiveSports:[],blocked:['RECOVERY_WINDOW_NOT_DUE']};
 const missing=new Set(incidents.filter(x=>x.code==='PROP_PROJECTION_MISSING').map(x=>x.sport));
 const forecasts=[...missing].filter(x=>CAPTURE_SPORTS.has(x)).sort().slice(0,2);
 const archiveSports=[...new Set(incidents.filter(x=>x.code==='GAME_CURRENT_MARKET_UNVERIFIED')
  .map(x=>x.sport))].filter(x=>ARCHIVE_SPORTS[x]!=null).sort().slice(0,2);
 const blocked=[...missing].filter(x=>!CAPTURE_SPORTS.has(x)).map(x=>'NO_APPROVED_PROP_CAPTURE:'+x);
 return {eligible:true,forecasts,archiveSports,blocked};
}
async function requestJson(fetchImpl,url,{method='GET',secret,body,timeoutMs=45000}={}){
 const response=await fetchImpl(url,{
  method,headers:{'accept':'application/json','cache-control':'no-store',
   ...(method!=='GET'?{'content-type':'application/json','x-harvest-secret':secret}: {})},
  ...(body?{body:JSON.stringify(body)}:{}),
  signal:AbortSignal.timeout(timeoutMs)
 });
 const json=await response.json();
 if(!response.ok||json?.ok!==true)throw Error('API_'+response.status+'_'+(json?.reason||json?.error||'REJECTED'));
 return json;
}
export function chooseArchivedSnapshots(status,neededSports,{now=Date.now()}={}){
 const requested=new Set(neededSports.map(s=>ARCHIVE_SPORTS[s]).filter(Number.isInteger));
 if(!requested.size||status?.ok!==true||!Array.isArray(status.results))return [];
 return status.results.filter(r=>r.kind==='board'&&r.feed==='prematch'&&
  requested.has(Number(r.sportId))&&/^[a-z0-9-]{1,180}$/i.test(String(r.snapshotId||''))&&
  Number(r.normalizedRows)>0&&Number(r.matchedRows)===0&&r.reconciled!==false&&
  Number.isFinite(ms(r.collectedAt))&&now-ms(r.collectedAt)>=0&&now-ms(r.collectedAt)<=48*3600000)
  .sort((a,b)=>ms(b.collectedAt)-ms(a.collectedAt))
  .slice(0,1);
}
export async function executeFbisRepairs({incidents=[],date,now=Date.now(),event='schedule',
 secret='',base='https://fbis-myz.pages.dev',fetchImpl=fetch}={}){
 const plan=planFbisRepairs(incidents,{now,event});
 const receipts=[],blocked=[...plan.blocked];
 const outcome={eligible:plan.eligible,mode:event,attempted:0,receipts,blocked,
  paidProviderCalls:0,modelOverrides:0,marketOverrides:0,canAuthorizeWager:false};
 if(!plan.eligible)return outcome;
 if(!secret){blocked.push('REPAIR_SECRET_MISSING');return outcome}
 for(const sport of plan.forecasts){
  // Existing capture job computes its own model: no model/price payload accepted.
  // Never request a completed game's new "pregame" prediction here.
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date||'')){blocked.push('INVALID_GAME_DATE');break}
  let result;
  try{
   result=await requestJson(fetchImpl,base+'/api/prop-acceptance?sport='+sport,{
    method:'POST',secret,timeoutMs:90000});
   receipts.push({operation:'CAPTURE_OFFICIAL_INDEPENDENT_PROP_FORECAST',sport,
    status:Number(result.captured)>0?'RECORDED_AWAITING_READBACK':'NO_ELIGIBLE_PROJECTIONS',
    captured:Number(result.captured)||0,candidateProjections:Number(result.candidateProjections)||0,
    sourceReceiptStatus:result.status||null,canAuthorizeWager:false});
  }catch(e){receipts.push({operation:'CAPTURE_OFFICIAL_INDEPENDENT_PROP_FORECAST',sport,
    status:'FAILED',reason:safeCode(e)});}
  outcome.attempted++;
 }
 if(plan.archiveSports.length){
  let status;
  try{status=await requestJson(fetchImpl,base+'/api/pinnodds-status');}
  catch(e){blocked.push('PINNODDS_STATUS_UNAVAILABLE:'+safeCode(e));}
  const candidates=chooseArchivedSnapshots(status,plan.archiveSports,{now});
  if(!candidates.length)blocked.push('NO_MATCHABLE_PREEXISTING_PINNODDS_ARCHIVE');
  for(const row of candidates){
   const snapshotId=row.snapshotId,receipt={operation:'REMATCH_EXISTING_PINNODDS_ARCHIVE',
    snapshotId,sportId:Number(row.sportId),paidProviderCalls:0,canAuthorizeWager:false};
   try{
    const query={method:'POST',secret,timeoutMs:90000};
    const prepared=await requestJson(fetchImpl,base+'/api/pinnodds-ingest',{
     ...query,body:{operation:'rematch',phase:'prepare',snapshotId,postCaptureFixtures:true}});
    const batches=Number(prepared.batches);
    if(!Number.isSafeInteger(batches)||batches<0||batches>4){
     receipt.status='BLOCKED_UNBOUNDED_REPLAY';receipt.batches=batches;
    }else{
     let inserted=0;
     for(let batchIndex=0;batchIndex<batches;batchIndex++){
      const consumed=await requestJson(fetchImpl,base+'/api/pinnodds-ingest',{
       ...query,body:{operation:'rematch',phase:'consume',snapshotId,batchIndex}});
      inserted+=Number(consumed.inserted)||0;
     }
     const final=await requestJson(fetchImpl,base+'/api/pinnodds-ingest',{
      ...query,body:{operation:'rematch',phase:'finalize',snapshotId}});
     receipt.status='REMATCHED_AWAITING_CARD_RECHECK';
     receipt.matchedRows=Number(final.matchedRows)||0;receipt.inserted=inserted;
    }
   }catch(e){receipt.status='FAILED';receipt.reason=safeCode(e)}
   receipts.push(receipt);outcome.attempted++;
  }
 }
 return outcome;
}
