import { NHL_WIN_V1_ARTIFACT } from "../../data/models/nhl-win-v1.js";

export const NHL_WIN_V1_ID="NHL-WIN-v1";
export const NHL_WIN_V1_VERSION="research-v1.0-directional-situational";

const ARENA=Object.freeze({
  ANA:{lat:33.8078,lon:-117.8765,tz:"America/Los_Angeles",alt:157},
  ARI:{lat:33.5319,lon:-112.2610,tz:"America/Phoenix",alt:1070},
  BOS:{lat:42.3662,lon:-71.0621,tz:"America/New_York",alt:20},
  BUF:{lat:42.8750,lon:-78.8766,tz:"America/New_York",alt:600},
  CGY:{lat:51.0374,lon:-114.0519,tz:"America/Edmonton",alt:3428},
  CAR:{lat:35.8033,lon:-78.7218,tz:"America/New_York",alt:315},
  CHI:{lat:41.8807,lon:-87.6742,tz:"America/Chicago",alt:594},
  COL:{lat:39.7487,lon:-105.0077,tz:"America/Denver",alt:5280},
  CBJ:{lat:39.9693,lon:-83.0061,tz:"America/New_York",alt:745},
  DAL:{lat:32.7905,lon:-96.8103,tz:"America/Chicago",alt:430},
  DET:{lat:42.3411,lon:-83.0552,tz:"America/Detroit",alt:600},
  EDM:{lat:53.5461,lon:-113.4977,tz:"America/Edmonton",alt:2116},
  FLA:{lat:26.1584,lon:-80.3256,tz:"America/New_York",alt:6},
  LAK:{lat:34.0430,lon:-118.2673,tz:"America/Los_Angeles",alt:285},
  MIN:{lat:44.9448,lon:-93.1011,tz:"America/Chicago",alt:702},
  MTL:{lat:45.4961,lon:-73.5693,tz:"America/Toronto",alt:118},
  NSH:{lat:36.1592,lon:-86.7785,tz:"America/Chicago",alt:597},
  NJD:{lat:40.7335,lon:-74.1711,tz:"America/New_York",alt:30},
  NYI:{lat:40.6826,lon:-73.9754,tz:"America/New_York",alt:40},
  NYR:{lat:40.7505,lon:-73.9934,tz:"America/New_York",alt:33},
  OTT:{lat:45.2969,lon:-75.9272,tz:"America/Toronto",alt:300},
  PHI:{lat:39.9012,lon:-75.1720,tz:"America/New_York",alt:40},
  PIT:{lat:40.4396,lon:-79.9892,tz:"America/New_York",alt:730},
  SJS:{lat:37.3328,lon:-121.9012,tz:"America/Los_Angeles",alt:85},
  SEA:{lat:47.6221,lon:-122.3540,tz:"America/Los_Angeles",alt:130},
  STL:{lat:38.6268,lon:-90.2026,tz:"America/Chicago",alt:466},
  TBL:{lat:27.9427,lon:-82.4518,tz:"America/New_York",alt:10},
  TOR:{lat:43.6435,lon:-79.3791,tz:"America/Toronto",alt:250},
  UTA:{lat:40.7683,lon:-111.9011,tz:"America/Denver",alt:4226},
  VAN:{lat:49.2778,lon:-123.1089,tz:"America/Vancouver",alt:7},
  VGK:{lat:36.1029,lon:-115.1784,tz:"America/Los_Angeles",alt:2030},
  WSH:{lat:38.8981,lon:-77.0209,tz:"America/New_York",alt:30},
  WPG:{lat:49.8927,lon:-97.1437,tz:"America/Winnipeg",alt:760},
});

