// Normalize an already captured private pair of public CSVs; no network or writes to D1.
import fs from'node:fs';import{createHash}from'node:crypto';
import{normalizeTorvikTeamRows,normalizeTorvikFourFactorRows,indexTorvikRows}from'../functions/lib/torvikCbb.js';
const root=process.argv[2]||'artifacts/cbb-current-evidence/torvik-refresh';
const metadata=JSON.parse(fs.readFileSync(root+'/capture.json'));
function read(file){const m=metadata.find(x=>x.file===file);if(m?.status!==200)throw Error('CAPTURE_UNAVAILABLE');const b=fs.readFileSync(root+'/'+file);if(createHash('sha256').update(b).digest('hex')!==m.sha256)throw Error('CAPTURE_HASH');return b.toString('utf8');}
const rows=normalizeTorvikTeamRows(read('2027_team_results.csv')),factors=normalizeTorvikFourFactorRows(read('2027_fffinal.csv'));
const index=indexTorvikRows(rows,2026);
if(rows.length!==365||index.matched!==365||index.unmatched||Object.keys(index.byCanonicalId).length!==365)throw Error('CURRENT_D1_COVERAGE');
if(rows.some(r=>![r.adjOe,r.adjDe,r.tempo].every(n=>Number.isFinite(n)&&n>0)))throw Error('RATINGS_SCALE');
const at=metadata.find(x=>x.file==='2027_team_results.csv').observedAt;
const output=Object.entries(index.byCanonicalId).map(([teamId,p])=>({season:2027,provider:'torvik',teamId,observedAt:at,payload:JSON.stringify({...p,season:2027}),canAdjustModel:false}));
fs.writeFileSync(root+'/normalized-provider-inputs.json',JSON.stringify(output,null,2));
fs.writeFileSync(root+'/four-factors.json',JSON.stringify(factors,null,2));
const receipt={teams:rows.length,factorRows:factors.length,observedAt:at,expiresAt:new Date(Date.parse(at)+6*3600000).toISOString(),role:'PRIVATE_COMPARISON_ONLY',modelChanges:0,publicPredictions:0,kenpomRefreshed:false,cbbdRefreshed:false,canAuthorizeWager:false};
fs.writeFileSync(root+'/receipt.json',JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
