import { mkdirSync, writeFileSync } from "node:fs";
import { loadNflVerseFeatures } from "../functions/lib/nflVerseFeed.js";

const outDir="artifacts/nfl-features";
mkdirSync(outDir,{recursive:true});

const controller=new AbortController();
const hardTimer=setTimeout(()=>controller.abort("builder-hard-timeout"),8*60*1000);
const fetchFn=(url,opts={})=>fetch(url,{...opts,signal:opts.signal||controller.signal});

try{
  const snapshot=await loadNflVerseFeatures({}, {fetchFn, now:Date.now(), forceNetwork:true});
  if(!snapshot?.meta||!snapshot?.byTeam||Object.keys(snapshot.byTeam).length<20){
    throw new Error(`insufficient NFL snapshot teams=${Object.keys(snapshot?.byTeam||{}).length} meta=${JSON.stringify(snapshot?.meta||{})}`);
  }
  snapshot.meta={...snapshot.meta,builder:"github-actions",buildCommit:process.env.GITHUB_SHA||null,buildRunId:process.env.GITHUB_RUN_ID||null};
  const path=`${outDir}/latest.json`;
  writeFileSync(path,JSON.stringify(snapshot));
  console.log(JSON.stringify({ok:true,path,season:snapshot.season,teams:Object.keys(snapshot.byTeam).length,players:Object.values(snapshot.playersByTeam||{}).reduce((n,x)=>n+x.length,0),meta:snapshot.meta},null,2));
} finally {
  clearTimeout(hardTimer);
}
