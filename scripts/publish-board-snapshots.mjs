import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {captureScoreboards,boardDate,shiftBoardDate} from '../functions/lib/publicBoardSnapshot.js';
const dir='deploy/board/snapshots';await mkdir(dir,{recursive:true});
const manifests=[];
for(let offset=0;offset<2;offset++){
  const date=shiftBoardDate(boardDate(),offset),board=await captureScoreboards({date});
  // CBB is the reopening priority. Never publish an empty-success response on failure.
  if(!board.feeds.cbb.ok)throw Error('CBB_CAPTURE_FAILED: '+board.feeds.cbb.error);
  const text=JSON.stringify(board);await writeFile(`${dir}/${date}.json`,text);
  manifests.push({date,games:board.games.length,bySport:board.counts.bySport,sourceFailures:board.sources.filter(s=>!s.ok),sha256:createHash('sha256').update(text).digest('hex')});
}
await writeFile(`${dir}/manifest.json`,JSON.stringify({generatedAt:new Date().toISOString(),dates:manifests},null,2));
console.log(JSON.stringify(manifests));
