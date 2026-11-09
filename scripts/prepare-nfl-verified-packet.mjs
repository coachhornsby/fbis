// Offline only. No fetch, credentials, storage reads or writes to remote systems.
import {readFile,writeFile} from 'node:fs/promises';
import teams from '../data/teams/nfl.js';
import {boardDate} from '../functions/lib/publicBoardSnapshot.js';
import {prepareVerifiedNflRecoveryPacket} from '../functions/lib/nflVerifiedRecoveryPacket.js';
const [publicationPath,schedulePath,date,output,previousPath]=process.argv.slice(2);
if(!output)throw Error('Usage: publication.json schedule.json YYYY-MM-DD new-output.json [previous-packet.json]');
const load=async p=>JSON.parse(await readFile(p,'utf8'));
const publication=await load(publicationPath),schedule=await load(schedulePath),now=Date.now();
const canon=x=>({LA:'LAR',JAC:'JAX',WSH:'WAS'}[x]||x);
const team=x=>teams.find(t=>t.abbr===canon(x));
const games=schedule.games.filter(g=>g.start&&boardDate(g.start)===date).map(g=>({id:g.espnId,sport:'nfl',date,start:g.start,status:g.hasResult?'final':Date.parse(g.start)<=now?'live':'scheduled',neutralSite:g.neutralSite,home:team(g.home),away:team(g.away)}));
const result=await prepareVerifiedNflRecoveryPacket({date,games,publication,schedule,previousPacket:previousPath?await load(previousPath):null,now});
if(!result.changed)throw Error('No verified future updates; no output written: '+JSON.stringify(result.decisions));
await writeFile(output,JSON.stringify(result.packet)+'\n',{flag:'wx'});
console.log(JSON.stringify({output,events:result.packet.events.length,expiresAt:result.packet.expiresAt,decisions:result.decisions,remoteWrites:0}));
