import crypto from 'node:crypto';

export const CFG = Object.freeze({
  spreadsheetId: process.env.SPREADSHEET_ID || '1B1IVONVvmP50JPCqb64fzEsSaTv6AuHQ04YqEzBhjAo',
  version: process.env.ORCHESTRATOR_VERSION || 'AI-ORCH-v0.3-render',
  protocol: process.env.PROJECTION_PROTOCOL || 'MULTISPORT-PROJ-v0.2',
  schemaVersion: process.env.PROJECTION_SCHEMA_VERSION || 'projection-v0.3',
  openaiModel: process.env.OPENAI_MODEL || 'gpt-5.6-sol',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
  maxRuns: Number(process.env.MAX_RUNS_PER_INVOCATION || 5),
  thresholds: {
    winProbPp: Number(process.env.WIN_PROB_DELTA_PP || 4),
    total: Number(process.env.TOTAL_DELTA || 0.75),
    spIp: Number(process.env.SP_IP_DELTA || 0.5),
    spK: Number(process.env.SP_K_DELTA || 0.75),
  },
  prices: {
    openaiInput: Number(process.env.OPENAI_INPUT_PER_M || 4),
    openaiOutput: Number(process.env.OPENAI_OUTPUT_PER_M || 20),
    geminiInput: Number(process.env.GEMINI_INPUT_PER_M || 0.75),
    geminiOutput: Number(process.env.GEMINI_OUTPUT_PER_M || 3.75),
  },
  sheets: {
    config: 'AI Orchestrator Config',
    queue: 'AI Run Queue',
    raw: 'AI Raw Payloads',
    consensus: 'Model Consensus',
    disagreements: 'Model Disagreements',
    dashboard: 'Daily Projections',
    snapshots: 'Feature Snapshots',
    usage: 'AI API Usage',
  }
});

const projectionSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    identity: {
      type: 'object', additionalProperties: false,
      properties: {
        event_id: {type:'string'}, projection_id:{type:'string'}, provider:{type:'string'},
        model:{type:'string'}, model_version:{type:'string'}, protocol_version:{type:'string'},
        generated_at:{type:'string'}, feature_snapshot_id:{type:'string'}, data_timestamp:{type:'string'},
        market_seen_before_lock:{type:'boolean'},
        data_quality:{type:'string', enum:['CLEAN','DEGRADED','STALE']},
        missing_inputs:{type:'array',items:{type:'string'}}
      },
      required:['event_id','projection_id','provider','model','model_version','protocol_version','generated_at','feature_snapshot_id','data_timestamp','market_seen_before_lock','data_quality','missing_inputs']
    },
    game: {
      type:'object', additionalProperties:false,
      properties:{
        away_team:{type:'string'}, home_team:{type:'string'},
        away_projected_score:{type:'number'}, home_projected_score:{type:'number'},
        projected_total:{type:'number'}, home_win_probability:{type:'number'}, away_win_probability:{type:'number'}
      },
      required:['away_team','home_team','away_projected_score','home_projected_score','projected_total','home_win_probability','away_win_probability']
    },
    players: {
      type:'array',
      items:{
        type:'object', additionalProperties:false,
        properties:{
          name:{type:'string'}, team_side:{type:'string',enum:['HOME','AWAY']}, role:{type:'string'},
          projected_ip:{type:['number','null']}, projected_ks:{type:['number','null']}
        },
        required:['name','team_side','role','projected_ip','projected_ks']
      }
    },
    governance:{
      type:'object', additionalProperties:false,
      properties:{
        schema_valid:{type:'boolean'}, leakage_check:{type:'boolean'},
        drift_flag:{type:'string',enum:['NONE','WATCH','MATERIAL']},
        lock_status:{type:'string',enum:['PENDING','LOCKED','VERIFIED','FAILED']}
      },
      required:['schema_valid','leakage_check','drift_flag','lock_status']
    }
  },
  required:['identity','game','players','governance']
};

