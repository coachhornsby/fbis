// Code approval is required as well as billing policy. Config cannot activate a
// legacy job that has no execution boundary. These jobs make no D1 mutations.
export const TENNIS_COLLECT_JOB='services/polymarket-tennis-collector/index.js';
export const TENNIS_HEALTH_JOB=TENNIS_COLLECT_JOB+':health';
export const KALSHI_RELAY_JOB='services/kalshi-public-collector/index.js';
export const KALSHI_CAPTURE_JOB='functions/api/kalshi-collector-internal.js:markets';
export const KALSHI_STATUS_JOB='functions/api/kalshi-collector-internal.js:exchange-status';
export const KALSHI_CATALOG_JOB='functions/api/kalshi-collector-internal.js:series-catalog';
export const POLY_STREAM_JOB='services/polymarket-us-stream/boundedWorker.mjs';
export const POLY_STREAM_SIGN_JOB='functions/api/polymarket-stream-sign.js';
export const POLY_ROSTER_STAGE_JOB='functions/lib/boundedPolymarketRoster.js:stage';
export const POLY_ROSTER_PUBLISH_JOB='services/polymarket-roster-publisher/worker.mjs';
export const POLY_SNAPSHOT_READ_JOB='functions/lib/boundedPolymarketBoard.js:read';
export const POLY_REST_JOB='services/polymarket-rest-collector/worker.mjs';
export const POLY_FIXTURE_JOB='functions/lib/polymarketFixtureArchive.js:write';
export const PINNED_INSPECTION_JOB='services/archive/inspectPinnedManifest.mjs';
const noD1={d1Queries:0,reads:0,writes:0,r2Lists:0};
export const CERTIFIED_EXECUTION_JOBS=Object.freeze({
 [PINNED_INSPECTION_JOB]:Object.freeze({cpuMs:10,units:Object.freeze({...noD1,requests:0,responseBytes:0,r2Reads:2,r2Writes:0,r2Bytes:4096,inspectionAttempts:1,coordinatorCalls:1,coordinatorStorageGets:2,coordinatorStoragePuts:2})}),
 ['services/espn-mcp/oauth.mjs']:Object.freeze({cpuMs:100,units:Object.freeze({...noD1,requests:0,responseBytes:0,r2Reads:0,r2Writes:0,r2Bytes:0,doDurationMs:1000})}),
 ['services/espn-mcp/worker.mjs']:Object.freeze({cpuMs:100,units:Object.freeze({...noD1,requests:1,responseBytes:4194304,r2Reads:0,r2Writes:0,r2Bytes:0})}),
 ['services/exchangeDiagnostics.mjs']:Object.freeze({cpuMs:100,units:Object.freeze({...noD1,requests:0,responseBytes:0,r2Reads:0,r2Writes:1,r2Bytes:16384})}),
 // Bounded card read: 1 fixture manifest + 1 Kalshi game + 1 Kalshi WS +
 // 3 basketball line families + 1 separate Polymarket stream snapshot = 7 R2 reads plus one independent first-half total snapshot for CBB.
 // A production policy must independently admit these units; this cap does not activate collectors.
 ['functions/lib/exchangeCardDelivery.js']:Object.freeze({cpuMs:100,units:Object.freeze({...noD1,requests:0,responseBytes:0,r2Reads:8,r2Writes:0,r2Bytes:14680064})}),
 ['functions/api/kalshi-market-stream-sign.js']:Object.freeze({cpuMs:100,units:Object.freeze({...noD1,requests:0,responseBytes:0,r2Reads:0,r2Writes:0,r2Bytes:0})}),
 ['services/kalshi-public-collector/marketSession.mjs']:Object.freeze({cpuMs:100,units:Object.freeze({...noD1,requests:2,responseBytes:16384,r2Reads:5,r2Writes:1,r2Bytes:8388608,wsMessages:128,wsBytes:1048576,wsSends:1,wsSendBytes:16384,doDurationMs:30000})}),
 ['services/polymarket-rest-collector/fixtures.mjs']:Object.freeze({cpuMs:100,units:Object.freeze({...noD1,requests:1,responseBytes:4194304,r2Reads:0,r2Writes:0,r2Bytes:0})}),
 [POLY_REST_JOB]:Object.freeze({cpuMs:100,units:Object.freeze({...noD1,requests:4,responseBytes:2097152,r2Reads:1,r2Writes:1,r2Bytes:3145728})}),
 [POLY_FIXTURE_JOB]:Object.freeze({cpuMs:100,units:Object.freeze({...noD1,requests:0,responseBytes:0,r2Reads:2,r2Writes:1,r2Bytes:262144})}),
 [POLY_ROSTER_STAGE_JOB]:Object.freeze({cpuMs:100,units:Object.freeze({...noD1,requests:0,responseBytes:0,r2Reads:1,r2Writes:1,r2Bytes:262144})}),
 [POLY_ROSTER_PUBLISH_JOB]:Object.freeze({cpuMs:100,units:Object.freeze({...noD1,requests:0,responseBytes:0,r2Reads:12,r2Writes:1,r2Bytes:1048576})}),
 [POLY_SNAPSHOT_READ_JOB]:Object.freeze({cpuMs:100,units:Object.freeze({...noD1,requests:0,responseBytes:0,r2Reads:1,r2Writes:0,r2Bytes:1048576})}),
 [POLY_STREAM_JOB]:Object.freeze({cpuMs:100,units:Object.freeze({...noD1,requests:2,responseBytes:16384,r2Reads:1,r2Writes:2,r2Bytes:2097152,wsMessages:128,wsBytes:1048576,wsSends:8,wsSendBytes:16384,doDurationMs:30000})}),
 [POLY_STREAM_JOB+':health']:Object.freeze({cpuMs:100,units:Object.freeze({...noD1,requests:0,responseBytes:0,r2Reads:1,r2Writes:0,r2Bytes:65536})}),
 [POLY_STREAM_SIGN_JOB]:Object.freeze({cpuMs:100,units:Object.freeze({...noD1,requests:0,responseBytes:0,r2Reads:0,r2Writes:0,r2Bytes:0})}),
 [KALSHI_RELAY_JOB]:Object.freeze({cpuMs:100,units:Object.freeze({...noD1,requests:1,responseBytes:65536,r2Reads:0,r2Writes:0,r2Bytes:0})}),
 [KALSHI_RELAY_JOB+':health']:Object.freeze({cpuMs:100,units:Object.freeze({...noD1,requests:0,responseBytes:0,r2Reads:2,r2Writes:0,r2Bytes:131072})}),
 [KALSHI_CAPTURE_JOB]:Object.freeze({cpuMs:100,units:Object.freeze({...noD1,requests:1,responseBytes:4194304,r2Reads:3,r2Writes:4,r2Bytes:8388608})}),
 [KALSHI_STATUS_JOB]:Object.freeze({cpuMs:100,units:Object.freeze({...noD1,requests:1,responseBytes:65536,r2Reads:1,r2Writes:1,r2Bytes:131072})}),
 [KALSHI_CATALOG_JOB]:Object.freeze({cpuMs:100,units:Object.freeze({...noD1,requests:1,responseBytes:4194304,r2Reads:1,r2Writes:2,r2Bytes:4194304})}),
 [TENNIS_COLLECT_JOB]:Object.freeze({cpuMs:100,units:Object.freeze({requests:36,responseBytes:8388608,r2Reads:0,r2Writes:2,r2Lists:0,r2Bytes:4194304,d1Queries:0,reads:0,writes:0})}),
 [TENNIS_HEALTH_JOB]:Object.freeze({cpuMs:100,units:Object.freeze({requests:0,responseBytes:0,r2Reads:1,r2Writes:0,r2Lists:0,r2Bytes:65536,d1Queries:0,reads:0,writes:0})})
});
export function executionPolicyError(policy,job){
 if(!Object.hasOwn(CERTIFIED_EXECUTION_JOBS,job||''))return 'JOB_EXECUTION_NOT_CERTIFIED';
 const units=policy?.jobs?.[job]?.maxUnits;
 if(!units||!Object.keys(units).length)return 'MISSING_UNIT_BOUNDS';
 const caps=CERTIFIED_EXECUTION_JOBS[job].units;
 if(job===PINNED_INSPECTION_JOB){
  const definition=policy.jobs[job];
  if(!Number.isSafeInteger(definition.coordinatorOverheadMicroUsd)||definition.coordinatorOverheadMicroUsd<1||definition.preAdmissionAttemptCeiling!==1||definition.runtimeCpuLimitMs!==10||policy.unitCeilings?.inspectionAttempts!==1)return 'INSPECTION_COORDINATOR_OVERHEAD_NOT_APPROVED';
  if(Object.keys(units).length!==Object.keys(caps).length||Object.entries(caps).some(([key,value])=>units[key]!==value))return 'INSPECTION_EXACT_UNITS_REQUIRED';
 }
 for(const [unit,value]of Object.entries(units))if(!Object.hasOwn(caps,unit)||!Number.isSafeInteger(value)||value<0||value>caps[unit])return 'JOB_POLICY_EXCEEDS_CODE_CEILINGS';
 return null;
}
