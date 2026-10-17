import './venueConditions.css';
const numeric=value=>value==null||value===''||!Number.isFinite(Number(value))?null:Number(value);
const stamp=value=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('en-US',{timeZone:'America/Chicago',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}):null;
function Icon({kind}){
 const paths={venue:'M3 9 12 3l9 6v11H3V9Zm3 2v6h3v-6H6Zm9 0v6h3v-6h-3Z',sun:'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm-1-6h2v4h-2V1Zm0 18h2v4h-2v-4ZM1 11h4v2H1v-2Zm18 0h4v2h-4v-2ZM3 4l1-1 3 3-1 1-3-3Zm14 14 1-1 3 3-1 1-3-3ZM17 6l3-3 1 1-3 3-1-1ZM3 20l3-3 1 1-3 3-1-1Z',cloud:'M6 18a5 5 0 0 1 0-10 7 7 0 0 1 13-1 6 6 0 0 1-1 12H6v-1Z',rain:'M5 15a4 4 0 0 1 0-8 6 6 0 0 1 11-1 5 5 0 0 1 2 10H5v-1Zm2 2h2l-1 5H6l1-5Zm5 0h2l-1 5h-2l1-5Zm5 0h2l-1 5h-2l1-5Z',snow:'M11 1h2v7l5-4 1 2-6 5 8-1v2l-8 1 6 5-1 2-5-4v7h-2v-7l-5 4-1-2 6-5-8-1v-2l8 1-6-5 1-2 5 4V1Z',wind:'M2 6h13a2 2 0 1 0-2-2h-2a4 4 0 1 1 4 4H2V6Zm0 5h17a3 3 0 1 1-3 3h2a1 1 0 1 0 1-1H2v-2Zm0 6h8a3 3 0 1 1-3 3h2a1 1 0 1 0 1-1H2v-2Z',unknown:'M11 6h2v8h-2V6Zm0 10h2v2h-2v-2ZM12 1a11 11 0 1 0 0 22 11 11 0 0 0 0-22Zm0 2a9 9 0 1 1 0 18 9 9 0 0 1 0-18Z'};
 return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={paths[kind]||paths.unknown}/></svg>;
}
/** Source-backed conditions only. Outside weather never becomes indoor playing conditions. */
export default function VenueConditions({context,game={},compact=false}){
 const weather=context?.weather,raw=game.weather||game.cfb?.weather||{};
 const roof=String(game.roof||game.venue?.roof||game.roofType||'').toLowerCase();
 const indoor=Boolean(weather?.indoor||game.indoor||game.venue?.indoor||/dome|indoor|closed/.test(roof));
 const venue=context?.venueLabel||context?.venueName;
 const description=weather?.description||'';
 const kind=indoor?'venue':/snow|sleet|ice/i.test(description)?'snow':/rain|shower|storm|thunder/i.test(description)?'rain':/cloud|overcast|fog|mist/i.test(description)?'cloud':/clear|sun/i.test(description)?'sun':'unknown';
 const temp=numeric(weather?.temp),wind=numeric(weather?.wind),precip=numeric(raw.precipProbability);
 const forecast=stamp(raw.at),observed=stamp(raw.asOf||raw.observedAt);
 const condition=indoor?(/closed/.test(roof)?'Roof closed':/dome/.test(roof)?'Dome':'Indoors'):description||'Weather unavailable';
 if(!venue&&!weather&&!indoor)return null;
 return <section className={`venue-weather theme-${kind}${compact?' is-compact':''}`} aria-label="Venue and game conditions">
  <div className="vw-venue"><span className="vw-icon"><Icon kind="venue"/></span><div><small>GAME SITE{game.neutralSite?' · NEUTRAL':''}</small><strong>{venue||'Venue unavailable'}</strong>{roof?<span>{roof.replaceAll('_',' ')}</span>:null}</div></div>
  <div className="vw-condition"><span className="vw-weather-icon"><Icon kind={kind}/></span><div><strong>{indoor?'INDOORS':temp==null?'—':`${Math.round(temp)}°F`}</strong><span>{condition}</span></div></div>
  {!indoor&&wind!=null?<div className="vw-wind"><Icon kind="wind"/><div><small>WIND</small><strong>{wind.toFixed(1)} <span>mph{weather.windDir?` ${weather.windDir}`:''}</span></strong></div></div>:null}
  {!indoor&&precip!=null?<div className="vw-precip"><small>PRECIP. CHANCE</small><strong>{Math.round(precip)}%</strong></div>:null}
  {(forecast||observed)?<div className="vw-source">{forecast?`Forecast for ${forecast}`:`Updated ${observed}`}{forecast&&observed?` · Updated ${observed}`:''}{indoor?' · Outdoor forecast excluded':''}</div>:null}
 </section>;
}