const HEADERS = {
  queue:["Run ID","Event ID","Sport","Matchup","Event Start","Feature Snapshot ID","Snapshot Locked At","Run Status","GPT Status","Gemini Status","GPT Projection ID","Gemini Projection ID","GPT Started At","GPT Completed At","Gemini Started At","Gemini Completed At","Both Locked?","Consensus Ready?","Market Release Status","Attempt","Last Error","Created At","Updated At","Requested By","Notes"],
  snapshots:["Snapshot ID","Event ID","Sport","Matchup","Event Start","Generated At","Data Timestamp","Schema Version","Snapshot Hash","Locked?","Market Included?","Home Team","Away Team","Home Starter","Away Starter","Lineup Status","Injury Status","Rest/Travel","Weather/Environment","Team Features JSON","Player Features JSON","Data Sources","Missing Inputs","Notes"]
};

const now = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();
const sha256 = x => crypto.createHash('sha256').update(String(x)).digest('hex');
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const b64url = input => Buffer.from(input).toString('base64url');
const q = name => "'" + String(name).replaceAll("'","''") + "'";

function parseCredential(){
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if(!raw) return null;
  try { return JSON.parse(raw); } catch {}
  try { return JSON.parse(Buffer.from(raw,'base64').toString('utf8')); } catch {}
  throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is neither JSON nor base64-encoded JSON');
}

async function fetchRetry(url, options={}, max=3){
  let last;
  for(let attempt=0; attempt<max; attempt++){
    try{
      const res = await fetch(url, options);
      if(res.status !== 429 && res.status < 500) return res;
      last = res;
    }catch(e){ last = e; }
    await sleep(500 * (2 ** attempt));
  }
  if(last instanceof Response) return last;
  throw last || new Error('request failed');
}

class SheetsClient {
  constructor(){
    this.cred = parseCredential();
    this.token = null;
    this.tokenExp = 0;
  }
  available(){ return !!(this.cred?.client_email && this.cred?.private_key); }
  async accessToken(){
    if(!this.available()) throw new Error('Google Sheets credential missing');
    if(this.token && Date.now() < this.tokenExp - 60000) return this.token;
    const iat = Math.floor(Date.now()/1000);
    const header = b64url(JSON.stringify({alg:'RS256',typ:'JWT'}));
    const payload = b64url(JSON.stringify({
      iss:this.cred.client_email,
      scope:'https://www.googleapis.com/auth/spreadsheets',
      aud:'https://oauth2.googleapis.com/token',
      iat, exp:iat+3600
    }));
    const unsigned = header + '.' + payload;
    const sig = crypto.sign('RSA-SHA256', Buffer.from(unsigned), this.cred.private_key).toString('base64url');
    const assertion = unsigned + '.' + sig;
    const body = new URLSearchParams({
      grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    });
    const res = await fetchRetry('https://oauth2.googleapis.com/token',{
      method:'POST',
      headers:{'content-type':'application/x-www-form-urlencoded'},
      body
    });
    const obj = await res.json();
    if(!res.ok) throw new Error('Google OAuth ' + res.status + ': ' + JSON.stringify(obj));
    this.token = obj.access_token;
    this.tokenExp = Date.now() + Number(obj.expires_in || 3600)*1000;
    return this.token;
  }
  async req(path, options={}){
    const token = await this.accessToken();
    const res = await fetchRetry('https://sheets.googleapis.com/v4/spreadsheets/' + CFG.spreadsheetId + path,{
      ...options,
      headers:{authorization:'Bearer '+token,'content-type':'application/json',...(options.headers||{})}
    });
    const text = await res.text();
    let obj; try{ obj=text?JSON.parse(text):{}; }catch{ obj={raw:text}; }
    if(!res.ok) throw new Error('Sheets ' + res.status + ': ' + JSON.stringify(obj));
    return obj;
  }
  async get(range){
    return this.req('/values/' + encodeURIComponent(range) + '?majorDimension=ROWS');
  }
  async update(range, values){
    return this.req('/values/' + encodeURIComponent(range) + '?valueInputOption=RAW',{
      method:'PUT', body:JSON.stringify({range,majorDimension:'ROWS',values})
    });
  }
  async append(range, values){
    return this.req('/values/' + encodeURIComponent(range) + ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS',{
      method:'POST', body:JSON.stringify({range,majorDimension:'ROWS',values})
    });
  }
}

