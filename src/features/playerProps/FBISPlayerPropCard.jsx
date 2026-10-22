import { useEffect, useRef, useState } from "react";
import "./playerProps.css";
import "./propCardFlow.css";
import { fetchPropResearch } from "./propResearchClient.js";
import { verifiedLastFive } from "./verifiedHistory.js";
import { resolveBasketballPropTeam } from "../../../functions/lib/basketballPropTeam.js";

function finite(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function num(v) {
  const n = finite(v);
  return n == null ? "—" : n.toFixed(1).replace(/\.0$/, "");
}
function signed(v) {
  const n = finite(v);
  if (n == null) return "—";
  return (n > 0 ? "+" : "") + n.toFixed(1);
}
function initials(name = "") {
  return String(name).split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join("").toUpperCase() || "FB";
}
function isRealHeadshot(url = "") {
  const u = String(url || "").trim();
  return /^https?:\/\//i.test(u) && !/\/images\/teams\//i.test(u) && !/NFL_team_/i.test(u);
}
function marketLabel(row = {}) {
  return String(row.marketLabel || row.canonical_market || row.marketCanonical || row.stat_type || row.market || "PROP")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}
function normalizeRow(row = {}, sport = "") {
  return {
    ...row,
    player_name: row.player_name || row.playerName || "",
    team: row.team || "",
    opponent: row.opponent || "",
    sport: String(row.sport || sport || "").toLowerCase(),
    line: finite(row.line),
    fbis_projection: finite(row.fbis_projection ?? row.fbisProjection),
    canonical_market: row.canonical_market || row.marketCanonical || row.stat_type || row.market || "",
    marketLabel: row.marketLabel || null,
    odds_tier: String(row.odds_tier || row.oddsTier || "standard").toLowerCase(),
    player_headshot_url: row.player_headshot_url || row.playerHeadshotUrl || row.imageUrl || null,
    model_version: row.model_version || row.modelVersion || "",
  };
}
function resolvedHeadshot(row = {}) {
  const proRosterTeam = ["nfl","nba","nhl"].includes(String(row.sport || "").toLowerCase()) && Boolean(String(row.team || "").trim());
  // Pro cards resolve authoritative team-roster portraits before any legacy
  // odds-provider image. Other sports retain the existing image contract.
  if (!proRosterTeam && isRealHeadshot(row.player_headshot_url)) return row.player_headshot_url;
  const q = new URLSearchParams({
    name: String(row.player_name || ""),
    sport: String(row.sport || ""),
    team: String(row.team || ""),
    mode: "image",
    // Change the URL when team-code/portrait policy changes so a previously
    // cached legacy image cannot persist on active player-prop cards.
    ...(proRosterTeam ? { portraitVersion: "canonical-roster-2" } : {}),
  });
  return "/api/player-image?" + q.toString();
}
function trendClass(value, line) {
  if (value == null || line == null) return "";
  if (value > line) return "over";
  if (value < line) return "under";
  return "push";
}
function shortGameDate(g) {
  const raw = g?.date;
  if (raw) {
    const d = new Date(String(raw).length <= 10 ? String(raw) + "T12:00:00" : raw);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString("en-US", { month: "numeric", day: "numeric", timeZone: "America/Chicago" });
    }
  }
  return g?.week ? (`${String(g.season||" ").slice(-2)} W${g.week}`.trim()) : "—";
}
function fmtStat(v) {
  const n = finite(v);
  if (n == null) return "—";
  return Math.abs(n) >= 100 ? String(Math.round(n)) : String(Number(n.toFixed(1)));
}

