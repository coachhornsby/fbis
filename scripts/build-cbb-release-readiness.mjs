// Offline private operations output. Source captures retain their actual observedAt.
import fs from 'node:fs';import{createHash}from'node:crypto';
import{scoreboardGames}from'../functions/lib/publicBoardSnapshot.js';
import{applyCbbOfficialSlate}from'../functions/lib/cbbOfficialFixtures.js';
import{cbbFixtureKey}from'../functions/lib/cbbProjectionPacket.js';
import{buildCbbReleaseReadiness}from'../functions/lib/cbbReleaseReadiness.js';
const root='artifacts/cbb-release-readiness';const asOf=process.argv[2];
if(!asOf||!Number.isFinite(Date.parse(asOf)))throw Error('Supply verified as-of UTC');
const read=p=>JSON.parse(fs.readFileSync(p));
const captures=read(root+'/scoreboard-captures.json');const games=[];
for(const c of captures){
 if(Date.parse(c.observedAt)>Date.parse(asOf)||Date.parse(asOf)-Date.parse(c.observedAt)>5*60000)throw Error('SCOREBOARD_CAPTURE_STALE_OR_FUTURE');
 const raw=fs.readFileSync(`${root}/${c.date}-espn.json`);
 if(createHash('sha256').update(raw).digest('hex')!==c.sha256)throw Error('SCOREBOARD_CAPTURE_HASH');
 games.push(...scoreboardGames(JSON.parse(raw),{sport:'cbb',date:'2026-11-02',capturedAt:c.observedAt}));
}
const unique=new Map();for(const g of games){if(unique.has(g.id)&&cbbFixtureKey(unique.get(g.id))!==cbbFixtureKey(g))throw Error('CONFLICTING_SCOREBOARD_DUPLICATE');if(!unique.has(g.id)||Date.parse(g.capturedAt)>Date.parse(unique.get(g.id).capturedAt))unique.set(g.id,g);}
const corrected=applyCbbOfficialSlate([...unique.values()],read('data/public/cbb-fixture-resolutions/2026-11-02.json'),Date.parse(asOf));
const projectionPacket=read('artifacts/cbb-projection-phase/private-projections.json');
const roster=read('artifacts/cbb-grok-integration/staged/current-roster-history-candidates.json');
const marketObservations=read('artifacts/cbb-research-intake/staged/kalshi-observations.json');
// Optional source-linked Grok delivery. Missing file creates zero claims, not a healthy roster.
const evidencePath=process.argv[3];const evidence=evidencePath?read(evidencePath):{records:[],officialHosts:[]};
const packet=buildCbbReleaseReadiness({games:corrected,projectionPacket,roster,marketObservations,availabilityRecords:evidence.records,officialHosts:evidence.officialHosts,asOf});
fs.writeFileSync(root+'/private-readiness.json',JSON.stringify(packet,null,2));
const receipt={...packet.summary,generatedAt:asOf,scoreboardRequests:captures.length,availabilityRecordsSupplied:evidence.records.length,projectionSourceGeneratedAt:projectionPacket.generatedAt,projectionSourceExpiresAt:projectionPacket.expiresAt,reasonCounts:{},productionChanged:false,canAuthorizeWager:false};
for(const e of packet.events)for(const r of e.reasons)receipt.reasonCounts[r]=(receipt.reasonCounts[r]||0)+1;
fs.writeFileSync(root+'/receipt.json',JSON.stringify(receipt,null,2));
console.log(JSON.stringify(receipt,null,2));