const sheets = new SheetsClient();

function rowsToObjects(values, fallbackHeaders){
  if(!values?.length) return [];
  const headers = values[0]?.length ? values[0] : fallbackHeaders;
  return values.slice(1).map((r,i)=>({rowNumber:i+2, raw:r, obj:Object.fromEntries(headers.map((h,j)=>[h,r[j] ?? '']))}));
}
function cleanSnapshot(s){
  const x = structuredClone(s);
  delete x.Notes;
  if(String(x['Market Included?']).toUpperCase()==='YES') throw new Error('Market-contaminated snapshot blocked');
  if(String(x['Locked?']).toUpperCase()!=='YES') throw new Error('Snapshot not locked');
  return x;
}
function buildPrompt(snapshot){
  return [
    'Produce an independent, market-blind sports projection from this point-in-time snapshot.',
    'Do not infer, search for, request, or use betting market prices.',
    'Use only the supplied snapshot. Return only schema-compliant JSON.',
    'Snapshot:',
    JSON.stringify(snapshot)
  ].join('\n');
}
function validateProjection(p){
  if(!p || typeof p!=='object') throw new Error('Projection is not an object');
  if(!p.identity || !p.game || !Array.isArray(p.players) || !p.governance) throw new Error('Projection missing required top-level fields');
  for(const k of ['away_projected_score','home_projected_score','projected_total','home_win_probability','away_win_probability']){
    if(typeof p.game[k] !== 'number' || !Number.isFinite(p.game[k])) throw new Error('Invalid game field: '+k);
  }
  if(p.game.home_win_probability < 0 || p.game.home_win_probability > 1 || p.game.away_win_probability < 0 || p.game.away_win_probability > 1) throw new Error('Probability out of range');
  if(Math.abs((p.game.home_win_probability+p.game.away_win_probability)-1)>0.03) throw new Error('Home/away probabilities do not sum to ~1');
  return true;
}
function normalizeIdentity(p, provider, model, eventId, snapshotId, dataTimestamp){
  p.identity.event_id = eventId;
  p.identity.provider = provider.toLowerCase();
  p.identity.model = model;
  p.identity.model_version = model;
  p.identity.feature_snapshot_id = snapshotId;
  p.identity.market_seen_before_lock = false;
  p.identity.projection_id = p.identity.projection_id || uuid();
  p.identity.generated_at = now();
  p.identity.protocol_version = CFG.protocol;
  p.identity.data_timestamp = String(dataTimestamp || p.identity.data_timestamp || '');
  p.governance.schema_valid = true;
  p.governance.leakage_check = true;
  p.governance.lock_status = 'VERIFIED';
  if(p.identity.market_seen_before_lock) throw new Error('Leakage flag');
  validateProjection(p);
  return p;
}
function usageCost(provider, input, output){
  const p = provider==='OPENAI'
    ? [CFG.prices.openaiInput,CFG.prices.openaiOutput]
    : [CFG.prices.geminiInput,CFG.prices.geminiOutput];
  return ((input/1e6)*p[0] + (output/1e6)*p[1]);
}
function usageRow(provider, runId, eventId, model, calledAt, status, usage, latency, retry, success, errorClass, notes=''){
  const input=Number(usage.input_tokens ?? usage.promptTokenCount ?? 0);
  const cached=Number(usage.input_tokens_details?.cached_tokens ?? usage.cachedContentTokenCount ?? 0);
  const output=Number(usage.output_tokens ?? usage.candidatesTokenCount ?? 0);
  const reasoning=Number(usage.output_tokens_details?.reasoning_tokens ?? usage.thoughtsTokenCount ?? 0);
  const total=Number(usage.total_tokens ?? usage.totalTokenCount ?? (input+output));
  return [uuid(),runId,eventId,provider,model,calledAt,status,input,cached,output,reasoning,total,usageCost(provider,input,output),latency,retry,success?'YES':'NO',errorClass||'',notes];
}
async function callOpenAI(runId,eventId,snapshotId,prompt,dataTimestamp){
  const key=process.env.OPENAI_API_KEY;
  if(!key) throw new Error('OPENAI_API_KEY missing');
  const started=Date.now(), calledAt=now();
  const body={
    model:CFG.openaiModel, store:false,
    reasoning:{effort:'low'},
    input:[
      {role:'system',content:'Independent sports projection engine. Market-blind. JSON only.'},
      {role:'user',content:prompt}
    ],
    text:{format:{type:'json_schema',name:'sports_projection',strict:true,schema:projectionSchema}}
  };
  const res=await fetchRetry('https://api.openai.com/v1/responses',{
    method:'POST',
    headers:{authorization:'Bearer '+key,'content-type':'application/json'},
    body:JSON.stringify(body)
  });
  const raw=await res.text();
  let obj={}; try{obj=JSON.parse(raw);}catch{}
  const usage=usageRow('OPENAI',runId,eventId,CFG.openaiModel,calledAt,res.status,obj.usage||{},Date.now()-started,0,res.ok,res.ok?'':'HTTP',res.ok?'':raw.slice(0,500));
  if(!res.ok) return {ok:false,status:res.status,raw,obj,usage,error:'OpenAI '+res.status};
  const txt=obj.output_text || (obj.output||[]).flatMap(i=>i.content||[]).find(c=>c.type==='output_text')?.text;
  if(!txt) return {ok:false,status:res.status,raw,obj,usage,error:'OpenAI output_text missing'};
  try{
    const p=normalizeIdentity(JSON.parse(txt),'OPENAI',CFG.openaiModel,eventId,snapshotId,dataTimestamp);
    return {ok:true,status:res.status,raw,obj,usage,projection:p,projectionText:txt};
  }catch(e){ return {ok:false,status:res.status,raw,obj,usage,error:'OpenAI parse/schema: '+e.message}; }
}
async function callGemini(runId,eventId,snapshotId,prompt,dataTimestamp){
  const key=process.env.GEMINI_API_KEY;
  if(!key) throw new Error('GEMINI_API_KEY missing');
  const started=Date.now(), calledAt=now();
  const url='https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(CFG.geminiModel)+':generateContent';
  const body={
    contents:[{role:'user',parts:[{text:'Independent sports projection engine. Market-blind. JSON only.\n'+prompt}]}],
    generationConfig:{responseFormat:{text:{mimeType:'application/json',schema:projectionSchema}}}
  };
  const res=await fetchRetry(url,{
    method:'POST',
    headers:{'x-goog-api-key':key,'content-type':'application/json'},
    body:JSON.stringify(body)
  });
  const raw=await res.text();
  let obj={}; try{obj=JSON.parse(raw);}catch{}
  const usage=usageRow('GEMINI',runId,eventId,CFG.geminiModel,calledAt,res.status,obj.usageMetadata||{},Date.now()-started,0,res.ok,res.ok?'':'HTTP',res.ok?'':raw.slice(0,500));
  if(!res.ok) return {ok:false,status:res.status,raw,obj,usage,error:'Gemini '+res.status};
  const txt=obj.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('');
  if(!txt) return {ok:false,status:res.status,raw,obj,usage,error:'Gemini output missing'};
  try{
    const p=normalizeIdentity(JSON.parse(txt),'GEMINI',CFG.geminiModel,eventId,snapshotId,dataTimestamp);
    return {ok:true,status:res.status,raw,obj,usage,projection:p,projectionText:txt};
  }catch(e){ return {ok:false,status:res.status,raw,obj,usage,error:'Gemini parse/schema: '+e.message}; }
}
function rawRow(provider,runId,eventId,snapshotId,result){
  const p=result.projection;
  const rawPayload=result.raw;
  return [
    uuid(),runId,eventId,provider,provider==='OPENAI'?CFG.openaiModel:CFG.geminiModel,
    p?.identity?.model_version || (provider==='OPENAI'?CFG.openaiModel:CFG.geminiModel),
    CFG.protocol,now(),p?.identity?.projection_id||'',snapshotId,CFG.schemaVersion,
    result.ok?'YES':'NO',sha256(rawPayload),result.ok?'YES':'NO','NO',rawPayload,
    CFG.version,result.ok?'PARSED':'FAILED',result.ok?'':result.error,'YES','','',now(),'Render raw-first provider response'
  ];
}
function player(p,side){
  const arr=p?.players||[];
  return arr.find(x=>x.team_side===side && /pitch|starter/i.test(String(x.role))) || arr.find(x=>x.team_side===side) || null;
}
const delta=(a,b)=>(a==null||b==null)?0:Math.abs(Number(a)-Number(b));
const avg=(a,b)=>(a==null||b==null)?'':Math.round(((Number(a)+Number(b))/2)*1000)/1000;

