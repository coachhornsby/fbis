import { useEffect, useState } from "react";

/** Private exchange account observations. Never merge these ungraded fills with the executed ledger. */
export default function ExchangeAccountBets() {
  const [token, setToken] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [data, setData] = useState({});
  const [error, setError] = useState({});
  const [busy, setBusy] = useState(false);
  const [refreshed, setRefreshed] = useState(null);

  useEffect(() => {
    if (!enabled || !token) return;
    const controller = new AbortController();
    let active = true;
    const poll = async () => {
      if (!active) return;
      setBusy(true);
      const entries = await Promise.all(["kalshi", "polymarket"].map(async (provider) => {
        try {
          const url = provider === "kalshi" ? "/api/kalshi-account" : "/api/polymarket-account";
          const response = await fetch(url, {
            headers: { "x-fbis-account-token": token }, cache: "no-store", signal: controller.signal
          });
          const body = await response.json();
          if (!response.ok || !body.ok) throw new Error(body.code || "Account unavailable");
          return [provider, body, null];
        } catch (e) { return [provider, null, e.message || "Account unavailable"]; }
      }));
      if (!active) return;
      setData(Object.fromEntries(entries.filter(([, body]) => body).map(([p, body]) => [p, body])));
      setError(Object.fromEntries(entries.filter(([, , err]) => err).map(([p, , err]) => [p, err])));
      setRefreshed(new Date().toISOString());
      setBusy(false);
    };
    poll();
    const id = setInterval(poll, 60000);
    return () => { active = false; controller.abort(); clearInterval(id); };
  }, [enabled, token]);

  const logout = () => { setEnabled(false); setToken(""); setData({}); setError({}); setRefreshed(null); };
  const n = v => v == null || !Number.isFinite(Number(v)) ? "—" : Number(v).toLocaleString(undefined, { maximumFractionDigits: 4 });
  const rows = [
    ...(data.kalshi?.positions || []).map(p => ({ provider: "Kalshi", id: p.ticker, label: p.ticker, quantity: p.contracts, cost: p.exposureDollars, pnl: p.realizedPnlDollars, state: "UNSETTLED POSITION" })),
    ...(data.polymarket?.positions || []).map(p => ({ provider: "Polymarket US", id: p.market, label: p.label || p.market, quantity: p.quantity, cost: p.costBasis, pnl: p.realizedPnl, state: "POSITION" }))
  ];
  return <section className="panel" aria-label="Connected exchange account bets">
    <div className="panel-header"><h2>Connected Exchange Bets <span className="bets-title-sub">Private account positions · read-only</span></h2><span className="last-updated">{refreshed ? "Refreshed " + new Date(refreshed).toLocaleTimeString() : "Not connected"}</span></div>
    <div className="panel-body">
      {!enabled ? <form onSubmit={e => { e.preventDefault(); if (token.trim()) setEnabled(true); }}>
        <p>Enter your FBIS account-view access code to load Kalshi and Polymarket US positions. The code stays in this page's memory and is never stored in the browser or displayed in the public board.</p>
        <input aria-label="FBIS account-view access code" type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} />
        <button className="header-btn" type="submit" disabled={!token.trim()}>Connect private account view</button>
      </form> : <div>
        <button className="header-btn" type="button" onClick={logout}>Disconnect account view</button>
        {busy && <p>Refreshing account positions…</p>}
        {Object.entries(error).map(([provider, message]) => <p className="error" key={provider}>{provider}: {message}</p>)}
        <p className="muted">Positions refresh each minute while this page is open. Exchange market quotes are not evidence of execution. Fills, partial fills, fees and settlements require reconciliation before a position becomes an economically graded wager.</p>
        <div className="table-scroll"><table className="fbis-table"><thead><tr><th>Exchange</th><th>Market / Contract</th><th>Contracts</th><th>Cost / Exposure</th><th>Reported realized P/L</th><th>Account state</th></tr></thead>
        <tbody>{rows.length ? rows.map(row => <tr key={row.provider + row.id}><td>{row.provider}</td><td>{row.label}</td><td>{n(row.quantity)}</td><td>{n(row.cost)}</td><td>{n(row.pnl)}</td><td>{row.state}</td></tr>) : <tr><td colSpan="6">{busy ? "Loading positions…" : "No positions returned from connected accounts."}</td></tr>}</tbody></table></div>
      </div>}
    </div>
  </section>;
}
