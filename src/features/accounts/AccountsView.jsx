import { useCallback, useEffect, useState } from "react";
import "./accounts.css";
import { readAccountApiResponse } from "./accountFetchDiagnostics.js";

const money = value => Number.isFinite(value) ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value) : "—";
const stamp = iso => {
  if (!iso || !Number.isFinite(Date.parse(iso))) return "—";
  return new Date(iso).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};
const prettyError = code => ({
  PORTFOLIO_ACCESS_NOT_CONFIGURED: "FBIS account access is not configured in Cloudflare.",
  PORTFOLIO_ACCESS_DENIED: "Account access code was not accepted.",
  KALSHI_NOT_CONFIGURED: "Kalshi API credentials are not configured in Cloudflare.",
  KALSHI_PRIVATE_KEY_FORMAT_INVALID: "Kalshi private key could not be parsed. In Cloudflare, the secret must contain the entire PRIVATE KEY PEM file, including BEGIN and END lines.",
  KALSHI_SIGNING_FAILED: "Cloudflare could not sign a Kalshi request with the configured private key. Check that the Key ID and private key are a matched Kalshi credential pair.",
  KALSHI_CONNECTION_FAILED: "Cloudflare could not reach Kalshi. The request may have timed out or the provider connection failed.",
  KALSHI_UPSTREAM_FAILED: "Kalshi rejected or failed one or more account requests.",
  KALSHI_BALANCE_SCHEMA_CHANGED: "Kalshi balance format changed. Review the adapter.",
  PORTFOLIO_READ_UNAVAILABLE: "Private account feed is temporarily unavailable.",
}[code] || "Could not load the account. Try again.");