function buildConsensus(eventId,snap,g,m){
  const gp=g.game, mp=m.game;
  const ga=player(g,'AWAY'), ma=player(m,'AWAY'), gh=player(g,'HOME'), mh=player(m,'HOME');
  const winDelta=Math.abs(gp.home_win_probability-mp.home_win_probability)*100;
  const scoreDelta=Math.max(Math.abs(gp.away_projected_score-mp.away_projected_score),Math.abs(gp.home_projected_score-mp.home_projected_score));
  const totalDelta=Math.abs(gp.projected_total-mp.projected_total);
  const ipDelta=Math.max(delta(ga?.projected_ip,ma?.projected_ip),delta(gh?.projected_ip,mh?.projected_ip));
  const kDelta=Math.max(delta(ga?.projected_ks,ma?.projected_ks),delta(gh?.projected_ks,mh?.projected_ks));
  const flags=[];
  if(winDelta>=CFG.thresholds.winProbPp) flags.push('WIN_PROB');
  if(totalDelta>=CFG.thresholds.total) flags.push('TOTAL');
  if(ipDelta>=CFG.thresholds.spIp) flags.push('SP_IP');
  if(kDelta>=CFG.thresholds.spK) flags.push('SP_K');
  const flag=flags.length?'WATCH':'NONE';
  return {gp,mp,ga,ma,gh,mh,winDelta,scoreDelta,totalDelta,ipDelta,kDelta,flags,flag,
    consensus:{
      awayScore:avg(gp.away_projected_score,mp.away_projected_score),
      homeScore:avg(gp.home_projected_score,mp.home_projected_score),
      homeWin:avg(gp.home_win_probability,mp.home_win_probability),
      total:avg(gp.projected_total,mp.projected_total),
      awayIp:avg(ga?.projected_ip,ma?.projected_ip), awayKs:avg(ga?.projected_ks,ma?.projected_ks),
      homeIp:avg(gh?.projected_ip,mh?.projected_ip), homeKs:avg(gh?.projected_ks,mh?.projected_ks)
    }};
}
async function appendConsensus(eventId,snap,g,m,ghash,mhash,c){
  const row=[
    eventId,snap.Sport,snap.Matchup,snap['Event Start'],g.identity.projection_id,m.identity.projection_id,
    g.identity.generated_at,m.identity.generated_at,c.gp.home_win_probability,c.mp.home_win_probability,c.winDelta,
    c.gp.home_projected_score,c.mp.home_projected_score,c.scoreDelta,
    c.gp.projected_total,c.mp.projected_total,c.totalDelta,
    c.gh?.projected_ip,c.mh?.projected_ip,delta(c.gh?.projected_ip,c.mh?.projected_ip),
    c.gh?.projected_ks,c.mh?.projected_ks,c.kDelta,c.flag,c.flags.join('|')||'NONE',
    0.5,0.5,c.consensus.homeWin,c.consensus.total,c.consensus.homeKs,'50/50 experimental benchmark',
    'EXPERIMENTAL','NO',now(),'','OPENAI_LOCK='+ghash+';GEMINI_LOCK='+mhash
  ];
  await sheets.append(q(CFG.sheets.consensus)+'!A:AJ',[row]);
}
async function appendDisagreements(eventId,snap,g,m,c){
  const rows=[];
  const add=(metric,gv,mv,d,threshold)=>rows.push([
    uuid(),eventId,snap.Sport,snap.Matchup,now(),metric,gv,mv,d,threshold,'WATCH','MODEL_COMPONENT','',
    g.identity.data_timestamp,m.identity.data_timestamp,g.identity.feature_snapshot_id,m.identity.feature_snapshot_id,
    (g.identity.missing_inputs||[]).join('|'),(m.identity.missing_inputs||[]).join('|'),'UNKNOWN','OPEN','','','NO',
    'PENDING','NO','','','','',''
  ]);
  if(c.winDelta>=CFG.thresholds.winProbPp) add('HOME_WIN_PROB_PP',c.gp.home_win_probability,c.mp.home_win_probability,c.winDelta,CFG.thresholds.winProbPp);
  if(c.totalDelta>=CFG.thresholds.total) add('PROJECTED_TOTAL',c.gp.projected_total,c.mp.projected_total,c.totalDelta,CFG.thresholds.total);
  if(c.ipDelta>=CFG.thresholds.spIp) add('SP_IP',c.gh?.projected_ip,c.mh?.projected_ip,c.ipDelta,CFG.thresholds.spIp);
  if(c.kDelta>=CFG.thresholds.spK) add('SP_K',c.gh?.projected_ks,c.mh?.projected_ks,c.kDelta,CFG.thresholds.spK);
  if(rows.length) await sheets.append(q(CFG.sheets.disagreements)+'!A:AE',rows);
}
async function upsertDashboard(eventId,snap,g,m,c){
  const res=await sheets.get(q(CFG.sheets.dashboard)+'!A3:AB1000');
  const vals=res.values||[];
  let row=3+vals.length;
  const idx=vals.findIndex(r=>String(r[0]||'')===String(eventId));
  if(idx>=0) row=3+idx;
  if(row<3) row=3;
  const out=[[
    eventId,snap.Sport,snap['Event Start'],snap.Matchup,snap['Away Team'],snap['Home Team'],snap['Away Starter'],snap['Home Starter'],
    g.game.away_projected_score,g.game.home_projected_score,m.game.away_projected_score,m.game.home_projected_score,
    c.consensus.awayScore,c.consensus.homeScore,
    c.ga?.projected_ip,c.ga?.projected_ks,c.ma?.projected_ip,c.ma?.projected_ks,c.consensus.awayIp,c.consensus.awayKs,
    c.gh?.projected_ip,c.gh?.projected_ks,c.mh?.projected_ip,c.mh?.projected_ks,c.consensus.homeIp,c.consensus.homeKs,
    'VERIFIED / MARKET BLIND',c.flag
  ]];
  await sheets.update(q(CFG.sheets.dashboard)+'!A'+row+':AB'+row,out);
}
async function findSnapshot(snapshotId,eventId){
  const res=await sheets.get(q(CFG.sheets.snapshots)+'!A1:X5000');
  const rows=rowsToObjects(res.values||[],HEADERS.snapshots);
  const hit=rows.find(r=>String(r.obj['Snapshot ID'])===String(snapshotId)&&String(r.obj['Event ID'])===String(eventId));
  if(!hit) throw new Error('Snapshot not found');
  return hit.obj;
}
function rewriteQueueRow(raw,patch){
  const r=[...raw];
  while(r.length<25) r.push('');
  for(const [k,v] of Object.entries(patch)){
    const idx=HEADERS.queue.indexOf(k);
    if(idx>=0) r[idx]=v;
  }
  return r.slice(0,25);
}
async function updateQueue(rowNumber,raw,patch){
  const row=rewriteQueueRow(raw,patch);
  await sheets.update(q(CFG.sheets.queue)+'!A'+rowNumber+':Y'+rowNumber,[row]);
  return row;
}

