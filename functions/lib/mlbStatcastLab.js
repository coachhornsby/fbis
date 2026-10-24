/** Pitch-level descriptive analytics, independent of markets and predictive model authority. */
export const MLB_STATCAST_LAB_VERSION='mlb-statcast-lab-v1';
export const LAB_PREFIX='models/mlb/player-lab/v1/';
export const COMPETITIVE_GAME_TYPES=['R','F','D','L','W'];
export const PITCH_TYPES={FF:['Four-seam','#ee5364','fastball'],SI:['Sinker','#f28b3c','fastball'],FC:['Cutter','#bd894d','fastball'],FA:['Fastball','#e66d72','fastball'],SL:['Slider','#e8cd44','breaking'],ST:['Sweeper','#b4a742','breaking'],CU:['Curveball','#6abce4','breaking'],KC:['Knuckle curve','#66d3d3','breaking'],SV:['Slurve','#aa91e3','breaking'],CS:['Slow curve','#89b7f1','breaking'],CH:['Changeup','#67bc6c','offspeed'],FS:['Splitter','#65bab1','offspeed'],FO:['Forkball','#83d0a8','offspeed'],SC:['Screwball','#a2d49d','offspeed'],KN:['Knuckleball','#c6a7d5','other'],EP:['Eephus','#b4c1cf','other']};
const NUMBERS=['release_speed','release_pos_x','release_pos_y','release_pos_z','release_extension','release_spin_rate','pfx_x','pfx_z','plate_x','plate_z','sz_top','sz_bot','zone','launch_speed','launch_angle','launch_speed_angle','estimated_woba_using_speedangle','estimated_ba_using_speedangle','estimated_slg_using_speedangle','arm_angle','spin_axis','vx0','vy0','vz0','ax','ay','az','delta_run_exp','balls','strikes'];
const TEXT=['game_pk','game_date','game_type','pitcher','batter','at_bat_number','pitch_number','pitch_type','pitch_name','description','events','type','stand','p_throws','bb_type','home_team','away_team'];
export const finiteLab=v=>v==null||String(v).trim()===''||typeof v==='boolean'||!Number.isFinite(Number(v))?null:Number(v);
const n=finiteLab,avg=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
const values=(rows,key)=>rows.map(r=>n(r[key])).filter(v=>v!=null);
const stat=(numerator,denominator,unit='rate')=>({value:denominator>0?numerator/denominator:null,numerator,denominator,unit});
const mean=(rows,key,unit)=>{const xs=values(rows,key);return stat(xs.reduce((a,b)=>a+b,0),xs.length,unit);};
const deviation=(xs,unit)=>{const m=avg(xs),sumSquaredDeviations=xs.length?xs.reduce((a,v)=>a+(v-m)**2,0):0;return {value:xs.length>1?Math.sqrt(sumSquaredDeviations/(xs.length-1)):null,numerator:sumSquaredDeviations,denominator:Math.max(0,xs.length-1),sampleSize:xs.length,unit,formula:'sqrt(sum_squared_deviations / (n-1))'};};
const isSwing=r=>r.type==='X'||/^(swinging_strike|swinging_strike_blocked|foul|foul_tip|foul_bunt|missed_bunt|bunt_foul_tip|hit_into_play)$/.test(r.description);
const isWhiff=r=>/^swinging_strike(_blocked)?$/.test(r.description);
const isBBE=r=>r.type==='X';
export const isActualLabPitch=r=>!/^automatic_/.test(r.description||'');
export function normalizeLabRows(input,{playerId,role='pitcher',season,cutoffDay,finalGameIds=null}={}){
 if(!/^\d+$/.test(String(playerId))||!['pitcher','batter'].includes(role)||!Number.isInteger(season)||season<2024||season>new Date().getUTCFullYear()||!/^\d{4}-\d{2}-\d{2}$/.test(cutoffDay||''))throw Error('INVALID_LAB_SCOPE');
 const seen=new Set(),rows=[],rejections={identity:0,scope:0,duplicate:0,game:0};
 for(const raw of input){
  if(String(raw[role])!==String(playerId)){rejections.identity++;continue;}
  const date=String(raw.game_date||'').slice(0,10),id=String(raw.game_pk||''),pa=String(raw.at_bat_number||''),pitch=String(raw.pitch_number||'');
  if(!COMPETITIVE_GAME_TYPES.includes(raw.game_type)||Number(date.slice(0,4))!==season||date>=cutoffDay||!Number.isFinite(Date.parse(date))){rejections.scope++;continue;}
  if(!/^\d+$/.test(id)||!/^\d+$/.test(pa)||!/^\d+$/.test(pitch)||finalGameIds&&!finalGameIds.has(id)){rejections.game++;continue;}
  const key=[id,pa,pitch].join(':');if(seen.has(key)){rejections.duplicate++;continue;}seen.add(key);
  const row=Object.fromEntries(TEXT.map(k=>[k,String(raw[k]??'')]));for(const key of NUMBERS)row[key]=n(raw[key]);rows.push(row);
 }
 rows.sort((a,b)=>a.game_date.localeCompare(b.game_date)||Number(a.game_pk)-Number(b.game_pk)||Number(a.at_bat_number)-Number(b.at_bat_number)||Number(a.pitch_number)-Number(b.pitch_number));
 return {rows,rejections};
}
export function outsideZone(r){
 const z=n(r.zone);if(z>=1&&z<=9)return false;if(z>=11&&z<=14)return true;
 const [x,h,top,bot]=[r.plate_x,r.plate_z,r.sz_top,r.sz_bot].map(n);
 return [x,h,top,bot].some(x=>x==null)||top<=bot?null:Math.abs(x)>.83||h<bot||h>top;
}
/** Derived approach angles at a fixed 1.417-ft front-of-plate plane. Not an official supplied VAA field. */
export function labApproachAngles(row){
 const [vx,vy,vz,ax,ay,az]=['vx0','vy0','vz0','ax','ay','az'].map(k=>n(row[k]));
 if([vx,vy,vz,ax,ay,az].some(v=>v==null)||vy>=0)return null;
 const distance=50-17/12,disc=vy*vy-2*ay*distance;
 if(disc<=0)return null;
 const t=Math.abs(ay)<1e-9?-distance/vy:(-vy-Math.sqrt(disc))/ay;
 if(t<=0||t>1)return null;const down=-(vy+ay*t);if(down<=0)return null;
 return {haa:Math.atan2(vx+ax*t,down)*180/Math.PI,vaa:Math.atan2(vz+az*t,down)*180/Math.PI};
}
function metricSummary(observations){
 const rows=observations.filter(isActualLabPitch);
 const terminal=new Map();for(const r of observations)if(r.events)terminal.set(`${r.game_pk}:${r.at_bat_number}`,r);
 const pa=[...terminal.values()],bbe=rows.filter(isBBE),outside=rows.filter(r=>outsideZone(r)===true),zoneKnown=rows.filter(r=>outsideZone(r)!=null),swing=rows.filter(isSwing),whiff=rows.filter(isWhiff),expected=bbe.filter(r=>n(r.estimated_woba_using_speedangle)!=null),ev=bbe.filter(r=>n(r.launch_speed)!=null),barrel=bbe.filter(r=>n(r.launch_speed_angle)>=1&&n(r.launch_speed_angle)<=6);
 const k=pa.filter(r=>['strikeout','strikeout_double_play'].includes(r.events)).length,bb=pa.filter(r=>['walk','intent_walk'].includes(r.events)).length;
 const arms=values(rows,'arm_angle'),rx=values(rows,'release_pos_x'),rz=values(rows,'release_pos_z'),re=values(rows,'delta_run_exp');
 return {pitches:rows.length,plateAppearances:pa.length,battedBalls:bbe.length,metrics:{
  strikeout:stat(k,pa.length),walk:stat(bb,pa.length),kMinusBb:stat(k-bb,pa.length),zone:stat(zoneKnown.filter(r=>outsideZone(r)===false).length,zoneKnown.length),chase:stat(outside.filter(isSwing).length,outside.length),swstr:stat(whiff.length,rows.length),whiff:stat(whiff.length,swing.length),contact:stat(swing.filter(r=>!isWhiff(r)&&r.description!=='missed_bunt').length,swing.length),hardHit:stat(ev.filter(r=>r.launch_speed>=95).length,ev.length),barrel:stat(barrel.filter(r=>r.launch_speed_angle===6).length,barrel.length),exitVelocity:mean(bbe,'launch_speed','mph'),xwobacon:stat(expected.reduce((a,r)=>a+r.estimated_woba_using_speedangle,0),expected.length,'woba'),velocity:mean(rows,'release_speed','mph'),spin:mean(rows,'release_spin_rate','rpm'),extension:mean(rows,'release_extension','ft'),armAngle:mean(rows,'arm_angle','degrees'),
  releaseHeight:mean(rows,'release_pos_z','ft'),releaseHorizontal:mean(rows,'release_pos_x','ft'),releaseAngleSD:deviation(arms,'degrees'),releaseXSD:deviation(rx,'ft'),releaseZSD:deviation(rz,'ft'),runExpectancyChange:{value:re.length?re.reduce((a,b)=>a+b,0):null,denominator:re.length,unit:'batting_runs'}},
  coverage:{automaticEvents:observations.length-rows.length,pitchLocations:rows.filter(r=>n(r.plate_x)!=null&&n(r.plate_z)!=null&&n(r.sz_top)!=null&&n(r.sz_bot)!=null&&r.sz_top>r.sz_bot).length,expectedContact:expected.length,battedBalls:bbe.length,exitVelocity:ev.length,zoneKnown:zoneKnown.length,terminalPAs:pa.length},smallSample:rows.length<200};
}
function arsenal(input){const rows=input.filter(isActualLabPitch);const groups=new Map();for(const r of rows){const key=r.pitch_type||'UNKNOWN';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);}
 return [...groups].map(([type,pitches])=>{
  const def=PITCH_TYPES[type]||[type,'#a2adbb','other'];const angles=pitches.map(labApproachAngles).filter(Boolean);
  return {type,name:def[0],color:def[1],category:def[2],...metricSummary(pitches),usage:stat(pitches.length,rows.length),release:{x:mean(pitches,'release_pos_x','ft'),y:mean(pitches,'release_pos_y','ft'),z:mean(pitches,'release_pos_z','ft'),extension:mean(pitches,'release_extension','ft')},movement:{horizontal:mean(pitches,'pfx_x','ft'),vertical:mean(pitches,'pfx_z','ft')},approach:{haa:stat(angles.reduce((a,x)=>a+x.haa,0),angles.length,'degrees'),vaa:stat(angles.reduce((a,x)=>a+x.vaa,0),angles.length,'degrees')}};
 }).sort((a,b)=>b.pitches-a.pitches);
}
export function buildMlbStatcastLab(packets,{season,hand='all',pitchType='all',pitchGroup='all',pitchResult='all',paResult='all',scope='competitive',attackZone='all'}={}){
 const role=packets[0]?.role||'pitcher',handKey=role==='pitcher'?'stand':'p_throws';
 const filter=(packet,{ignoreHand=false}={})=>{
  const terminal=new Map();for(const r of packet.rows||[])if(r.events)terminal.set(`${r.game_pk}:${r.at_bat_number}`,r.events);
  return (packet.rows||[]).filter(r=>(ignoreHand||hand==='all'||r[handKey]===hand)&&(pitchType==='all'||r.pitch_type===pitchType)&&(pitchGroup==='all'||(PITCH_TYPES[r.pitch_type]?.[2]||'other')===pitchGroup)&&(pitchResult==='all'||r.description===pitchResult)&&(paResult==='all'||terminal.get(`${r.game_pk}:${r.at_bat_number}`)===paResult)&&(scope==='competitive'||scope==='regular'&&r.game_type==='R'||scope==='postseason'&&r.game_type!=='R')&&(attackZone==='all'||attackZone==='zone'&&outsideZone(r)===false||attackZone==='chase'&&outsideZone(r)===true));
 };
 const selected=packets.find(p=>p.season===season),rows=selected?filter(selected):[],allHands=selected?filter(selected,{ignoreHand:true}).filter(isActualLabPitch):[];
 const cells=Array.from({length:144},(_,index)=>({x:index%12,y:Math.floor(index/12),count:0}));let located=0,offGrid=0;
 for(const r of rows){const x=n(r.plate_x),z=n(r.plate_z),top=n(r.sz_top),bot=n(r.sz_bot);if([x,z,top,bot].some(x=>x==null)||top<=bot)continue;located++;const yn=(z-bot)/(top-bot),xi=Math.floor((x+2)/4*12),yi=Math.floor((yn+.5)/2*12);if(xi<0||xi>=12||yi<0||yi>=12){offGrid++;continue;}cells[yi*12+xi].count++;}
 const sourceRows=selected?.rows||[];
 const trends=packets.map(packet=>{const filtered=filter(packet);return {season:packet.season,...metricSummary(filtered),categories:['all','fastball','breaking','offspeed'].map(category=>({category,...metricSummary(category==='all'?filtered:filtered.filter(r=>PITCH_TYPES[r.pitch_type]?.[2]===category))}))};}).sort((a,b)=>a.season-b.season);
 return {version:MLB_STATCAST_LAB_VERSION,role,season,available:rows.length>0,...metricSummary(rows),arsenal:arsenal(rows),handedness:['L','R'].map(hand=>({hand,pitches:allHands.filter(r=>r[handKey]===hand).length,arsenal:arsenal(allHands.filter(r=>r[handKey]===hand))})),heatmap:{cells,located,offGrid,orientation:'CATCHER_VIEW',xDomain:[-2,2],yDomain:[-.5,1.5],verticalBasis:'NORMALIZED_INDIVIDUAL_STRIKE_ZONE'},trends,
  filters:{seasons:packets.map(p=>p.season).sort(),pitchTypes:[...new Set(sourceRows.map(r=>r.pitch_type))].filter(Boolean).sort(),pitchResults:[...new Set(sourceRows.map(r=>r.description))].filter(Boolean).sort(),paResults:[...new Set(sourceRows.map(r=>r.events))].filter(Boolean).sort()},
  source:{name:'Baseball Savant / Statcast',url:'https://baseballsavant.mlb.com/csv-docs',asOf:selected?.observedAt||null,cutoffDay:selected?.cutoffDay||null,games:selected?.games||0,sourceHash:selected?.sourceHash||null,coverage:selected?.coverage||'COLLECTED_FINAL_GAMES',coordinateConvention:season>=2026?'2026 ABS-era plate coordinates':'Pre-2026 front-of-plate coordinates'},
  limitations:['Approach angles are derived from the measured velocity/acceleration trajectory at a fixed front-of-plate plane.','xwOBA on contact uses only batted balls with a supplied expected-wOBA value.','League averages, official run value, count-leverage Zone%, SSW, and xRA are not inferred from partial player data.'],canAuthorizeWager:false};
}
