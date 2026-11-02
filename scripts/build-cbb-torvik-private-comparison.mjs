import fs from'node:fs';import{createHash}from'node:crypto';import{scoreboardGames}from'../functions/lib/publicBoardSnapshot.js';import{applyCbbOfficialSlate}from'../functions/lib/cbbOfficialFixtures.js';import{buildTorvikPrivateComparison}from'../functions/lib/cbbTorvikPrivateComparison.js';
const root='artifacts/cbb-current-evidence',read=p=>JSON.parse(fs.readFileSync(p));const asOf=process.argv[2];const captures=read(root+'/scoreboard/capture.json');const byId=new Map();
for(const c of captures){const b=fs.readFileSync(root+'/scoreboard/'+c.file);if(createHash('sha256').update(b).digest('hex')!==c.sha256)throw Error('SCOREBOARD_HASH');for(const g of scoreboardGames(JSON.parse(b),{sport:'cbb',date:'2026-11-02',capturedAt:c.observedAt}))byId.set(g.id,g);}
const providerRows=read(root+'/torvik-refresh/normalized-provider-inputs.json');
const games=applyCbbOfficialSlate([...byId.values()],read('data/public/cbb-fixture-resolutions/2026-11-02.json'),Date.parse(asOf));
const packet=buildTorvikPrivateComparison({games,providerRows,observedAt:read(root+'/torvik-refresh/receipt.json').observedAt,asOf});
fs.writeFileSync(root+'/private-torvik-comparison.json',JSON.stringify(packet,null,2));console.log(JSON.stringify({generatedAt:packet.generatedAt,expiresAt:packet.expiresAt,...packet.summary}));