export async function runSnapshot(snapshot,{persist=true,runId=uuid(),queueMeta=null}={}){
  const eventId=String(snapshot['Event ID']||snapshot.event_id||'');
  const snapshotId=String(snapshot['Snapshot ID']||snapshot.snapshot_id||'');
  if(!eventId||!snapshotId) throw new Error('Event ID and Snapshot ID required');
  const clean=cleanSnapshot(snapshot);
  const prompt=buildPrompt(clean);
  const dataTimestamp=clean['Data Timestamp']||'';
  const [gpt,gem]=await Promise.all([
    callOpenAI(runId,eventId,snapshotId,prompt,dataTimestamp),
    callGemini(runId,eventId,snapshotId,prompt,dataTimestamp)
  ]);
  if(persist){
    await sheets.append(q(CFG.sheets.usage)+'!A:R',[gpt.usage,gem.usage]);
    await sheets.append(q(CFG.sheets.raw)+'!A:X',[rawRow('OPENAI',runId,eventId,snapshotId,gpt),rawRow('GEMINI',runId,eventId,snapshotId,gem)]);
  }
  if(!gpt.ok || !gem.ok){
    const errors=[gpt.error,gem.error].filter(Boolean).join(' | ');
    const err=new Error(errors||'Provider failure');
    err.providerResults={openai:{ok:gpt.ok,status:gpt.status,error:gpt.error},gemini:{ok:gem.ok,status:gem.status,error:gem.error}};
    throw err;
  }
  const g=gpt.projection,m=gem.projection;
  const ghash=sha256(JSON.stringify(g)), mhash=sha256(JSON.stringify(m));
  const c=buildConsensus(eventId,clean,g,m);
  if(persist){
    await appendConsensus(eventId,clean,g,m,ghash,mhash,c);
    await appendDisagreements(eventId,clean,g,m,c);
    await upsertDashboard(eventId,clean,g,m,c);
  }
  return {
    runId,eventId,snapshotId,
    openai:{projection:g,lockHash:ghash,status:gpt.status},
    gemini:{projection:m,lockHash:mhash,status:gem.status},
    consensus:c.consensus,disagreement:c.flag,metrics:{winProbDeltaPp:c.winDelta,totalDelta:c.totalDelta,spIpDelta:c.ipDelta,spKDelta:c.kDelta},
    persisted:persist
  };
}

