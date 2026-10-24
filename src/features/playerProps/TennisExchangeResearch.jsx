import { useEffect, useMemo, useState } from "react";
import { tennisExchangeResearchCards } from "../../lib/tennisPropMarketResearch.js";

const price = (p, suffix = "¢") => p == null ? "—" : (Number(p) * 100).toFixed(1) + suffix;
const chicagoTime = stamp => {
  if (!stamp || !Number.isFinite(Date.parse(stamp))) return "Time unavailable";
  return new Date(stamp).toLocaleString("en-US", {
    timeZone:"America/Chicago", weekday:"short", month:"short",
    day:"numeric", hour:"numeric", minute:"2-digit", timeZoneName:"short",
  });
};

/** Tennis match/set/game observations shown separately from real player-stat props. */
export default function TennisExchangeResearch({date, provider = "all", search = ""}) {
  const [data, setData] = useState({loading:true,games:[],error:""});
  useEffect(() => {
    const controller=new AbortController();
    setData({loading:true,games:[],error:""});
    fetch("/api/today?"+new URLSearchParams({sport:"tennis",date}),{
      credentials:"same-origin",signal:controller.signal,
    }).then(async r => {
      const body=await r.json();
      if(!r.ok || body.ok===false) throw Error(body?.error || "Tennis Board feed unavailable");
      return body;
    }).then(body => {
      if(!controller.signal.aborted) setData({loading:false,games:body.games||[],error:""});
    }).catch(error => {
      if(!controller.signal.aborted) setData({loading:false,games:[],error:String(error?.message||error)});
    });
    return () => controller.abort();
  }, [date]);
  const cards = useMemo(() => tennisExchangeResearchCards(data.games),[data.games]);
  const relevant = useMemo(() => cards.filter(card =>
    (provider==="all" || (provider==="Kalshi" ? card.kalshi.length>0 : Boolean(card.polymarket || card.derivative.length))) &&
    (card.away+" "+card.home+" "+card.tournament).toLowerCase().includes(search.toLowerCase())
  ),[cards,provider,search]);
  return <section className="pp-tennis-market-research" aria-label="Tennis exchange markets, separate from player-stat props">
    <div className="pp-tennis-market-heading">
      <div>
        <h2>Tennis exchange markets</h2>
        <p>Match winner · set markets · game spreads — existing Board observations</p>
      </div>
      <strong>{data.loading?"Loading…":relevant.length+" matches"}</strong>
    </div>
    <p className="pp-tennis-market-caveat">
      These are <b>match-level research markets, not individual player-stat props</b>.
      Kalshi and Polymarket prices remain labeled by their original source and price type.
      A missing bid/ask or unverified quote time is not an executable offer.
    </p>
    {data.error?<p role="alert">Tennis market feed: {data.error}</p>:null}
    {!data.loading&&!data.error&&!relevant.length?<p className="pp-empty">No event-matched tennis exchange markets available for this date or filters.</p>:null}
    <div className="pp-tennis-market-grid">{relevant.map(card=><article className="pp-tennis-market-card" key={card.id}>
      <div className="pp-tennis-market-meta"><b>{card.tour}</b><span>{chicagoTime(card.start)}</span></div>
      <h3>{card.away}<span> vs </span>{card.home}</h3>
      {card.tournament?<p className="pp-tennis-tournament">{card.tournament}</p>:null}
      {card.matchWinProbability?<p className="pp-tennis-projection">
        FBIS match-win: <b>{card.away} {price(card.matchWinProbability[0],"%")}</b>
        <b>{card.home} {price(card.matchWinProbability[1],"%")}</b>
      </p>:null}
      <div className="pp-tennis-market-venues">
        {(provider==="all"||provider==="Kalshi")?<section>
          <h4>KALSHI <small>YES asks · capture only</small></h4>
          {card.kalshi.length?card.kalshi.map((o,i)=><div key={o.name+"-"+i} className="pp-tennis-quote">
            <span>{o.name}</span><strong>{price(o.ask)}</strong>
          </div>):<p>Winner quotes unavailable</p>}
        </section>:null}
        {(provider==="all"||provider==="Polymarket")?<section>
          <h4>{card.polymarket?.sourceName||"POLYMARKET"} <small>{card.polymarket?.kind||"No winner pair"}</small></h4>
          {card.polymarket?.sides?.length?card.polymarket.sides.map((o,i)=><div key={o.name+"-"+i} className="pp-tennis-quote">
            <span>{o.name}</span><strong>{o.ask!=null?price(o.ask):o.observed!=null?price(o.observed):o.indicative!=null?price(o.indicative,"%"):"—"}</strong>
          </div>):<p>Winner quotes unavailable</p>}
        </section>:null}
      </div>
      {(provider==="all"||provider==="Polymarket")&&card.derivative.length?<details className="pp-tennis-derivatives">
        <summary>{card.derivative.length} additional set/game markets · Polymarket</summary>
        {card.derivative.map((market,i)=><div key={market.id+"-"+i}>
          <strong>{market.question}</strong>
          {market.outcomes.map((o,j)=><p key={j}>{o}: {
            market.asks[j]!=null ? price(market.asks[j])+" captured CLOB ask" :
            market.indicative[j]!=null ? price(market.indicative[j],"%")+" indicative" : "price unavailable"
          }</p>)}
        </div>)}
      </details>:null}
    </article>)}</div>
  </section>;
}
