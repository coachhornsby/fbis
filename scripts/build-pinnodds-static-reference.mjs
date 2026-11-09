// Offline only. Creates a new output file; never changes live snapshots or deploys.
import {readFile,writeFile,stat} from 'node:fs/promises';
import {buildStaticPacket,publishStaticReference} from '../services/pinnodds-restart/staticPacket.mjs';
const [rawPath,receiptPath,fixturesPath,boardPath,outPath,...extra]=process.argv.slice(2);
if(extra.length||![rawPath,receiptPath,fixturesPath,boardPath,outPath].every(Boolean))throw Error('USAGE: node scripts/build-pinnodds-static-reference.mjs raw.json receipt.json fixtures.json board.json new-output.json');
async function read(path,max){if((await stat(path)).size>max)throw Error('LOCAL_INPUT_TOO_LARGE');const v=await readFile(path,'utf8');if(Buffer.byteLength(v)>max)throw Error('LOCAL_INPUT_TOO_LARGE');return v;}
const raw=await read(rawPath,2097152),receipt=JSON.parse(await read(receiptPath,16384)),fixtures=JSON.parse(await read(fixturesPath,131072)),board=JSON.parse(await read(boardPath,8388608));
const packet=await buildStaticPacket({raw,receipt,fixtures});
const output=publishStaticReference(board,packet);
await writeFile(outPath,JSON.stringify(output,null,2),{flag:'wx',mode:0o600});
console.log(JSON.stringify({outputCreated:true,matchedGames:packet.games.filter(g=>g.pinnoddsResearch.offers.length).length,offers:packet.diagnostics.offers,canAuthorizeWager:false,published:false}));