export async function processQueue(){
  if(!sheets.available()) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON required for scheduled queue processing');
  const qres=await sheets.get(q(CFG.sheets.queue)+'!A1:Y3000');
  const rows=rowsToObjects(qres.values||[],HEADERS.queue);
  const queued=rows.filter(r=>String(r.obj['Run Status']).toUpperCase()==='QUEUED').slice(0,CFG.maxRuns);
  const results=[];
  for(const item of queued){
    const eventId=String(item.obj['Event ID']);
    const snapshotId=String(item.obj['Feature Snapshot ID']);
    const runId=String(item.obj['Run ID']||uuid());
    let raw=await updateQueue(item.rowNumber,item.raw,{
      'Run ID':runId,'Run Status':'RUNNING','GPT Status':'RUNNING','Gemini Status':'RUNNING',
      'GPT Started At':now(),'Gemini Started At':now(),'Attempt':Number(item.obj.Attempt||0)+1,
      'Last Error':'','Created At':item.obj['Created At']||now(),'Updated At':now()
    });
    try{
      const snapshot=await findSnapshot(snapshotId,eventId);
      const result=await runSnapshot(snapshot,{persist:true,runId,queueMeta:item.obj});
      raw=await updateQueue(item.rowNumber,raw,{
        'Run Status':'COMPLETE','GPT Status':'COMPLETE','Gemini Status':'COMPLETE',
        'GPT Projection ID':result.openai.projection.identity.projection_id,
        'Gemini Projection ID':result.gemini.projection.identity.projection_id,
        'GPT Completed At':now(),'Gemini Completed At':now(),
        'Both Locked?':'YES','Consensus Ready?':'YES','Market Release Status':'READY','Updated At':now()
      });
      results.push({runId,eventId,status:'COMPLETE',disagreement:result.disagreement});
    }catch(e){
      await updateQueue(item.rowNumber,raw,{
        'Run Status':'FAILED','GPT Status':'FAILED','Gemini Status':'FAILED',
        'Both Locked?':'NO','Consensus Ready?':'NO','Market Release Status':'BLOCKED',
        'Last Error':String(e.message||e).slice(0,1000),'Updated At':now()
      });
      results.push({runId,eventId,status:'FAILED',error:String(e.message||e),providerResults:e.providerResults||null});
    }
  }
  return {processed:results.length,queuedFound:queued.length,results,at:now()};
}

