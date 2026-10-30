import {SPORT_DATABASES,deployedSportDbMode,productSportDbHandle} from './databaseTopology.js';

/** Copy only database routing capabilities into a reduced request environment.
 * Provider credentials, retired history databases and collector switches are
 * deliberately outside this contract. No caller-supplied mode overrides.
 */
export function sportRequestRouting(source={}) {
 const result={};
 for(const name of ['CORE_DB','OPERATIONS_DB','NHL_SPORT_DB_MODE','FBIS_ARCHIVE_D1_RETIRED','FBIS_BUDGET_STOP'])
  if(source[name]!==undefined)result[name]=source[name];
 for(const [sport,plan] of Object.entries(SPORT_DATABASES)) {
  if(source[plan.binding]!==undefined)result[plan.binding]=source[plan.binding];
  for(const prefix of ['SPORT_DB_MODE_','SPORT_DB_STRICT_','SPORT_DB_LEDGER_READY_','SPORT_CUTOVER_RECEIPT_']) {
   const key=prefix+sport.toUpperCase();if(source[key]!==undefined)result[key]=source[key];
  }
 }
 return result;
}

/** Fresh, indexed approval reads: at most one deployed receipt per sport.
 * A prior request's map, a failed CORE read or an invalid grant cannot supply
 * authority. No PRIMARY approval fallback and no whole approval-table scan.
 */
export async function hydrateRequestSportRouting(env={}) {
 const map=new Map();env.__fbisCutoverApprovals=map;
 const states=[];
 for(const [sport,plan] of Object.entries(SPORT_DATABASES)) {
  if(deployedSportDbMode(env,sport)!=='sport')continue;
  // Once deployed sport mode is active this request must never use stale PRIMARY.
  env['SPORT_DB_STRICT_'+sport.toUpperCase()]='true';
  const receipt=String(env['SPORT_CUTOVER_RECEIPT_'+sport.toUpperCase()]||'').trim();
  let reason=null,row=null;
  if(!env[plan.binding]?.prepare||env[plan.binding]===env.DB)reason='SPORT_BINDING_REQUIRED';
  else if(!receipt||receipt.length>180)reason='CUTOVER_RECEIPT_REQUIRED';
  else if(!env.CORE_DB?.prepare||env.CORE_DB===env.DB)reason='CORE_BINDING_REQUIRED';
  else {
   try {
    row=await env.CORE_DB.prepare(`SELECT receipt_id,sport,status,approved_at,expires_at,revoked_at
      FROM fbis_sport_cutover_approvals WHERE sport=? AND receipt_id=? LIMIT 1`).bind(sport,receipt).first();
   }catch {reason='CORE_APPROVAL_UNAVAILABLE';}
   if(!reason&&(!row||row.sport!==sport||row.receipt_id!==receipt||row.status!=='APPROVED'||row.revoked_at||
      (row.expires_at&&(!Number.isFinite(Date.parse(row.expires_at))||Date.parse(row.expires_at)<=Date.now()))))reason='CUTOVER_APPROVAL_REQUIRED';
  }
  if(!reason)map.set(sport+':'+receipt,row);
  states.push({sport,binding:plan.binding,ok:!reason,reason});
 }
 const result={ok:states.every(s=>s.ok),states,readsMaximum:Object.keys(SPORT_DATABASES).length,canAuthorizeWager:false};
 env.__fbisRequestSportRouting=result;
 return result;
}

export function durableSportOwner(env,sport) {
 if(deployedSportDbMode(env,sport)!=='sport')return {db:env.DB,binding:'DB'};
 if(sport!=='nfl'&&!['1','true','yes'].includes(String(env['SPORT_DB_LEDGER_READY_'+sport.toUpperCase()]||'').toLowerCase()))
  throw Error('SPORT_LEDGER_NOT_QUALIFIED:'+sport);
 const owner=productSportDbHandle(env,sport);
 if(!owner.productIoUsesSportDb||!owner.db?.prepare)throw Error('SPORT_AUTHORITY_UNAVAILABLE:'+sport);
 return owner;
}