function useTeamTheme(sport, team) {
  const [theme, setTheme] = useState({ logo: "", primary: "", secondary: "" });
  useEffect(() => {
    let cancelled = false;
    const s = String(sport || "").toLowerCase();
    const t = String(team || "").trim();
    if (!s) {
      setTheme({ logo: "", primary: "", secondary: "" });
      return () => { cancelled = true; };
    }
    // Tennis has no team-logo palette; use a fixed court theme so cards match other sports.
    if (s === "tennis") {
      setTheme({ logo: "", primary: "#8b64ff", secondary: "#211548" });
      return () => { cancelled = true; };
    }
    if (!t) {
      setTheme({ logo: "", primary: "", secondary: "" });
      return () => { cancelled = true; };
    }
    const q = new URLSearchParams({ sport: s, name: t });
    fetch("/api/team-logo?" + q.toString(), { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (cancelled) return;
        const teamInfo = body?.found ? body.team : null;
        const u = String(teamInfo?.logo || "");
        setTheme({
          logo: /^https?:\/\//i.test(u) ? u : "",
          primary: String(teamInfo?.primaryColor || "").trim(),
          secondary: String(teamInfo?.secondaryColor || "").trim(),
        });
      })
      .catch(() => { if (!cancelled) setTheme({ logo: "", primary: "", secondary: "" }); });
    return () => { cancelled = true; };
  }, [sport, team]);
  return theme;
}

export function LastFiveStatChart({ row, history=null }) {
  const cardRef = useRef(null);
  const [visible, setVisible] = useState(false);
  const [state, setState] = useState({ loading: true, error: "", games: [], avg: null });

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return undefined;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: "280px" });
    if (cardRef.current) observer.observe(cardRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if(history?.available){setState({loading:false,error:"",games:verifiedLastFive(history.last5||[]),avg:null});return undefined;}
    if (!visible) return undefined;
    let cancelled = false;
    const q = new URLSearchParams({
      sport: String(row.sport || ""),
      name: String(row.player_name || ""),
      team: String(row.team || ""),
      opponent: String(row.opponent || ""),
      market: String(row.canonical_market || ""),
      line: String(row.line ?? ""),
      modelVersion: String(row.model_version || ""),
      ...(row.canonicalPlayerId ? {canonicalPlayerId: row.canonicalPlayerId} : {}),
    });
    setState({ loading: true, error: "", games: [], avg: null });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort("player-prop-detail-timeout"), 18000);
    const request = row.canonicalPlayerId
      ? fetchPropResearch(row, {historyOnly:true}).then(body => ({canonicalPlayerId:body.canonicalPlayerId,detail:{last5:body.history?.last5||[],historyReason:body.history?.reason||null}}))
      : fetch("/api/player-prop-detail?" + q.toString(), { credentials: "same-origin", signal: controller.signal }).then(async res => {
        const body=await res.json();if(!res.ok||body.ok===false)throw Error(body.error||`HTTP ${res.status}`);return body;
      });
    request
      .then((body) => {
        clearTimeout(timer);
        if (cancelled) return;
        const identityConfirmed = !row.canonicalPlayerId || body.canonicalPlayerId === row.canonicalPlayerId;
        const games = identityConfirmed ? verifiedLastFive(body?.detail?.last5 || []) : [];
        setState({
          loading: false,
          error: "",
          games,
          avg: null,
          unavailableReason:body?.detail?.historyReason||null,
        });
      })
      .catch((err) => {
        clearTimeout(timer);
        if (!cancelled) {
          setState({
            loading: false,
            error: err?.name === "AbortError" ? "timed out" : String(err?.message || err),
            games: [],
            avg: null,
          });
        }
      });
    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [history, visible, row.sport, row.player_name, row.team, row.opponent, row.canonical_market, row.line, row.model_version, row.canonicalPlayerId, row.canonicalEventId, row.contractId]);

  const line = finite(row.line);
  const games = state.games;
  return (
    <div className="pp-history-block pp-card-last5" ref={cardRef} aria-label="Last five games for this player and stat">
      <div className="pp-history-head">
        <div>
          <div className="pp-analytics-label">LAST 5</div>
          <strong>{marketLabel(row)}</strong>
        </div>
        <div className="pp-history-summary">
          <span>L5 AVG</span>
          <b>{games.length ? fmtStat(state.avg ?? (games.reduce((s, g) => s + (Number(g.value) || 0), 0) / games.length)) : "—"}</b>
        </div>
      </div>
      {state.loading ? <div className="pp-analytics-loading">Loading last 5…</div> : null}
      {state.error && !state.loading ? <div className="pp-analytics-loading">Last-5 unavailable</div> : null}
      {!state.loading && !state.error && !games.length ? (
        <div className="pp-analytics-unavailable">{state.unavailableReason==='NBA_RIGHTS_CLEARED_PLAYER_FEED_REQUIRED'?'NBA last five requires a rights-cleared player-stat feed.':'No verified last-5 logs for this player/stat yet.'}</div>
      ) : null}
      {games.length ? (
        <>
          <div className="pp-history-bars">
            {games.map((g, i) => {
              const value = finite(g.value);
              const max = Math.max(line == null ? 1 : line * 1.55, ...games.map((x) => Number(x.value) || 0), 1);
              const height = Number.isFinite(value) ? Math.max(8, Math.min(100, (value / max) * 100)) : 8;
              return (
                <div className="pp-history-game" key={i}>
                  <div className="pp-history-bar-wrap">
                    {Number.isFinite(value) ? (
                      <div className={"pp-history-bar " + trendClass(value, line)} style={{ height: height + "%" }} />
                    ) : null}
                    {line != null ? (
                      <div className="pp-history-line" style={{ bottom: Math.min(95, (line / max) * 100) + "%" }} />
                    ) : null}
                  </div>
                  <b>{fmtStat(value)}</b>
                  <span>{g.opponent || ("G" + (i + 1))}</span>
                  <small>{shortGameDate(g)}</small>
                </div>
              );
            })}
          </div>
          {games.length < 5 ? <p className="muted">{games.length} verified games available</p> : null}
          <div className="pp-history-legend"><span /> {row.provider || "Market"} threshold {row.line ?? "—"}</div>
        </>
      ) : null}
    </div>
  );
}


