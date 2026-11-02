// Offline private re-import from the two-request authenticated capture. Never publishes.
import fs from'node:fs';import{createHash}from'node:crypto';
import{normalizeKenpomRatingRows,indexKenpomRows}from'../functions/lib/kenpomCbb.js';
import{scoreboardGames}from'../functions/lib/publicBoardSnapshot.js';
import{applyCbbOfficialSlate}from'../functions/lib/cbbOfficialFixtures.js';
import{buildCbbProjectionPacket,cbbFixtureKey,resolveCbbOfficialEvidence}from'../functions/lib/cbbProjectionPacket.js';
const root='artifacts/cbb-renewed-primary',auth=root+'/auth/capture-grok-cbb-20261102T170836Z';
const read=p=>JSON.parse(fs.readFileSync(p)),hash=b=>createHash('sha256').update(b).digest('hex');
const asOf=process.argv[2];if(!Number.isFinite(Date.parse(asOf)))throw Error('Supply actual evaluation UTC');
const receipt=read(auth+'/receipt.json');if(receipt.state!=='CAPTURED'||receipt.attempts!==2||receipt.records.length!==2)throw Error('CAPTURE_RECEIPT');
const verified={};for(const r of receipt.records){const b=fs.readFileSync(`${auth}/${r.provider}-${r.name}.json`);if(r.status!==200||b.length!==r.bytes||hash(b)!==r.sha256)throw Error('PROVIDER_HASH');const rows=JSON.parse(b);if(rows.length!==r.rows||rows.some(x=>Number(x.Season??x.season)!==2027))throw Error('PROVIDER_SEASON_OR_COUNT');verified[r.provider]={rows,at:r.observedAt};}
if(verified.cbbd.rows.length!==0)throw Error('CURRENT_CBBD_CHANGED_REVIEW_ADAPTER');
const index=indexKenpomRows(normalizeKenpomRatingRows(verified.kenpom.rows),2026);
if(index.matched!==365||index.unmatched||Object.keys(index.byCanonicalId).length!==365)throw Error('PRIMARY_TEAM_COVERAGE');
const providerRows=Object.entries(index.byCanonicalId).map(([teamId,p])=>({provider:'kenpom',season:2027,teamId,payload:{...p,season:2027}}));
providerRows.push(...read('artifacts/cbb-provider-mission/normalized-provider-inputs.json').filter(r=>r.provider==='cbbd'));
providerRows.push(...read('artifacts/cbb-current-evidence/torvik-refresh/normalized-provider-inputs.json'));
const capture=read(root+'/scoreboard-capture.json'),byId=new Map();
for(const c of capture){const b=fs.readFileSync(root+'/'+c.file);if(hash(b)!==c.sha256||Date.parse(c.observedAt)>Date.parse(asOf)||Date.parse(asOf)-Date.parse(c.observedAt)>300000)throw Error('SCOREBOARD_HASH_OR_AGE');for(const g of scoreboardGames(JSON.parse(b),{sport:'cbb',date:'2026-11-02',capturedAt:c.observedAt}))byId.set(g.id,g);}
const resolutions=read('data/public/cbb-fixture-resolutions/2026-11-02.json');const games=applyCbbOfficialSlate([...byId.values()],resolutions,Date.parse(asOf));
const old=read('artifacts/cbb-projection-phase/private-projections.json'),oldEvidence=read('artifacts/cbb-fixture-integrity/fixture-evidence.json'),fixtureEvidence={};
for(const g of games){const p=old.events.find(e=>e.eventId===g.id);if(!p)continue;
 const original={id:p.eventId,date:p.date,start:p.start,sport:'cbb',neutralSite:p.neutralSite,home:{espnId:p.homeId.replace('cbb-','')},away:{espnId:p.awayId.replace('cbb-','')}};
 const reviewed=resolveCbbOfficialEvidence(original,oldEvidence[g.id],resolutions.records.find(r=>r.eventId===g.id),asOf);
 const a=reviewed.game,b=g;
 if(a.date!==b.date||a.home.espnId!==b.home.espnId||a.away.espnId!==b.away.espnId||a.neutralSite!==b.neutralSite||Date.parse(a.start)!==Date.parse(b.start))continue;
 fixtureEvidence[g.id]={...reviewed.evidence,eventId:g.id,date:g.date,fixtureKey:cbbFixtureKey(g),observedAt:g.capturedAt};
}
const captures={kenpom:verified.kenpom.at,cbbd:verified.cbbd.at,torvik:read('artifacts/cbb-current-evidence/torvik-refresh/receipt.json').observedAt};
const packet=buildCbbProjectionPacket({games,providerRows,captures,asOf,fixtureEvidence});
const availability=read(root+'/availability.json');
// Delivery does not match the strict fixture-key/team/time contract: retain original research.
const review={officialSeasonOut:{eventId:'401925947',playerId:'5311936',name:'Alvin Jackson III',teamId:'cbb-2692',status:'OUT',scope:'2026-27 season',sourceUrl:'https://weberstatesports.com/news/2026/10/30/mens-basketball-new-era-of-wildcat-basketball-begins-monday-night',verification:'PRIMARY_SOURCE_READ',canAdjustModel:false},strictIntakeRecords:[],needsNormalization:availability.records.length,probableStarterListings:availability.officialProbableStarters.length,reason:'SOURCE_DELIVERY_FIXTURE_KEY_TEAM_NAMESPACE_AND_TIMESTAMPS_REQUIRE_REVIEW',canAuthorizeWager:false};
fs.writeFileSync(root+'/private-projections.json',JSON.stringify(packet,null,2));fs.writeFileSync(root+'/availability-review.json',JSON.stringify(review,null,2));
const summary={...packet.summary,generatedAt:asOf,expiresAt:packet.expiresAt,captures,kenpomTeams:index.matched,currentCbbdRows:0,officialSeasonOutCorroborated:1,automaticInjuryAdjustments:0,publicPredictionsPublished:0,productionChanged:false,canAuthorizeWager:false};
fs.writeFileSync(root+'/receipt.json',JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