export default function AccountsView() {
  const [entry, setEntry] = useState("");
  const [token, setToken] = useState("");
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async (viewToken, signal) => {
    if (!viewToken) return;
    setBusy(true);
    try {
      const res = await fetch("/api/kalshi-account", {
        headers: { "x-fbis-account-token": viewToken },
        cache: "no-store",
        signal,
      });
      const { data, error: responseError } = await readAccountApiResponse(res);
      if (signal?.aborted) return false;
      if (responseError) {
        setError(responseError);
        setSnapshot(null);
        return false;
      }
      if (!res.ok || !data?.ok) {
        const failures = data?.failures && typeof data.failures === "object" ? data.failures : {};
        const codes = Object.entries(failures).filter(([, failure]) => failure && Number.isInteger(failure.status))
          .map(([resource, failure]) => resource + " HTTP " + failure.status);
        const authRejected = Object.values(failures).some(failure => failure && [401, 403].includes(failure.status));
        const failureMessage = authRejected
          ? "Kalshi rejected the API Key ID, signature, or account permissions (401/403). Confirm that the Key ID matches the private key."
          : prettyError(data?.code || "PORTFOLIO_READ_UNAVAILABLE");
        const responseStatus = Number.isInteger(res.status) && res.status >= 400 ? " (FBIS HTTP " + res.status + ")" : "";
        setError(failureMessage + responseStatus + (codes.length ? " [" + codes.join(", ") + "]" : ""));
        setSnapshot(null);
        return false;
      }
      setError("");
      setSnapshot(data);
      return true;
    } catch (err) {
      if (signal?.aborted) return false;
      // Fetch failures and response decoding failures must not silently become
      // an unknown provider error, or expose the raw response or request token.
      setError(err instanceof TypeError
        ? "Network error reaching the FBIS account API. Check Cloudflare availability and retry."
        : "FBIS account request failed before completing. Reload the page and retry.");
      setSnapshot(null); // Never show stale money figures as fresh.
      return false;
    } finally {
      if (!signal?.aborted) setBusy(false);
    }
  }, []);

  const unlock = async e => {
    e.preventDefault();
    const value = entry.trim();
    if (!value) return;
    const ok = await load(value);
    if (ok) { setToken(value); setEntry(""); }
  };
  const lock = () => { setToken(""); setSnapshot(null); setEntry(""); setError(""); };
  useEffect(() => {
    if (!token) return;
    const aborter = new AbortController();
    // REST is the source of truth. This is timed reconciliation, not a WebSocket claim.
    const interval = setInterval(() => load(token, aborter.signal), 60000);
    return () => { aborter.abort(); clearInterval(interval); };
  }, [token, load]);

  const positions = snapshot?.positions || [];
  const orders = snapshot?.openOrders || [];
  const fills = snapshot?.recentFills || [];
  const reportedRealized = positions.length && positions.every(p => p.realizedPnlDollars != null)
    ? positions.reduce((sum, p) => sum + p.realizedPnlDollars, 0)
    : null;
  return (
    <section className="fbis-accounts" aria-label="Exchange account balances">
      <div className="accounts-top">
        <div><div className="accounts-eyebrow">FBIS / CAPITAL OPERATIONS</div><h2>Accounts &amp; Portfolio</h2><p>Real exchange balances, positions, orders, and fills. No simulated account values.</p></div>
        <div className="accounts-top-actions"><span className="accounts-status">READ ONLY</span>{token && <button type="button" onClick={lock}>Lock account</button>}</div>
      </div>
      {!token ? (
        <form className="accounts-access" onSubmit={unlock}>
          <h3>Private account access</h3>
          <p>Enter your FBIS portfolio access code, not your Kalshi private key. The code stays in this page's memory and clears when you leave or reload.</p>
          <div className="accounts-access-row"><input type="password" autoComplete="off" value={entry} onChange={e => setEntry(e.target.value)} placeholder="FBIS portfolio access code" aria-label="FBIS portfolio access code" /><button type="submit" disabled={busy || !entry.trim()}>{busy ? "Connecting…" : "Open portfolio"}</button></div>
          {error && <p role="alert" className="accounts-alert">{error}</p>}
        </form>
      ) : (
        <>
          <div className="accounts-toolbar"><div><strong>Kalshi</strong> <span className="accounts-subtle">REST snapshot · {stamp(snapshot?.capturedAt)}</span></div><button type="button" disabled={busy} onClick={() => load(token)}>{busy ? "Updating…" : "↻ Refresh balances"}</button></div>
          {error && <p role="alert" className="accounts-alert">{error}</p>}
          {snapshot ? (
            <>
              <div className="accounts-kpis">
                <article className="accounts-kpi"><span>Available cash</span><strong>{money(snapshot.availableCashDollars)}</strong><small>Kalshi reported buying funds</small></article>
                <article className="accounts-kpi"><span>Positions value</span><strong>{money(snapshot.positionValueDollars)}</strong><small>Kalshi portfolio_value</small></article>
                <article className="accounts-kpi"><span>Account total</span><strong>{money(snapshot.accountTotalDollars)}</strong><small>Cash + positions value</small></article>
                <article className="accounts-kpi"><span>Open positions</span><strong>{positions.length}</strong><small>{orders.length} resting orders</small></article>
              </div>
              <div className="accounts-provider-grid">
                <article className="accounts-panel"><div className="accounts-panel-head"><h3>Kalshi positions</h3><span>{snapshot.complete?.positions ? "Complete snapshot" : "Partial page coverage"}</span></div>
                  <div className="accounts-table-wrap"><table><thead><tr><th>Market</th><th>Contracts</th><th>Exposure</th><th>Realized P&amp;L</th></tr></thead><tbody>
                    {positions.map((p, i) => <tr key={p.ticker + ":" + (p.exchangeIndex ?? i)}><td>{p.ticker}</td><td>{p.contracts ?? "—"}</td><td>{money(p.exposureDollars)}</td><td className={p.realizedPnlDollars > 0 ? "accounts-positive" : p.realizedPnlDollars < 0 ? "accounts-negative" : ""}>{money(p.realizedPnlDollars)}</td></tr>)}
                    {!positions.length && <tr><td colSpan="4">No currently unsettled positions reported.</td></tr>}
                  </tbody></table></div>
                </article>
                <article className="accounts-panel"><div className="accounts-panel-head"><h3>Operations</h3><span>Kalshi Pro inspired</span></div>
                  <dl className="accounts-facts"><div><dt>Reported realized P&amp;L (unsettled positions)</dt><dd>{money(reportedRealized)}</dd></div><div><dt>Resting orders</dt><dd>{orders.length}</dd></div><div><dt>Recent fills in snapshot</dt><dd>{fills.length}</dd></div><div><dt>Balance last changed</dt><dd>{stamp(snapshot.balanceUpdatedAt)}</dd></div><div><dt>Account stream</dt><dd>REST reconciliation</dd></div></dl>
                  <p className="accounts-fine">Reported P&amp;L is not your lifetime realized profit. Fee-adjusted account returns require settled history and cash-flow reconciliation.</p>
                </article>
              </div>
              <article className="accounts-panel accounts-fills"><div className="accounts-panel-head"><h3>Recent Kalshi fills</h3><span>{snapshot.complete?.recentFills ? "Available live-history pages" : "History truncated — not lifetime"}</span></div>
                <div className="accounts-table-wrap"><table><thead><tr><th>Time (CT)</th><th>Contract</th><th>Action</th><th>Qty.</th><th>Yes price</th><th>Fee</th></tr></thead><tbody>
                  {fills.map((f, i) => <tr key={f.id || i}><td>{stamp(f.filledAt)}</td><td>{f.ticker}</td><td>{f.action} {f.side}</td><td>{f.contracts ?? "—"}</td><td>{money(f.yesPriceDollars)}</td><td>{money(f.feeDollars)}</td></tr>)}
                  {!fills.length && <tr><td colSpan="6">No recent fills reported.</td></tr>}
                </tbody></table></div>
              </article>
            </>
          ) : !error ? <p className="accounts-wait">Loading private Kalshi account snapshot…</p> : null}
        </>
      )}
      <article className="accounts-panel accounts-other"><div className="accounts-panel-head"><h3>Polymarket US</h3><span>Private account dashboard not connected</span></div><p>FBIS's existing public Polymarket pricing and private synchronization work is separate from a verified, user-visible cash balance. Do not combine totals until private account permissions, reconciliation, and live account coverage are verified.</p></article>
      <p className="accounts-fine">FBIS cannot send orders from this screen. Private account figures never appear on public game cards. Market quotes can be integrated into cards separately with bid, ask, depth, fees, timestamps and contract matching.</p>
    </section>
  );
}