function VenueComparison({row}) {
 const comparison=row.venueComparison;
 if(!comparison)return null;
 const price=v=>v==null?'—':(Number(v)*100).toFixed(1)+'¢';
 const rows=comparison.marketSides||{
  [row.statSide==='under'?'under':'over']:comparison
 };
 const status={
  OTHER_PROVIDER_UNAVAILABLE:'One venue only',
  SETTLEMENT_NOT_EQUIVALENT_OR_UNVERIFIED:'Different or unverified settlement',
  QUOTE_CLOCK_OR_EXECUTION_UNVERIFIED:'Quote clock or ask unverified',
  COMPARABLE_CURRENT_QUOTES:'Comparable current purchase asks (fees excluded)'
 };
 const providers=[...new Set(Object.values(rows).flatMap(s=>(s.venues||[]).map(v=>v.provider)))];
 if(providers.length===1){const provider=providers[0];return <div className="pp-venue-comparison" aria-label={`${provider} research prices`}>
  <div className="pp-venue-topline"><b>{provider.toUpperCase()} PRICES</b><span>Research reference</span></div>
  <div className="pp-single-venue-quotes">{['over','under'].map(side=>{const offer=rows[side]?.venues?.find(v=>v.provider===provider);return <div key={side} className={'pp-side-'+side}><span>{side==='over'?'↑ OVER':'↓ UNDER'}</span><strong>{price(offer?.price)}</strong><small>{offer?.priceKind==='VERIFIED_PURCHASE_ASK'?'Verified ask':offer?.priceKind==='DISPLAY_REFERENCE_NOT_ASK'?'Global reference':offer?'Observed':'Unavailable'}</small></div>;})}</div>
  <details className="pp-venue-caveat"><summary>Price & exchange notes</summary><p>The other exchange has no matched contract. Observed or global reference prices require verified purchase asks, clocks, fees and matching settlement rules before an executable comparison.</p></details>
 </div>;}
 return <div className="pp-venue-comparison" aria-label="Kalshi and Polymarket price comparison">
  <div className="pp-venue-topline"><b>EXCHANGE PRICES</b><span>Over / Under</span></div>
  <div className="pp-venue-matrix" role="table" aria-label="Price and exchange difference by Over and Under">
   <div className="pp-venue-matrix-head" role="row"><b>Side</b><b>Kalshi</b><b>Polymarket</b><b>Gap</b></div>
   {['over','under'].map(side=>{
    const item=rows[side],offers=item?.venues||[];
    const k=offers.find(v=>v.provider==='Kalshi'),p=offers.find(v=>v.provider==='Polymarket');
    return <div key={side} className="pp-venue-matrix-row" role="row" data-stat-side={side}>
     <b className={'pp-side-label pp-side-'+side}>{side==='over'?'↑ OVER':'↓ UNDER'}</b>
     <div><strong>{price(k?.price)}</strong><small>{k?.priceKind==='VERIFIED_PURCHASE_ASK'?'Live ask':k?'Observed':'Unavailable'}</small></div>
     <div><strong>{price(p?.price)}</strong><small>{p?.priceKind==='VERIFIED_PURCHASE_ASK'?'Verified ask':p?.priceKind==='DISPLAY_REFERENCE_NOT_ASK'?'Global ref · not ask':p?'Observed':'Unavailable'}</small></div>
     <div><strong>{price(item?.priceDifferenceDollars!=null?Math.abs(item.priceDifferenceDollars):item?.referenceDifferenceDollars!=null?Math.abs(item.referenceDifferenceDollars):null)}</strong>
      <small>{item?.priceDifferenceDollars!=null?'Verified price gap':item?.referenceDifferenceDollars!=null?'Reference Δ · not comparable':item?.cheaperProvider?'Lower '+item.cheaperProvider:item?status[item.priceComparisonStatus]||'Unverified':'No contract'}</small>
     </div>
    </div>;
   })}
  </div>
  <details className="pp-venue-caveat"><summary>Price comparison notes</summary><p>Observed prices are research references. Price differences require matching settlement rules, current purchase asks and fees before they can support an edge.</p></details>
 </div>;
}

