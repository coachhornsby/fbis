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
const noD1={d1Queries:0,reads:0,writes:0,r2Lists:0};
export const CERTIFIED_EXECUTION_JOBS=Object.freeze({
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
 for(const [unit,value]of Object.entries(units))if(!Object.hasOwn(caps,unit)||!Number.isSafeInteger(value)||value<0||value>caps[unit])return 'JOB_POLICY_EXCEEDS_CODE_CEILINGS';
 return null;
}
