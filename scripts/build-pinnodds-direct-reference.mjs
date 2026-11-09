// Local-only direct acquisition handoff. No network, R2, D1 or deployment.
import {readFile,stat,writeFile} from 'node:fs/promises';
import {prepareDirectPublication} from '../services/pinnodds-restart/directPublisher.mjs';
const [rawPath,receiptPath,boardPath,outPath,...extra]=process.argv.slice(2);
if(extra.length||![rawPath,receiptPath,boardPath,outPath].every(Boolean))throw Error('USAGE: node scripts/build-pinnodds-direct-reference.mjs raw.json direct-receipt.json board.json new-output.json');
async function read(path,max){if((await stat(path)).size>max)throw Error('LOCAL_INPUT_TOO_LARGE');const v=await readFile(path,'utf8');if(Buffer.byteLength(v)>max)throw Error('LOCAL_INPUT_TOO_LARGE');return v;}
const raw=await read(rawPath,2097152),receipt=JSON.parse(await read(receiptPath,16384)),board=JSON.parse(await read(boardPath,8388608));
const result=await prepareDirectPublication({raw,receipt,board});
await writeFile(outPath,JSON.stringify(result.board,null,2),{flag:'wx',mode:0o600});
console.log(JSON.stringify({outputCreated:true,capturedAt:receipt.collectedAt,completeFeed:receipt.completeFeed,...result.diagnostics,published:false,canAuthorizeWager:false}));