/**
 * Provider-neutral premium card with verified history and selected contract threshold.
 */
export default function FBISPlayerPropCard({
  row: rawRow = {},
  sport = "",
  rank = null,
  compact = false,
  onResearch,
}) {
  const row = normalizeRow(rawRow, sport);
  const projection = row.fbis_projection;
  const line = row.line;
  const delta = projection != null && line != null ? projection - line : null;
  const side = delta == null ? "WATCH" : delta > 0 ? "OVER" : delta < 0 ? "UNDER" : "WATCH";
  // Basketball logos are derived from canonical player-team identity, not an
  // async fuzzy team-name endpoint. Missing/conflicting identity has no logo.
  const basketballTeam = resolveBasketballPropTeam(row);
  const isBasketball = basketballTeam.status !== "not_basketball";
  const remoteTheme = useTeamTheme(isBasketball ? "" : row.sport, isBasketball ? "" : row.team);
  const theme = isBasketball ? basketballTeam : remoteTheme;
  const primary = theme.primary || "#172b50";
  const secondary = theme.secondary || "#0a1428";

  return (
    <article
      className={
        "pp-card pp-premium-card pp-style-card sport-" +
        (row.sport || "nfl") +
        (compact ? " pp-style-card-compact" : "")
      }
      data-pp-card="fbis"
      data-team-watermark-status={isBasketball ? basketballTeam.status : (theme.logo ? "resolved" : "unresolved")}
      data-team-watermark-team={isBasketball ? basketballTeam.teamAbbr : row.team}
      data-team-watermark-id={isBasketball ? basketballTeam.canonicalId || "" : ""}
      style={{
        "--pp-team-primary": primary,
        "--pp-team-secondary": secondary,
        borderColor: `color-mix(in srgb, ${primary} 55%, rgba(255,255,255,.18))`,
      }}
    >
      <div
        className="pp-card-visual pp-card-visual-team"
        style={{
          background: `
            radial-gradient(circle at 50% 36%, color-mix(in srgb, ${primary} 18%, transparent), transparent 52%),
            #000
          `.replace(/\s+/g, " ").trim(),
        }}
      >
        {theme.logo ? (
          <div
            className="pp-team-watermark"
            aria-hidden="true"
            style={{
              position: "absolute",
              left: "50%",
              top: "34%",
              width: "min(140%, 340px)",
              height: "min(140%, 340px)",
              transform: "translate(-50%, -50%)",
              opacity: 0.28,
              zIndex: 1,
              display: "grid",
              placeItems: "center",
              pointerEvents: "none",
              filter: "none",
              inset: "auto",
            }}
          >
            <img
              src={theme.logo}
              alt=""
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              style={{
                width: "125%",
                height: "125%",
                maxWidth: "none",
                maxHeight: "none",
                objectFit: "contain",
                filter: "saturate(0.95) drop-shadow(0 0 22px rgba(255,255,255,.08))",
              }}
            />
          </div>
        ) : null}
        {rank != null ? <div className="pp-style-rank" aria-label={"Rank " + rank}>#{rank}</div> : null}
        <div className="pp-premium-headshot">
          <img
            src={resolvedHeadshot(row)}
            alt={row.player_name || "Player"}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={(e) => {
              e.currentTarget.style.display = "none";
              const fallback = e.currentTarget.nextElementSibling;
              if (fallback) fallback.style.display = "flex";
            }}
          />
          <span style={{ display: "none" }}>{initials(row.player_name)}</span>
        </div>
        <div className="pp-team-pill">
          {(row.sport || "NFL").toUpperCase()}
          {row.team ? <><span>•</span>{row.team}</> : null}
        </div>
      </div>
      <div className="pp-card-body pp-flow-body">
        <header className="pp-flow-identity">
          <h3>{row.player_name || "Unknown player"}</h3>
          <div className="pp-flow-matchup"><span><b>{row.team || row.sport?.toUpperCase()}</b>{row.opponent ? <> <span>vs</span> <b>{row.opponent}</b></>:null}</span>
            {row.start_time?<time dateTime={row.start_time}>{new Date(row.start_time).toLocaleString('en-US',{timeZone:'America/Chicago',weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})} CT</time>:null}</div>
        </header>
        <section className="pp-flow-forecast" aria-label="FBIS forecast versus market threshold" data-lean={side.toLowerCase()}>
          <div className="pp-flow-stat">{marketLabel(row)}</div>
          <div className="pp-flow-numbers">
            <div className="pp-flow-projection fbis-metric"><span>FBIS FORECAST</span><strong>{num(projection)}</strong></div>
            <div className="pp-flow-threshold"><span>{row.provider || 'MARKET'} LINE</span><strong>{num(line)}</strong></div>
          </div>
          <div className="pp-flow-lean"><b>{side==='UNDER'?'↘':side==='OVER'?'↗':'•'} {side==='WATCH'?'NO STAT LEAN':`${side} LEAN`}</b><span>{delta==null?'Projection only':delta===0?'At the line':`${num(Math.abs(delta))} ${delta>0?'above':'below'} line`}</span></div>
        </section>
        <LastFiveStatChart row={row} />
        <VenueComparison row={row} />
        <div className="pp-flow-bottom">
          {onResearch?<button type="button" className="pp-flow-research" aria-label="Open player research" onClick={()=>onResearch(rawRow)}><span>Player research</span><span>{row.alternateThresholds?.length>1?`${row.alternateThresholds.length} lines `:''}↗</span></button>:null}
          <div className="pp-flow-meta"><span className="pp-flow-status">Research only</span><details><summary>Sources & contracts</summary>
            <p>{row.identityVerified&&row.contractId?'Exact player contract mapped.':'Independent projection; no exchange contract mapped.'} {row.marketAvailable?'Verified purchase quote.':'Quote is not executable.'}</p>
            <p>{row.observedAt?`Quote: ${row.observedAt}`:'Quote source time unknown'}{row.collectedAt?` · Captured ${new Date(row.collectedAt).toLocaleTimeString('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit'})} CT`:''}</p>
            <p>{row.modelVersion||row.modelId} · Threshold probability uncalibrated. Not a wager authorization.</p>
          </details></div>
        </div>
      </div>
    </article>
  );
}
