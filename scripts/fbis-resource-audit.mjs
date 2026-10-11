import { readFile, writeFile } from 'node:fs/promises';

export const LIMIT_BYTES = 10_000_000_000;
export const DB_ID = 'b50c724c-903b-4241-8ce1-48d931e7a44c';
export const SPORTS = ['CFB','CBB','NFL','NBA','WNBA','MLB','NHL','Soccer','Tennis','Asian baseball','Shared/unallocated'];
export function bucketForKey(key) {
  const parts = key.split('/');
  const [a,b] = parts;
  if (a === 'canonical' && b === 'cfb') return 'CFB';
  if (a === 'audit' && b === 'cfbd') return 'CFB';
  if (a === 'raw' && b === 'cfbd') return 'CFB';
  if (a === 'cbb' || (a === 'raw' && ['cbbd','kenpom','torvik','kenpom-fanmatch'].includes(b))) return 'CBB';
  if (a === 'nfl') return 'NFL';
  if (['research','models','evaluation'].includes(a) && ['nba','wnba','mlb'].includes(b)) return b.toUpperCase();
  if (a === 'tennis') return 'Tennis';
  return 'Shared/unallocated';
}
export function evaluateCapacity(current, previous, now = Date.now(), rates = {}) {
  const bytes = Number(current.d1Bytes);
  if (!Number.isFinite(bytes) || bytes < 0) throw new Error('Invalid D1 size');
  const pct = bytes / LIMIT_BYTES * 100;
  let severity = pct >= 95 ? 'CRITICAL' : pct >= 85 ? 'DEGRADED' : pct >= 75 ? 'WARN' : 'NORMAL';
  let growthBytesPerDay = null, daysToLimit = null, extraStorageCostMonthly = null;
  if (previous && Number.isFinite(Number(previous.d1Bytes)) && Number.isFinite(Date.parse(previous.timestamp))) {
    const elapsedDays = (now - Date.parse(previous.timestamp)) / 86_400_000;
    if (elapsedDays >= 0.5) {
      growthBytesPerDay = (bytes - Number(previous.d1Bytes)) / elapsedDays;
      if (growthBytesPerDay > 0) daysToLimit = Math.max(0, (LIMIT_BYTES - bytes) / growthBytesPerDay);
      if (daysToLimit !== null && daysToLimit <= 30 && severity !== 'CRITICAL') severity = 'DEGRADED';
    }
  }
  if (Number.isFinite(rates.d1UsdPerGbMonth) && Number.isFinite(rates.r2UsdPerGbMonth) && previous && Number.isFinite(growthBytesPerDay)) {
    const r2Delta = Math.max(0, Number(current.r2AccountBytes) - Number(previous.r2AccountBytes || 0));
    const periodDays = (now - Date.parse(previous.timestamp)) / 86_400_000;
    extraStorageCostMonthly = Math.max(0, growthBytesPerDay * 30 / 1e9 * rates.d1UsdPerGbMonth) + (periodDays > 0 ? r2Delta / periodDays * 30 / 1e9 * rates.r2UsdPerGbMonth : 0);
    if (extraStorageCostMonthly > 5 && severity === 'NORMAL') severity = 'WARN';
  }
  return {severity, pct, remainingBytes: LIMIT_BYTES - bytes, growthBytesPerDay, daysToLimit, extraStorageCostMonthly};
}
export async function collect({accountId, token, daily = false, previous = null, now = Date.now(), request = fetch}) {
  if (!accountId || !token) throw new Error('Missing Cloudflare credentials');
  const base = 'https://api.cloudflare.com/client/v4/accounts/' + accountId;
  const get = async (path, query = {}) => {
    const url = new URL(base + path);
    for (const [k,v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, String(v));
    const res = await request(url, {headers:{Authorization:'Bearer ' + token}});
    if (!res.ok) throw new Error('Cloudflare GET failed ' + path + ': ' + res.status);
    const body = await res.json();
    if (!body.success) throw new Error('Cloudflare API rejected ' + path);
    return body;
  };
  const [db, r2, buckets] = await Promise.all([
    get('/d1/database/' + DB_ID),
    get('/r2/metrics'),
    get('/r2/buckets')
  ]);
  const d1Bytes = Number(db.result.file_size);
  const r2AccountBytes = Number(r2.result?.standard?.published?.payloadSize || 0) + Number(r2.result?.infrequentAccess?.published?.payloadSize || 0);
  const sportBuckets = Object.fromEntries(SPORTS.map(s => [s,{r2Bytes:null,r2Objects:null,d1ExactBytes:null,memoryP50:null,memoryP90:null,memoryP99:null,cpu:null,spend:null}]));
  let archiveBytes = null, archiveObjects = null;
  if (daily) {
    archiveBytes = 0; archiveObjects = 0;
    for (const v of Object.values(sportBuckets)) {v.r2Bytes = 0;v.r2Objects = 0;}
    let cursor, pages = 0;
    do {
      const result = await get('/r2/buckets/fbis-archive/objects',{per_page:1000,cursor});
      for (const object of result.result) {
        const size = Number(object.size);
        if (!Number.isFinite(size) || size < 0) throw new Error('Invalid R2 object size');
        const target = sportBuckets[bucketForKey(object.key)];
        target.r2Bytes += size; target.r2Objects++;
        archiveBytes += size; archiveObjects++;
      }
      cursor = result.result_info?.cursor;
      if (++pages > 100) throw new Error('R2 pagination exceeded safe bound');
    } while (cursor);
  }
  const timestamp = new Date(now).toISOString();
  const capacity = evaluateCapacity({d1Bytes,r2AccountBytes},previous,now);
  return {schema:'FBIS_RESOURCE_AUDIT_V1',timestamp,mode:daily?'DAILY':'HOURLY',
    d1Bytes,d1Tables:db.result.num_tables,d1LimitBytes:LIMIT_BYTES,
    r2AccountBytes,r2BucketNames:(buckets.result?.buckets||[]).map(x=>x.name),
    archiveBytes,archiveObjects,sportBuckets,capacity,
    workerMemory:'UNKNOWN',workerCpu:'UNKNOWN',r2Cost:'UNKNOWN',d1SportAllocation:'UNKNOWN',
    forecast30d:capacity.growthBytesPerDay===null?null:d1Bytes+capacity.growthBytesPerDay*30,
    forecast90d:capacity.growthBytesPerDay===null?null:d1Bytes+capacity.growthBytesPerDay*90,
    forecast180d:capacity.growthBytesPerDay===null?null:d1Bytes+capacity.growthBytesPerDay*180,
    governance:{paidProviderCalls:0,productionMutations:0,protectedObjectsDeleted:0}};
}
if (process.argv[1]?.endsWith('fbis-resource-audit.mjs')) {
  const prevPath = process.env.FBIS_RESOURCE_PREVIOUS;
  let previous = null;
  if (prevPath) {try{previous=JSON.parse(await readFile(prevPath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}}
  const report = await collect({accountId:process.env.CLOUDFLARE_ACCOUNT_ID,token:process.env.CLOUDFLARE_API_TOKEN,
    daily:process.argv.includes('--daily'),previous});
  await writeFile(process.env.FBIS_RESOURCE_OUTPUT || 'fbis-resource-audit.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({timestamp:report.timestamp,mode:report.mode,d1Bytes:report.d1Bytes,
    r2AccountBytes:report.r2AccountBytes,capacity:report.capacity}));
  if (['DEGRADED','CRITICAL'].includes(report.capacity.severity)) process.exitCode = 2;
}
