import {readFileSync,readdirSync,writeFileSync,mkdirSync} from "node:fs";
const dir=process.argv[2]||"artifacts/parts";
const files=readdirSync(dir,{recursive:true}).filter(f=>/^cbb-fbis-native-v1-predictions-20\d\d\.json$/.test(String(f).split("/").pop()));
const rows=files.flatMap(f=>JSON.parse(readFileSync(dir+"/"+f,"utf8")));
const round=(v,d=3)=>v==null?null:Number(Number(v).toFixed(d));
const num=v=>{if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null};
function metrics(rs,which){let n=0,me=0,te=0,w=0,bias=0;for(const r of rs){const p=r[which];if(!p)continue;const am=r.actualHome-r.actualAway,at=r.actualHome+r.actualAway;n++;me+=Math.abs(p.margin-am);te+=Math.abs(p.total-at);bias+=p.total-at;if((p.margin>0)===(am>0))w++}return n?{n,marginMae:round(me/n),totalMae:round(te/n),totalBias:round(bias/n),winnerAccuracy:round(100*w/n,2)}:{n:0,marginMae:null,totalMae:null,totalBias:null,winnerAccuracy:null}}
function compare(rs){const f=metrics(rs,"fbis"),k=metrics(rs,"kenpom");return{fbis:f,kenpom:k,totalMaeAdvantage:k.totalMae!=null&&f.totalMae!=null?round(k.totalMae-f.totalMae):null,marginMaeAdvantage:k.marginMae!=null&&f.marginMae!=null?round(k.marginMae-f.marginMae):null}}
function betStats(rs,threshold,disagree=false){let n=0,w=0,l=0,p=0,u=0;for(const r of rs){const line=num(r.market?.overUnder);if(line==null)continue;const f=r.fbis.total-line;if(Math.abs(f)<threshold)continue;if(disagree&&r.kenpom){const k=r.kenpom.total-line;if(!k||Math.sign(k)===Math.sign(f))continue}const actual=r.actualHome+r.actualAway-line;n++;if(actual===0){p++;continue}if(Math.sign(actual)===Math.sign(f)){w++;u+=100/110}else{l++;u-=1}}return{n,w,l,p,winPct:w+l?round(100*w/(w+l),2):null,units:round(u),roi:n?round(100*u/n,2):null}}
const seasons=[...new Set(rows.map(r=>Number(r.season)))].sort((a,b)=>a-b);
const discovery=rows.filter(r=>r.season<=2022),validation=rows.filter(r=>r.season===2023||r.season===2024),confirmation=rows.filter(r=>r.season===2025);
const bands=[[0,1,"0-1"],[1,2,"1-2"],[2,3,"2-3"],[3,4,"3-4"],[4,6,"4-6"],[6,8,"6-8"],[8,1e9,"8+"]];
const disagreement={};for(const[lo,hi,name]of bands){const rs=rows.filter(r=>{const d=Math.abs(r.fbis.total-r.kenpom.total);return d>=lo&&d<hi});disagreement[name]={...compare(rs),n:rs.length}}
const marketTests={};for(const t of [2,3,4,5,6])marketTests["totalEdge"+t]={all:betStats(rows,t),validation:betStats(validation,t),confirmation:betStats(confirmation,t),disagreeConfirmation:betStats(confirmation,t,true)};
const report={ok:rows.length>0,id:"FBIS-CBB-RATINGS-v1-WALKFORWARD-PARTITIONED",generatedAt:new Date().toISOString(),seasons,rows:rows.length,
methodology:{partitionedBySeason:true,independent:true,marketInformed:false,kenpomInput:false,torvikInput:false,development:"2018-22",validation:"2023-24",confirmation:"2025"},
samples:{all:compare(rows),discovery:compare(discovery),validation:compare(validation),confirmation:compare(confirmation)},
bySeason:Object.fromEntries(seasons.map(s=>[s,compare(rows.filter(r=>Number(r.season)===s))])),disagreement,marketTests,
promotion:{totalPass:Boolean(compare(validation).totalMaeAdvantage>0&&compare(confirmation).totalMaeAdvantage>0),marginPass:Boolean(compare(validation).marginMaeAdvantage>0&&compare(confirmation).marginMaeAdvantage>0),requiresOperatorApproval:true,canAuthorizeWager:false}};
mkdirSync("artifacts",{recursive:true});writeFileSync("artifacts/cbb-fbis-native-v1-walkforward.json",JSON.stringify(report,null,2));writeFileSync("artifacts/cbb-fbis-native-v2-predictions.json",JSON.stringify(rows));console.log(JSON.stringify(report,null,2));