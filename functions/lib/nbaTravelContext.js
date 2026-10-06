export const NBA_TEAM_GEO=Object.freeze({
 ATL:{lat:33.7573,lon:-84.3963,tz:"America/New_York",altitudeFt:1050},
 BOS:{lat:42.3662,lon:-71.0621,tz:"America/New_York",altitudeFt:20},
 BKN:{lat:40.6826,lon:-73.9754,tz:"America/New_York",altitudeFt:30},
 CHA:{lat:35.2251,lon:-80.8392,tz:"America/New_York",altitudeFt:750},
 CHI:{lat:41.8807,lon:-87.6742,tz:"America/Chicago",altitudeFt:595},
 CLE:{lat:41.4965,lon:-81.6882,tz:"America/New_York",altitudeFt:650},
 DAL:{lat:32.7905,lon:-96.8103,tz:"America/Chicago",altitudeFt:430},
 DEN:{lat:39.7487,lon:-105.0077,tz:"America/Denver",altitudeFt:5280},
 DET:{lat:42.3411,lon:-83.0553,tz:"America/New_York",altitudeFt:600},
 GSW:{lat:37.7680,lon:-122.3877,tz:"America/Los_Angeles",altitudeFt:10},
 HOU:{lat:29.7508,lon:-95.3621,tz:"America/Chicago",altitudeFt:50},
 IND:{lat:39.7640,lon:-86.1555,tz:"America/Indiana/Indianapolis",altitudeFt:715},
 LAC:{lat:33.9535,lon:-118.3392,tz:"America/Los_Angeles",altitudeFt:100},
 LAL:{lat:34.0430,lon:-118.2673,tz:"America/Los_Angeles",altitudeFt:300},
 MEM:{lat:35.1382,lon:-90.0506,tz:"America/Chicago",altitudeFt:335},
 MIA:{lat:25.7814,lon:-80.1870,tz:"America/New_York",altitudeFt:10},
 MIL:{lat:43.0451,lon:-87.9172,tz:"America/Chicago",altitudeFt:620},
 MIN:{lat:44.9795,lon:-93.2760,tz:"America/Chicago",altitudeFt:830},
 NOP:{lat:29.9490,lon:-90.0821,tz:"America/Chicago",altitudeFt:0},
 NYK:{lat:40.7505,lon:-73.9934,tz:"America/New_York",altitudeFt:35},
 OKC:{lat:35.4634,lon:-97.5151,tz:"America/Chicago",altitudeFt:1200},
 ORL:{lat:28.5392,lon:-81.3839,tz:"America/New_York",altitudeFt:90},
 PHI:{lat:39.9012,lon:-75.1720,tz:"America/New_York",altitudeFt:40},
 PHX:{lat:33.4457,lon:-112.0712,tz:"America/Phoenix",altitudeFt:1085},
 POR:{lat:45.5316,lon:-122.6668,tz:"America/Los_Angeles",altitudeFt:50},
 SAC:{lat:38.5802,lon:-121.4997,tz:"America/Los_Angeles",altitudeFt:30},
 SAS:{lat:29.4270,lon:-98.4375,tz:"America/Chicago",altitudeFt:650},
 TOR:{lat:43.6435,lon:-79.3791,tz:"America/Toronto",altitudeFt:250},
 UTA:{lat:40.7683,lon:-111.9011,tz:"America/Denver",altitudeFt:4230},
 WAS:{lat:38.8981,lon:-77.0209,tz:"America/New_York",altitudeFt:25},
});

const finite=v=>{if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null};
const rad=x=>x*Math.PI/180;
export function haversineMiles(a,b){
 if(!a||!b)return null;
 const R=3958.7613,dLat=rad(b.lat-a.lat),dLon=rad(b.lon-a.lon);
 const x=Math.sin(dLat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLon/2)**2;
 return 2*R*Math.asin(Math.sqrt(x));
}
function tzOffsetMinutes(timeZone,iso){
 try{
  const d=new Date(iso),parts=new Intl.DateTimeFormat("en-US",{timeZone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(d);
  const m=Object.fromEntries(parts.map(p=>[p.type,p.value]));
  const asUtc=Date.UTC(Number(m.year),Number(m.month)-1,Number(m.day),Number(m.hour),Number(m.minute));
  return (asUtc-d.getTime())/60000;
 }catch{return null}
}
export function timeZonesCrossed(fromAbbr,toAbbr,iso){
 const a=NBA_TEAM_GEO[String(fromAbbr||"").toUpperCase()],b=NBA_TEAM_GEO[String(toAbbr||"").toUpperCase()];
 if(!a||!b)return 0;
 const oa=tzOffsetMinutes(a.tz,iso),ob=tzOffsetMinutes(b.tz,iso);
 if(oa==null||ob==null)return 0;
 return Math.round(Math.abs(ob-oa)/60);
}
function teamAbbrInGame(g,teamId){
 if(String(g.homeId)===String(teamId))return g.home?.abbr||g.homeAbbr||null;
 if(String(g.awayId)===String(teamId))return g.away?.abbr||g.awayAbbr||null;
 return null;
}
export function buildNbaScheduleContext(games=[],target,index,side){
 const teamId=String(target?.[side+"Id"]||target?.[side]?.id||"");
 const targetStart=Date.parse(target?.start||target?.date||0);
 const teamAbbr=target?.[side]?.abbr||target?.[side+"Abbr"]||teamAbbrInGame(target,teamId);
 const targetVenueAbbr=target?.home?.abbr||target?.homeAbbr||teamAbbrInGame(target,String(target?.homeId||target?.home?.id||""));
 const prior=(games||[]).slice(0,index).filter(g=>String(g.homeId)===teamId||String(g.awayId)===teamId)
   .sort((a,b)=>Date.parse(b.start||b.date||0)-Date.parse(a.start||a.date||0));
 const prev=prior[0]||null;
 const prevStart=prev?Date.parse(prev.start||prev.date||0):null;
 const daysRest=prevStart!=null?Math.max(0,Math.floor((targetStart-prevStart)/86400000)-1):3;
 const recent4=prior.filter(g=>targetStart-Date.parse(g.start||g.date||0)<=4*86400000);
 const recent6=prior.filter(g=>targetStart-Date.parse(g.start||g.date||0)<=6*86400000);
 const prevVenueAbbr=prev?(prev?.home?.abbr||prev?.homeAbbr||teamAbbrInGame(prev,String(prev?.homeId||prev?.home?.id||""))):targetVenueAbbr;
 const distanceMiles=prevVenueAbbr&&targetVenueAbbr?haversineMiles(NBA_TEAM_GEO[prevVenueAbbr],NBA_TEAM_GEO[targetVenueAbbr]):0;
 const tzCross=timeZonesCrossed(prevVenueAbbr,targetVenueAbbr,target.start||target.date);
 const altitude=NBA_TEAM_GEO[targetVenueAbbr]?.altitudeFt||0;
 return {
   daysRest,
   backToBack:daysRest===0,
   threeInFour:recent4.length>=2,
   fourInSix:recent6.length>=3,
   teamAbbr:teamAbbr||null,
   priorVenueAbbr:prevVenueAbbr||null,
   destinationAbbr:targetVenueAbbr||null,
   travelMiles:finite(distanceMiles)||0,
   timeZonesCrossed:tzCross,
   altitudeFeet:altitude,
   altitudeDestination:altitude>=4000,
   longTravel:(finite(distanceMiles)||0)>=1200,
 };
}
