import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
const out='artifacts/tennis-card-visual';
await mkdir(out,{recursive:true});
const server=await createServer({server:{host:'127.0.0.1',port:4179}});
await server.listen();
let browser;
try {
 browser=await chromium.launch({headless:true});
 const results=[];
 for(const [name,width,height,query] of [['desktop',1440,1200,''],['tablet',768,1100,''],['mobile-long',390,1050,'?long=1'],['mobile-blocked',390,1050,'?blocked=1&long=1']]) {
  const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:4179/test/fixtures/tennis-card-visual.html${query}`,{waitUntil:'networkidle'});
  await page.locator('.tmc').waitFor();
  const metrics=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,
   headings:[...document.querySelectorAll('.tmc-player-copy h2')].map(x=>({name:x.textContent,width:x.clientWidth,scroll:x.scrollWidth})),
   cardWidth:document.querySelector(".tmc").getBoundingClientRect().width,itemWidth:document.querySelector(".db-grid-item-tennis").getBoundingClientRect().width,gridWidth:document.querySelector(".db-grid").getBoundingClientRect().width,
   font:getComputedStyle(document.querySelector(".tmc h2")).fontFamily,
   bar:!!document.querySelector('.tmc-probability-track'),projection:!!document.querySelector('.tmc-projection-panel'),
   transition:getComputedStyle(document.querySelector('.tmc-probability-track>span')||document.querySelector('.tmc')).transitionDuration,
   neutralFlag:!!document.querySelector('img[src*="/ru.png"]')}));
  await page.screenshot({path:`${out}/${name}.png`,fullPage:true});
  results.push({name,...metrics,errors});
  await writeFile(`${out}/metrics.json`,JSON.stringify(results,null,2));
  if(errors.length||metrics.scroll>width+1||metrics.headings.some(x=>x.scroll>x.width+1)||Math.abs(metrics.itemWidth-metrics.gridWidth)>2||!metrics.font.includes("sans-serif")||!metrics.projection||metrics.neutralFlag||metrics.transition!=='0s')throw Error(JSON.stringify(results));
  await page.close();
 }
 await writeFile(`${out}/metrics.json`,JSON.stringify(results,null,2));
 console.log(JSON.stringify(results,null,2));
} finally {await browser?.close();await server.close();}