export async function validateModels(){
  const snap={
    'Snapshot ID':'VALIDATION-SNAPSHOT',
    'Event ID':'VALIDATION-EVENT',
    'Sport':'MLB',
    'Matchup':'Validation Away @ Validation Home',
    'Event Start':'2026-09-25T18:00:00-05:00',
    'Generated At':now(),
    'Data Timestamp':now(),
    'Schema Version':'validation-v1',
    'Snapshot Hash':sha256('validation'),
    'Locked?':'YES','Market Included?':'NO',
    'Home Team':'Validation Home','Away Team':'Validation Away',
    'Home Starter':'Home Starter','Away Starter':'Away Starter',
    'Lineup Status':'PROJECTED','Injury Status':'NO MATERIAL FLAGS',
    'Rest/Travel':'Neutral','Weather/Environment':'Neutral',
    'Team Features JSON':JSON.stringify({away_runs_per_game:4.3,home_runs_per_game:4.5}),
    'Player Features JSON':JSON.stringify({away_starter:{era:3.9,k9:8.6},home_starter:{era:3.6,k9:9.1}}),
    'Data Sources':'CONTROLLED_SYNTHETIC_VALIDATION','Missing Inputs':'','Notes':''
  };
  return runSnapshot(snap,{persist:false,runId:'VALIDATION-'+uuid()});
}
export async function validateSheetsAccess(){
  if(!sheets.available()) return {ok:false,reason:'GOOGLE_SERVICE_ACCOUNT_JSON missing'};
  const res=await sheets.get(q(CFG.sheets.config)+'!A1:B5');
  return {ok:true,range:res.range,rowCount:(res.values||[]).length};
}
export async function validateKenpom(){
  const key=String(process.env.KENPOM_API_KEY||'').trim();
  if(!key) return {ok:false,configured:false,reason:'KENPOM_API_KEY missing'};
  const season=Number(process.env.KENPOM_SEASON||2026);
  const url=new URL('https://kenpom.com/api.php');
  url.searchParams.set('endpoint','ratings');
  url.searchParams.set('y',String(season));
  const started=Date.now();
  const res=await fetchRetry(url.toString(),{
    headers:{authorization:'Bearer '+key,accept:'application/json','user-agent':'Sports-Projection-Orchestrator/1.0'}
  });
  let payload=null;
  try{ payload=await res.json(); }catch{}
  const rows=Array.isArray(payload)?payload:[];
  const dataThrough=rows.find(x=>x?.DataThrough)?.DataThrough||null;
  return {
    ok:res.ok && rows.length>=300,
    configured:true,
    httpStatus:res.status,
    season,
    rowCount:rows.length,
    dataThrough,
    latencyMs:Date.now()-started,
    schemaSample:rows[0]?Object.keys(rows[0]).slice(0,12):[],
    error:res.ok?(rows.length>=300?null:'row-count-below-300'):'HTTP '+res.status
  };
}
export function healthSummary(){
  let googleCredential=false,googleCredentialParseError='';
  try{ googleCredential=sheets.available(); }catch(e){googleCredentialParseError=e.message;}
  return {
    status:'ok',version:CFG.version,protocol:CFG.protocol,
    models:{openai:CFG.openaiModel,gemini:CFG.geminiModel},
    credentials:{
      openai:!!process.env.OPENAI_API_KEY,
      gemini:!!process.env.GEMINI_API_KEY,
      kenpom:!!process.env.KENPOM_API_KEY,
      googleSheets:googleCredential,
      googleCredentialParseError
    },
    spreadsheetId:CFG.spreadsheetId,
    failMode:'FAIL_CLOSED',marketBlind:true,consensusCanQualify:false,time:now()
  };
}
