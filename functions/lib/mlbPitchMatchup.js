/**
 * MLB pitch-shape x hitter-contact-zone research engine.
 *
 * Pure projection feature layer. No sportsbook prices or ACTION inputs.
 * Converts Statcast pitch-level rows into pitcher arsenal profiles, hitter
 * contact-zone profiles, lineup strikeout expectation, and starter run factor.
 */

export const MLB_PITCH_MATCHUP_VERSION = "research-v1-statcast-arsenal-zone";

const BASE = Object.freeze({
  xwoba: 0.320,
  hardHit: 0.385,
  barrel: 0.080,
  whiffPerSwing: 0.245,
  contactPerSwing: 0.755,
});

function finite(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function mean(items, fallback = null) {
  const xs = items.filter((v)=>Number.isFinite(v));
  return xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : fallback;
}
function safeDiv(a,b,fallback=0){ return Number.isFinite(a)&&Number.isFinite(b)&&b>0?a/b:fallback; }
function logistic(x){ return 1/(1+Math.exp(-x)); }
function logit(p){ const q=clamp(Number(p)||0.5,0.01,0.99); return Math.log(q/(1-q)); }

export function pitchFamily(pitchType) {
  const p = String(pitchType || "").toUpperCase();
  if (["FF","FA"].includes(p)) return "four_seam";
  if (["SI","FT"].includes(p)) return "sinker";
  if (p === "FC") return "cutter";
  if (["SL","ST","SV"].includes(p)) return "slider_sweeper";
  if (["CU","KC","CS"].includes(p)) return "curve";
  if (["CH","FS","FO","SC"].includes(p)) return "change_split";
  if (["KN","EP"].includes(p)) return "other";
  return p ? "other" : "unknown";
}

export function plateZone(row = {}) {
  const x = finite(row.plate_x);
  const z = finite(row.plate_z);
  const top = finite(row.sz_top);
  const bot = finite(row.sz_bot);
  if (x == null || z == null || top == null || bot == null || top <= bot) {
    const zone = Number(row.zone);
    if (zone >= 1 && zone <= 9) return `zone_${zone}`;
    if (zone >= 11 && zone <= 14) return "chase";
    return "unknown";
  }
  const halfWidth = 0.83;
  if (z > top) return "chase_above";
  if (z < bot) return "chase_below";
  if (x < -halfWidth) return "chase_left";
  if (x > halfWidth) return "chase_right";
  const xr = (x + halfWidth) / (halfWidth * 2);
  const zr = (z - bot) / (top - bot);
  const h = xr < 1/3 ? "left" : xr > 2/3 ? "right" : "middle";
  const v = zr < 1/3 ? "low" : zr > 2/3 ? "high" : "middle";
  return `${v}_${h}`;
}

function rowWeight(row, asOf, halfLifeDays = 45) {
  const d = Date.parse(row.game_date || "");
  const t = Date.parse(asOf || "");
  if (!Number.isFinite(d) || !Number.isFinite(t)) return 1;
  const ageDays = Math.max(0, (t - d) / 86400000);
  return Math.pow(0.5, ageDays / halfLifeDays);
}

function swing(row = {}) {
  const d = String(row.description || "").toLowerCase();
  return row.type === "X" || /swinging|foul|hit_into_play/.test(d);
}
function whiff(row = {}) {
  return /swinging_strike/.test(String(row.description || "").toLowerCase());
}
function batted(row = {}) {
  return row.type === "X" || row.launch_speed != null || row.estimated_woba_using_speedangle != null;
}
function strikeoutEvent(row = {}) {
  const e = String(row.events || "").toLowerCase();
  return e === "strikeout" || e === "strikeout_double_play";
}
function paEvent(row = {}) { return Boolean(String(row.events || "").trim()); }

function emptyBucket() {
  return {
    weight:0,pitches:0,swings:0,whiffs:0,contacts:0,batted:0,hardHit:0,barrels:0,
    xwobaSum:0,xwobaWeight:0,veloSum:0,veloWeight:0,spinSum:0,spinWeight:0,
    pfxXSum:0,pfxXWeight:0,pfxZSum:0,pfxZWeight:0,extSum:0,extWeight:0,
  };
}
function addWeighted(bucket, keySum, keyWeight, value, w) {
  const n = finite(value);
  if (n == null) return;
  bucket[keySum] += n*w;
  bucket[keyWeight] += w;
}
function finalizeBucket(b) {
  const sw = b.swings || 0;
  return {
    pitches:b.pitches,
    weight:b.weight,
    swingRate:safeDiv(b.swings,b.weight,null),
    whiffPerSwing:safeDiv(b.whiffs,sw,null),
    contactPerSwing:safeDiv(b.contacts,sw,null),
    hardHitRate:safeDiv(b.hardHit,b.batted,null),
    barrelRate:safeDiv(b.barrels,b.batted,null),
    xwoba:b.xwobaWeight>0?b.xwobaSum/b.xwobaWeight:null,
    velocity:b.veloWeight>0?b.veloSum/b.veloWeight:null,
    spin:b.spinWeight>0?b.spinSum/b.spinWeight:null,
    pfxX:b.pfxXWeight>0?b.pfxXSum/b.pfxXWeight:null,
    pfxZ:b.pfxZWeight>0?b.pfxZSum/b.pfxZWeight:null,
    extension:b.extWeight>0?b.extSum/b.extWeight:null,
  };
}

export function buildStatcastProfiles(rows = [], { role = "batter", asOf = new Date().toISOString() } = {}) {
  const byPlayer = new Map();
  for (const row of rows || []) {
    const id = Number(role === "pitcher" ? row.pitcher : row.batter);
    if (!Number.isFinite(id)) continue;
    if (!byPlayer.has(id)) byPlayer.set(id,{ id, role, buckets:new Map(), family:new Map(), global:emptyBucket(), pa:0, k:0, paWeight:0, kWeight:0 });
    const p = byPlayer.get(id);
    const fam = pitchFamily(row.pitch_type);
    const zone = plateZone(row);
    const key = `${fam}|${zone}`;
    if (!p.buckets.has(key)) p.buckets.set(key,emptyBucket());
    if (!p.family.has(fam)) p.family.set(fam,emptyBucket());
    const targets=[p.buckets.get(key),p.family.get(fam),p.global];
    const w=rowWeight(row,asOf);
    for(const b of targets){
      b.weight+=w;b.pitches+=1;
      if(swing(row)){b.swings+=w;if(whiff(row))b.whiffs+=w;else b.contacts+=w;}
      if(batted(row)){
        b.batted+=w;
        const ev=finite(row.launch_speed);if(ev!=null&&ev>=95)b.hardHit+=w;
        if(Number(row.launch_speed_angle)===6)b.barrels+=w;
        addWeighted(b,"xwobaSum","xwobaWeight",row.estimated_woba_using_speedangle ?? row.woba_value,w);
      }
      addWeighted(b,"veloSum","veloWeight",row.release_speed,w);
      addWeighted(b,"spinSum","spinWeight",row.release_spin_rate ?? row.release_spin,w);
      addWeighted(b,"pfxXSum","pfxXWeight",row.pfx_x,w);
      addWeighted(b,"pfxZSum","pfxZWeight",row.pfx_z,w);
      addWeighted(b,"extSum","extWeight",row.release_extension,w);
    }
    if(paEvent(row)){p.pa+=1;p.paWeight+=w;if(strikeoutEvent(row)){p.k+=1;p.kWeight+=w;}}
  }
  const out={};
  for(const [id,p] of byPlayer){
    const global=finalizeBucket(p.global);
    const buckets={};for(const [k,b] of p.buckets)buckets[k]=finalizeBucket(b);
    const family={};for(const [k,b] of p.family)family[k]=finalizeBucket(b);
    out[String(id)]={
      id,role,global,buckets,family,
      kRate:p.paWeight>0?p.kWeight/p.paWeight:null,
      plateAppearances:p.pa,
      weightedPlateAppearances:p.paWeight,
      pitches:p.global.pitches,
    };
  }
  return out;
}

function profileBucket(profile,family,zone){
  return profile?.buckets?.[`${family}|${zone}`] || profile?.family?.[family] || profile?.global || null;
}
function dynamicDifficulty(pitcherBucket,batterBucket){
  if(!pitcherBucket||!batterBucket)return 0;
  const velo=((finite(pitcherBucket.velocity)-finite(batterBucket.velocity))||0)/3;
  const spin=((finite(pitcherBucket.spin)-finite(batterBucket.spin))||0)/350;
  const pm=Math.hypot(finite(pitcherBucket.pfxX)||0,finite(pitcherBucket.pfxZ)||0);
  const bm=Math.hypot(finite(batterBucket.pfxX)||0,finite(batterBucket.pfxZ)||0);
  const move=(pm-bm)/0.35;
  const ext=((finite(pitcherBucket.extension)-finite(batterBucket.extension))||0)/1.2;
  return clamp(velo*0.35+spin*0.20+move*0.30+ext*0.15,-2,2);
}

export function scorePitcherVsBatter(pitcherProfile,batterProfile){
  if(!pitcherProfile?.global||!batterProfile?.global)return null;
  const entries=Object.entries(pitcherProfile.buckets||{}).filter(([,b])=>(b?.weight||0)>0);
  if(!entries.length)return null;
  const totalWeight=entries.reduce((s,[,b])=>s+(b.weight||0),0)||1;
  let whiff=0,contact=0,xwoba=0,hardHit=0,barrel=0,dynamic=0,coverage=0;
  for(const [key,pb] of entries){
    const [family,zone]=key.split("|");
    const bb=profileBucket(batterProfile,family,zone);
    if(!bb)continue;
    const w=(pb.weight||0)/totalWeight;
    const pw=finite(pb.whiffPerSwing)??BASE.whiffPerSwing;
    const bw=finite(bb.whiffPerSwing)??BASE.whiffPerSwing;
    const pc=finite(pb.contactPerSwing)??BASE.contactPerSwing;
    const bc=finite(bb.contactPerSwing)??BASE.contactPerSwing;
    const px=finite(pb.xwoba)??BASE.xwoba;
    const bx=finite(bb.xwoba)??BASE.xwoba;
    const ph=finite(pb.hardHitRate)??BASE.hardHit;
    const bh=finite(bb.hardHitRate)??BASE.hardHit;
    const pbar=finite(pb.barrelRate)??BASE.barrel;
    const bbar=finite(bb.barrelRate)??BASE.barrel;
    const dd=dynamicDifficulty(pb,bb);
    whiff+=w*clamp((pw+bw)/2+dd*0.018,0.08,0.55);
    contact+=w*clamp((pc+bc)/2-dd*0.018,0.40,0.92);
    xwoba+=w*clamp((px+bx)/2-dd*0.008,0.180,0.500);
    hardHit+=w*clamp((ph+bh)/2-dd*0.012,0.15,0.65);
    barrel+=w*clamp((pbar+bbar)/2-dd*0.006,0.01,0.22);
    dynamic+=w*dd;
    coverage+=w*Math.min(1,(bb.weight||0)/8);
  }
  const pitcherK=finite(pitcherProfile.kRate);
  const batterK=finite(batterProfile.kRate);
  const baseK=pitcherK!=null&&batterK!=null
    ? logistic(logit(pitcherK)*0.55+logit(batterK)*0.45)
    : pitcherK??batterK??0.225;
  const kRate=clamp(logistic(logit(baseK)+(whiff-BASE.whiffPerSwing)*2.2+dynamic*0.08),0.07,0.48);
  const damageIndex=
    ((xwoba-BASE.xwoba)/0.08)*0.55+
    ((hardHit-BASE.hardHit)/0.12)*0.20+
    ((barrel-BASE.barrel)/0.05)*0.15+
    ((contact-BASE.contactPerSwing)/0.10)*0.10;
  return {
    kRate,
    whiffPerSwing:whiff,
    contactPerSwing:contact,
    xwoba,
    hardHitRate:hardHit,
    barrelRate:barrel,
    dynamicDifficulty:dynamic,
    runFactor:clamp(1+damageIndex*0.045-dynamic*0.015,0.88,1.12),
    coverage:clamp(coverage,0,1),
  };
}

export function buildLineupMatchup({ pitcherProfile, batterProfiles = [], expectedInnings = null, battersFacedPerInning = null } = {}){
  const scored=(batterProfiles||[]).map((b)=>scorePitcherVsBatter(pitcherProfile,b)).filter(Boolean);
  if(!pitcherProfile||scored.length<5)return null;
  const weights=scored.map((s)=>Math.max(0.25,s.coverage||0));
  const weighted=(key,fallback)=>safeDiv(scored.reduce((s,row,i)=>s+(finite(row[key])??fallback)*weights[i],0),weights.reduce((a,b)=>a+b,0),fallback);
  const lineupKRate=weighted("kRate",finite(pitcherProfile.kRate)??0.225);
  const runFactor=weighted("runFactor",1);
  const bfPerIp=finite(battersFacedPerInning)??4.25;
  const ip=finite(expectedInnings);
  const projectedKs=ip!=null?lineupKRate*bfPerIp*ip:null;
  return {
    version:MLB_PITCH_MATCHUP_VERSION,
    batters:scored.length,
    lineupKRate,
    projectedKs,
    runFactor,
    whiffPerSwing:weighted("whiffPerSwing",BASE.whiffPerSwing),
    contactPerSwing:weighted("contactPerSwing",BASE.contactPerSwing),
    xwoba:weighted("xwoba",BASE.xwoba),
    hardHitRate:weighted("hardHitRate",BASE.hardHit),
    barrelRate:weighted("barrelRate",BASE.barrel),
    dynamicDifficulty:weighted("dynamicDifficulty",0),
    coverage:weighted("coverage",0),
    marketInformed:false,
    calibrationState:"RESEARCH_UNVALIDATED",
  };
}