function finite(v){if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null;}
function clamp(v,lo,hi){return Math.max(lo,Math.min(hi,v));}
function sigmoid(z){return z>=0?1/(1+Math.exp(-z)):Math.exp(z)/(1+Math.exp(z));}
function logit(p){const q=clamp(Number(p),1e-6,1-1e-6);return Math.log(q/(1-q));}
function haversine(a,b){
  if(!a||!b)return 0;
  const R=3958.7613,d2r=Math.PI/180,dlat=(b.lat-a.lat)*d2r,dlon=(b.lon-a.lon)*d2r;
  const q=Math.sin(dlat/2)**2+Math.cos(a.lat*d2r)*Math.cos(b.lat*d2r)*Math.sin(dlon/2)**2;
  return 2*R*Math.asin(Math.min(1,Math.sqrt(q)));
}
function tzOffsetHours(zone,date){
  if(!zone)return 0;
  try{
    const d=new Date(String(date||"").slice(0,10)+"T12:00:00Z");
    const parts=new Intl.DateTimeFormat("en-US",{timeZone:zone,timeZoneName:"longOffset",hour:"2-digit"}).formatToParts(d);
    const z=parts.find(x=>x.type==="timeZoneName")?.value||"GMT+00:00";
    const m=z.match(/GMT([+-])(\d{2}):(\d{2})/);
    return m?(m[1]==="-"?-1:1)*(Number(m[2])+Number(m[3])/60):0;
  }catch{return 0;}
}
function previousVenueContext(team,currentHome,start,schedule=[]){
  const target=Date.parse(start||"");
  const venue=ARENA[currentHome]||null,own=ARENA[team]||null;
  if(!Number.isFinite(target)||!venue)return {travelMiles:0,tzShift:0,returnHome:false,roadContinuation:false,altitudeChange:0,previousGame:null};
  const prior=(schedule||[]).filter(g=>(g.home===team||g.away===team)&&Number.isFinite(Date.parse(g.start))&&Date.parse(g.start)<target)
    .sort((a,b)=>Date.parse(b.start)-Date.parse(a.start))[0];
  if(!prior)return {travelMiles:0,tzShift:0,returnHome:false,roadContinuation:false,altitudeChange:0,previousGame:null};
  const priorVenue=ARENA[prior.home]||null;
  const days=(target-Date.parse(prior.start))/86400000;
  if(days>10||!priorVenue)return {travelMiles:0,tzShift:0,returnHome:false,roadContinuation:false,altitudeChange:0,previousGame:prior.id||null};
  const travelMiles=haversine(priorVenue,venue);
  const tzShift=Math.abs(tzOffsetHours(venue.tz,start)-tzOffsetHours(priorVenue.tz,start));
  return {
    travelMiles,
    tzShift,
    returnHome:Boolean(team===currentHome&&own&&haversine(priorVenue,own)>50),
    roadContinuation:Boolean(team!==currentHome&&own&&haversine(priorVenue,own)>50),
    altitudeChange:Math.abs((venue.alt||0)-(priorVenue.alt||0)),
    previousGame:prior.id||null
  };
}
function featureMap({game,projection,base,signals}){
  const home=String(projection?.home||game?.home?.abbr||"").toUpperCase();
  const away=String(projection?.away||game?.away?.abbr||"").toUpperCase();
  const hp=projection?.probability?.homeWinIncludingOt;
  const hTravel=previousVenueContext(home,home,game?.start,base?.schedule||[]);
  const aTravel=previousVenueContext(away,home,game?.start,base?.schedule||[]);
  const hRest=finite(projection?.layers?.situation?.homeRestDays);
  const aRest=finite(projection?.layers?.situation?.awayRestDays);
  const arena=ARENA[home]||{};
  return {
    baseLogit:logit(hp),
    goalMargin:Number(projection?.projHome||0)-Number(projection?.projAway||0),
    eloDiff:Number(signals?.eloDiff||0)/100,
    xgDiff:Number(signals?.xgHome||0)-Number(signals?.xgAway||0),
    goalieDiff:Number(signals?.goalieVsHome||0)-Number(signals?.goalieVsAway||0),
    restDiff:hRest!=null&&aRest!=null?hRest-aRest:0,
    homeB2B:hRest!=null&&hRest<0.6?1:0,
    awayB2B:aRest!=null&&aRest<0.6?1:0,
    travelHomeK:Number(hTravel.travelMiles||0)/1000,
    travelAwayK:Number(aTravel.travelMiles||0)/1000,
    travelDiffK:(Number(hTravel.travelMiles||0)-Number(aTravel.travelMiles||0))/1000,
    tzShiftHome:Number(hTravel.tzShift||0),
    tzShiftAway:Number(aTravel.tzShift||0),
    returnHome:hTravel.returnHome?1:0,
    awayRoadContinuation:aTravel.roadContinuation?1:0,
    altitudeK:Number(arena.alt||0)/5000,
    arenaResidual:Number(NHL_WIN_V1_ARTIFACT?.arenaResiduals?.[home]||0),
    _travel:{home:hTravel,away:aTravel,venueAltitudeFt:Number(arena.alt||0)}
  };
}
export function projectNhlWinnerV1({game,projection,base,signals}={}){
  const head=NHL_WIN_V1_ARTIFACT?.directionalHead;
  if(!head||!Array.isArray(head.featureNames)||!Array.isArray(head.weights))return {ok:false,reason:"nhl-win-v1-artifact-missing"};
  const fm=featureMap({game,projection,base,signals});
  const raw=head.featureNames.map(k=>Number(fm[k]||0));
  const mean=head.scaler?.mean||[],sd=head.scaler?.sd||[];
  const x=raw.map((v,i)=>(v-Number(mean[i]||0))/(Number(sd[i])||1));
  let z=Number(head.weights[0]||0);
  for(let i=0;i<x.length;i++)z+=Number(head.weights[i+1]||0)*x[i];
  const score=clamp(sigmoid(z),0.001,0.999),threshold=Number(head.threshold??0.52);
  const home=String(projection?.home||game?.home?.abbr||"").toUpperCase(),away=String(projection?.away||game?.away?.abbr||"").toUpperCase();
  const homePick=score>=threshold;
  return {
    ok:true,
    modelId:NHL_WIN_V1_ID,
    modelVersion:NHL_WIN_V1_VERSION,
    pick:homePick?home:away,
    pickSide:homePick?"HOME":"AWAY",
    classifierScore:score,
    threshold,
    calibratedHomeWinProbability:Number(projection?.probability?.homeWinIncludingOt),
    probabilitySource:"NHL-PRO-v2",
    oosAccuracy:Number(head.oosAccuracy||0),
    incumbentOosAccuracy:Number(head.incumbentOosAccuracy||0),
    situational:{
      homeTravelMiles:Math.round(fm._travel.home.travelMiles||0),
      awayTravelMiles:Math.round(fm._travel.away.travelMiles||0),
      travelDiffMiles:Math.round((fm._travel.home.travelMiles||0)-(fm._travel.away.travelMiles||0)),
      homeTimeZoneShift:fm.tzShiftHome,
      awayTimeZoneShift:fm.tzShiftAway,
      returnHome:Boolean(fm.returnHome),
      awayRoadContinuation:Boolean(fm.awayRoadContinuation),
      arenaAltitudeFt:fm._travel.venueAltitudeFt,
      restDiff:fm.restDiff,
      homeB2B:Boolean(fm.homeB2B),
      awayB2B:Boolean(fm.awayB2B)
    },
    canQualify:false,
    canAuthorizeWager:false,
    note:"Directional winner classifier uses PIT-validated travel/rest/arena context; calibrated win probability remains NHL-PRO-v2."
  };
}
