import {LAB_PREFIX,MLB_STATCAST_LAB_VERSION,normalizeLabRows,isActualLabPitch} from './mlbStatcastLab.js';
import {sha256Hex} from './sha256Hex.js';
import {parseStatcastCsv} from './mlbPitchMatchupFeed.js';
const pointerKey=(id,role,year)=>`${LAB_PREFIX}${role}/${id}/${year}/current.json`;
async function compressed(text){return new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();}
async function readCompressed(object){return JSON.parse(await new Response(object.body.pipeThrough(new DecompressionStream('gzip'))).text());}
export async function readLabPackets(env,{playerId,role,seasons}){
 if(!env.ARCHIVE?.get)return {packets:[],diagnostics:['ARCHIVE_UNBOUND']};
 const diagnostics=[];
 const packets=await Promise.all(seasons.map(async season=>{try{
  const pointer=await env.ARCHIVE.get(pointerKey(playerId,role,season));if(!pointer){diagnostics.push(`${season}:NOT_COLLECTED`);return null;}
  const index=await pointer.json(),object=await env.ARCHIVE.get(index.key);if(!object)throw Error('SNAPSHOT_MISSING');const packet=await readCompressed(object);
  if(packet.version!==MLB_STATCAST_LAB_VERSION||String(packet.playerId)!==String(playerId)||packet.role!==role||packet.season!==season||sha256Hex(JSON.stringify(packet.rows))!==packet.sourceHash)throw Error('IDENTITY_OR_INTEGRITY_MISMATCH');
  return packet;
 }catch(error){diagnostics.push(`${season}:${error.message}`);return null;}}));
 return {packets:packets.filter(Boolean),diagnostics};
}
export async function persistLabPacket(env,{playerId,role,season,cutoffDay,rawCsv,finalGameIds,sourceUrl,observedAt=new Date().toISOString()}={}){
 if(!env.ARCHIVE?.get||!env.ARCHIVE?.put)throw Error('ARCHIVE_UNBOUND');
 if(typeof rawCsv!=='string'||rawCsv.length>18000000||!Array.isArray(finalGameIds)||finalGameIds.length>4000)throw Error('SOURCE_BYTE_OR_GAME_BUDGET_EXCEEDED');
 const source=new URL(sourceUrl);if(source.origin!=='https://baseballsavant.mlb.com'||source.pathname!=='/statcast_search/csv'||source.searchParams.get('player_type')!==role||source.searchParams.get(role==='pitcher'?'pitchers_lookup[]':'batters_lookup[]')!==String(playerId))throw Error('SOURCE_SCOPE_MISMATCH');
 const parsed=parseStatcastCsv(rawCsv);
 if(!rawCsv.replace(/^\uFEFF/,'').startsWith('"pitch_type"')||parsed.length>14000)throw Error('INVALID_OR_TRUNCATED_SOURCE_CSV');
 const normalized=normalizeLabRows(parsed,{playerId,role,season,cutoffDay,finalGameIds:new Set(finalGameIds.map(String))});
 if(normalized.rejections.identity||normalized.rejections.game||normalized.rejections.scope)throw Error('SOURCE_RECORD_SCOPE_REJECTED');
 const sourceHash=sha256Hex(JSON.stringify(normalized.rows)),key=`${LAB_PREFIX}${role}/${playerId}/${season}/${sourceHash}/snapshot.json.gz`;
 const existing=await env.ARCHIVE.get(key);if(existing){const packet=await readCompressed(existing);if(packet.sourceHash!==sourceHash)throw Error('EXISTING_SNAPSHOT_CORRUPT');await env.ARCHIVE.put(pointerKey(playerId,role,season),JSON.stringify({key,sourceHash,observedAt:packet.observedAt,pitches:packet.rows.filter(isActualLabPitch).length}));return {ok:true,reused:true,key,sourceHash,pitches:packet.rows.filter(isActualLabPitch).length};}
 const packet={version:MLB_STATCAST_LAB_VERSION,playerId:String(playerId),role,season,cutoffDay,sourceHash,observedAt,sourceUrl,games:new Set(normalized.rows.map(r=>r.game_pk)).size,coverage:'SOURCE_FINAL_GAMES_THROUGH_CUTOFF',rejections:normalized.rejections,rows:normalized.rows};
 await env.ARCHIVE.put(key.replace('snapshot.json.gz','source.csv.gz'),await compressed(rawCsv),{httpMetadata:{contentType:'application/gzip'},onlyIf:new Headers({'If-None-Match':'*'})});
 const written=await env.ARCHIVE.put(key,await compressed(JSON.stringify(packet)),{httpMetadata:{contentType:'application/gzip'},onlyIf:new Headers({'If-None-Match':'*'})});
 if(written===null){const saved=await env.ARCHIVE.get(key);if(!saved)throw Error('CONCURRENT_SNAPSHOT_MISSING');const original=await readCompressed(saved);if(original.sourceHash!==sourceHash)throw Error('CONCURRENT_SNAPSHOT_CORRUPT');await env.ARCHIVE.put(pointerKey(playerId,role,season),JSON.stringify({key,sourceHash,observedAt:original.observedAt,pitches:original.rows.filter(isActualLabPitch).length}));return {ok:true,reused:true,key,sourceHash,pitches:original.rows.filter(isActualLabPitch).length};}
 await env.ARCHIVE.put(pointerKey(playerId,role,season),JSON.stringify({key,sourceHash,observedAt,pitches:packet.rows.filter(isActualLabPitch).length}));
 return {ok:true,reused:false,key,sourceHash,pitches:packet.rows.filter(isActualLabPitch).length,games:packet.games};
}
