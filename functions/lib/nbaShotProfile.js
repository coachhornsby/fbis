const finite=v=>{if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null};
const norm=s=>String(s||"").toLowerCase();
const round=(v,d=4)=>{const n=finite(v);if(n==null)return null;const p=10**d;return Math.round(n*p)/p};

export function classifyNbaShot(play={}){
 const text=norm((play.type||"")+" "+(play.text||""));
 if(!text||/free throw/.test(text))return null;
 const attempted=/(miss|made|makes|jumper|jump shot|layup|dunk|hook|tip|fadeaway|pullup|floating|floater|3pt|3-point|three point)/.test(text);
 if(!attempted)return null;
 const made=Boolean(play.scoringPlay)||/(made|makes)/.test(text);
 const three=/3pt|3-point|three point/.test(text);
 let zone="midrange";
 if(three)zone="three";
 else if(/dunk|layup|alley oop|tip shot|tip-in/.test(text))zone="rim";
 else if(/hook|floating|floater|driving shot|paint/.test(text))zone="paint";
 else if(/fadeaway|pullup|pull-up|jump shot|jumper/.test(text))zone="midrange";
 return {zone,made,three};
}

export function buildGameShotProfiles(pbpGame={}){
 const byTeam=new Map();
 const row=id=>{
   const k=String(id||"");if(!byTeam.has(k))byTeam.set(k,{teamId:k,attempts:0,makes:0,rimA:0,rimM:0,paintA:0,paintM:0,midA:0,midM:0,threeA:0,threeM:0});
   return byTeam.get(k);
 };
 for(const p of pbpGame.plays||[]){
   const s=classifyNbaShot(p);if(!s)continue;
   const r=row(p.teamId);r.attempts++;if(s.made)r.makes++;
   const prefix=s.zone==="rim"?"rim":s.zone==="paint"?"paint":s.zone==="three"?"three":"mid";
   r[prefix+"A"]++;if(s.made)r[prefix+"M"]++;
 }
 const finalize=r=>({
   ...r,
   rimRate:r.attempts?r.rimA/r.attempts:null,
   paintRate:r.attempts?r.paintA/r.attempts:null,
   midRate:r.attempts?r.midA/r.attempts:null,
   threeRate:r.attempts?r.threeA/r.attempts:null,
   rimPct:r.rimA?r.rimM/r.rimA:null,
   paintPct:r.paintA?r.paintM/r.paintA:null,
   midPct:r.midA?r.midM/r.midA:null,
   threePct:r.threeA?r.threeM/r.threeA:null,
 });
 return Object.fromEntries([...byTeam.entries()].map(([k,v])=>[k,finalize(v)]));
}

export function mergeShotProfileFallback(team={},players=[]){
 const fga=finite(team.fga)??players.reduce((s,p)=>s+(finite(p.fga)||0),0);
 const fgm=finite(team.fgm)??players.reduce((s,p)=>s+(finite(p.fgm)||0),0);
 const tpa=finite(team.tpa)??players.reduce((s,p)=>s+(finite(p.tpa)||0),0);
 const tpm=finite(team.tpm)??players.reduce((s,p)=>s+(finite(p.threes)||0),0);
 const twoA=fga!=null&&tpa!=null?Math.max(0,fga-tpa):null;
 const twoM=fgm!=null&&tpm!=null?Math.max(0,fgm-tpm):null;
 return {
   attempts:fga,threeRate:fga>0&&tpa!=null?tpa/fga:null,
   threePct:tpa>0&&tpm!=null?tpm/tpa:null,
   twoPct:twoA>0&&twoM!=null?twoM/twoA:null,
   rimRate:null,paintRate:null,midRate:null,rimPct:null,paintPct:null,midPct:null,
 };
}

export function summarizeShotHistory(rows=[],side="for"){
 const pref=side==="against"?"oppShot":"shot";
 const keys=["rimRate","paintRate","midRate","threeRate","rimPct","paintPct","midPct","threePct","twoPct"];
 const out={};
 for(const k of keys){
   let n=0,d=0;
   const xs=[...rows].sort((a,b)=>Date.parse(b.date||0)-Date.parse(a.date||0));
   xs.forEach((r,i)=>{const v=finite(r?.[pref]?.[k]);if(v==null)return;const w=Math.pow(.5,i/10);n+=v*w;d+=w});
   out[k]=d?n/d:null;
 }
 return out;
}

export function shotProfileEdge(off={},defAllowed={}){
 const league={rimRate:.33,paintRate:.13,midRate:.18,threeRate:.36,rimPct:.67,paintPct:.48,midPct:.43,threePct:.36,twoPct:.55};
 const out={};
 for(const k of Object.keys(league)){
   const o=finite(off[k]),d=finite(defAllowed[k]),l=league[k];
   out[k]=o==null&&d==null?l:l+.56*((o??l)-l)+.44*((d??l)-l);
 }
 const expectedEfg=(out.threeRate??.36)*(out.threePct??.36)*1.5+(1-(out.threeRate??.36))*(out.twoPct??.55);
 return {...out,expectedEfg:round(expectedEfg)};
}
