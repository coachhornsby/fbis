const env=process.env;
const timeout=ms=>AbortSignal.timeout(ms);
async function get(url,headers={}){try{const r=await fetch(url,{headers,signal:timeout(15000)});const text=await r.text();let body=null;try{body=text?JSON.parse(text):null}catch{}return{status:r.status,ok:r.ok,body,headers:Object.fromEntries([...r.headers].filter(([k])=>/^(x-requests|x-datapoints|x-ratelimit|x-tier|x-markets)/i.test(k)))};}catch(e){return{status:0,ok:false,error:e.name||"fetch-error"}}}
const bookSummary=events=>{const books=new Set(),markets={h2h:0,spreads:0,totals:0};let timestamps=0;
 for(const e of events||[]){if(e.commence_time||e.event_date)timestamps++;for(const b of e.bookmakers||[]){books.add(String(b.key||b.title||"").toLowerCase());for(const m of b.markets||[]){if(m.key in markets)markets[m.key]++;}}}
 return{events:(events||[]).length,books:[...books].sort(),markets,eventStartTimestamps:timestamps};};
const out={generatedAt:new Date().toISOString(),credentials:{parlay:Boolean(env.PARLAY_API_KEY),theodds:Boolean(env.THEODDS_API_KEY),sharpapi:Boolean(env.SHARPAPI_API_KEY),therundown:Boolean(env.THERUNDOWN_API_KEY)},providers:{}};

// Parlay metadata is zero-credit; odds probe is bounded to 3 core markets and <=3 books.
{const sports=await get("https://parlay-api.com/v1/sports",env.PARLAY_API_KEY?{"X-API-Key":env.PARLAY_API_KEY}:{});
 const rows=Array.isArray(sports.body)?sports.body:[];const asian=rows.filter(x=>/npb|kbo|korea|japan/i.test([x.key,x.title,x.description].join(" ")));
 const p={sportsStatus:sports.status,asianSportKeys:asian.map(x=>x.key),probes:{}};
 for(const [league,candidates] of Object.entries({NPB:["baseball_npb","baseball_japan_npb"],KBO:["baseball_kbo","baseball_korea_kbo"]})){
  p.probes[league]=[];
  for(const key of candidates){if(!env.PARLAY_API_KEY){p.probes[league].push({key,skipped:"no-key"});continue}
   const r=await get("https://parlay-api.com/v1/sports/"+key+"/odds?markets=h2h,spreads,totals&bookmakers=pinnacle,draftkings,fanduel",{"X-API-Key":env.PARLAY_API_KEY});
   p.probes[league].push({key,status:r.status,summary:bookSummary(Array.isArray(r.body)?r.body:[]),headers:r.headers,error:r.ok?null:(r.body?.detail||r.body?.error||r.error||"http-error")});
   if(r.ok)break;
  }
 }out.providers.parlay=p;}

// The Odds API: exact public keys. Three core markets, US region, one request per league.
{const p={probes:{}};for(const [league,key] of Object.entries({NPB:"baseball_npb",KBO:"baseball_kbo"})){if(!env.THEODDS_API_KEY){p.probes[league]={key,skipped:"no-key"};continue}
 const u="https://api.the-odds-api.com/v4/sports/"+key+"/odds/?apiKey="+encodeURIComponent(env.THEODDS_API_KEY)+"&regions=us&markets=h2h,spreads,totals&oddsFormat=american";
 const r=await get(u);p.probes[league]={key,status:r.status,summary:bookSummary(Array.isArray(r.body)?r.body:[]),headers:r.headers,error:r.ok?null:(r.body?.message||r.error||"http-error")};}out.providers.theodds=p;}

// TheRundown: metadata first. Only query league when metadata explicitly identifies it.
{const p={sportsStatus:null,matches:[],probes:{}};if(!env.THERUNDOWN_API_KEY){p.skipped="no-key"}else{const r=await get("https://therundown.io/api/v2/sports",{"X-TheRundown-Key":env.THERUNDOWN_API_KEY});p.sportsStatus=r.status;const rows=Array.isArray(r.body)?r.body:(r.body?.sports||[]);p.matches=rows.filter(x=>/npb|kbo|korea|japan/i.test(JSON.stringify(x))).map(x=>({sport_id:x.sport_id||x.id,name:x.name||x.sport_name||x.title}));for(const x of p.matches){const name=String(x.name||"").toUpperCase();const league=name.includes("KBO")?"KBO":name.includes("NPB")?"NPB":null;if(!league||p.probes[league])continue;const q=await get("https://therundown.io/api/v2/sports/"+x.sport_id+"/events/"+new Date().toISOString().slice(0,10)+"?market_ids=1,2,3&affiliate_ids=3,19,22,23,34&main_line=true&hide_closed=true",{"X-TheRundown-Key":env.THERUNDOWN_API_KEY});const ev=q.body?.events||[];p.probes[league]={sportId:x.sport_id,status:q.status,eventCount:ev.length,headers:q.headers};}}out.providers.therundown=p;}

// SharpAPI: only low-cost league probes; one market each is sufficient to establish league acceptance without burning 3x requests.
{const p={probes:{}};for(const [league,key] of Object.entries({NPB:"npb",KBO:"kbo"})){if(!env.SHARPAPI_API_KEY){p.probes[league]={key,skipped:"no-key"};continue}const r=await get("https://api.sharpapi.io/api/v1/odds?league="+key+"&market=moneyline&sportsbook=draftkings,fanduel&limit=50",{"X-Api-Key":env.SHARPAPI_API_KEY,Accept:"application/json"});const rows=Array.isArray(r.body?.data)?r.body.data:[];p.probes[league]={key,status:r.status,rowCount:rows.length,books:[...new Set(rows.map(x=>x.sportsbook).filter(Boolean))],headers:r.headers,error:r.ok?null:(r.body?.error?.message||r.body?.error?.code||r.error||"http-error")};}out.providers.sharpapi=p;}
console.log(JSON.stringify(out,null,2));
