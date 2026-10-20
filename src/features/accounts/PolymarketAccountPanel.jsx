import { useCallback, useEffect, useState } from "react";
import { readAccountApiResponse } from "./accountFetchDiagnostics.js";
import ExchangeBrandHeader from "./ExchangeBrandHeader.jsx";

const currencyMoney = (n, currency = "USD") => {
  if (!Number.isFinite(n)) return "—";
  if (!/^[A-Z]{3}$/.test(currency)) return n.toLocaleString("en-US", { maximumFractionDigits: 4 }) + " " + currency;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(n);
  } catch { return n.toFixed(2) + " " + currency; }
};
const localTime = v => v && Number.isFinite(Date.parse(v)) ? new Date(v).toLocaleString("en-US", {
  timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
}) : "—";
const num = v => Number.isFinite(v) ? v.toLocaleString("en-US", { maximumFractionDigits: 4 }) : "—";
const errorText = {
  POLYMARKET_NOT_CONFIGURED: "Polymarket US account credentials are not configured in Cloudflare.",
  POLYMARKET_SIGNING_FAILED: "Polymarket US API signing failed. Check the Key ID and paired secret in Cloudflare.",
  POLYMARKET_CONNECTION_FAILED: "Cloudflare could not connect to the Polymarket US account API.",
  POLYMARKET_UPSTREAM_FAILED: "Polymarket US rejected or failed one or more private account requests.",
  POLYMARKET_BAD_RESPONSE: "Polymarket US changed the private account response format.",
  POLYMARKET_BALANCE_SCHEMA_CHANGED: "Polymarket US did not provide a recognizable currency balance.",
  POLYMARKET_READ_UNAVAILABLE: "Polymarket US private account read is temporarily unavailable.",
  PORTFOLIO_ACCESS_DENIED: "FBIS account access code was not accepted.",
};

export default function PolymarketAccountPanel({ token }) {
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async (signal) => {
    if (!token) return;
    setBusy(true);
    try {
      const response = await fetch("/api/polymarket-account", {
        headers: { "x-fbis-account-token": token }, cache: "no-store", signal,
      });
      const result = await readAccountApiResponse(response);
      if (signal?.aborted) return;
      if (result.error) throw new Error(result.error);
      const data = result.data;
      if (!response.ok || !data?.ok) {
        const statuses = Object.entries(data?.failures || {}).filter(([, failure]) => failure && Number.isInteger(failure.status))
          .map(([name, failure]) => name + " HTTP " + failure.status);
        const unauthorized = Object.values(data?.failures || {}).some(failure => failure && [401, 403].includes(failure.status));
        const message = unauthorized
          ? "Polymarket US rejected the API Key ID, signing secret, or account permissions (401/403)."
          : errorText[data?.code] || "Polymarket US account read failed.";
        setError(message + (statuses.length ? " [" + statuses.join(", ") + "]" : ""));
        setSnapshot(null);
        return;
      }
      setSnapshot(data);
      setError("");
    } catch (e) {
      if (signal?.aborted) return;
      setSnapshot(null);
      setError(e instanceof TypeError
        ? "Network failure loading Polymarket US balances."
        : e?.message?.startsWith("FBIS account API returned ")
          ? e.message
          : "Polymarket US account request could not complete.");
    } finally {
      if (!signal?.aborted) setBusy(false);
    }
  }, [token]);
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    load(controller.signal);
    const everyMinute = setInterval(() => load(controller.signal), 60000);
    return () => { controller.abort(); clearInterval(everyMinute); };
  }, [load, token]);

  const balances = snapshot?.balances || [];
  const positions = snapshot?.positions || [];
  const orders = snapshot?.openOrders || [];
  const trades = snapshot?.recentTrades || [];
  return (
    <section className="accounts-exchange-shell accounts-exchange-shell--polymarket accounts-polymarket" aria-label="Private Polymarket US account">
      <ExchangeBrandHeader provider="polymarket" updatedAt={localTime(snapshot?.capturedAt)} refreshing={busy} onRefresh={() => load()} />
      {error && <p className="accounts-alert" role="alert">{error}</p>}
      {!snapshot && !error && <p className="accounts-wait">Loading private Polymarket US account…</p>}
      {snapshot && (
        <>
          {balances.map(b => (
            <div key={b.currency} className="accounts-kpis">
              <article className="accounts-kpi"><span>Current balance · {b.currency}</span><strong>{currencyMoney(b.cashBalance, b.currency)}</strong><small>Provider reported currentBalance</small></article>
              <article className="accounts-kpi"><span>Buying power · {b.currency}</span><strong>{currencyMoney(b.buyingPower, b.currency)}</strong><small>Available to place trades</small></article>
              <article className="accounts-kpi"><span>Asset notional · {b.currency}</span><strong>{currencyMoney(b.assetNotional, b.currency)}</strong><small>Provider reported; not verified portfolio NAV</small></article>
              <article className="accounts-kpi"><span>Open positions</span><strong>{positions.length}</strong><small>{orders.length} open orders · {b.currency}</small></article>
            </div>
          ))}
          <div className="accounts-provider-grid">
            <article className="accounts-panel">
              <div className="accounts-panel-head"><h3>Polymarket US positions</h3><span>{snapshot.complete?.positions ? "Complete snapshot" : "Partial page coverage"}</span></div>
              <div className="accounts-table-wrap"><table><thead><tr><th>Market</th><th>Contracts</th><th>Cash value</th><th>Cost basis</th><th>Reported realized P&amp;L</th></tr></thead><tbody>
                {positions.map((p, i) => <tr key={p.market + i}><td>{p.label || p.market}</td><td>{num(p.quantity)}</td><td>{currencyMoney(p.cashValue)}</td><td>{currencyMoney(p.costBasis)}</td><td className={p.realizedPnl > 0 ? "accounts-positive" : p.realizedPnl < 0 ? "accounts-negative" : ""}>{currencyMoney(p.realizedPnl)}</td></tr>)}
                {!positions.length && <tr><td colSpan="5">No open positions reported.</td></tr>}
              </tbody></table></div>
            </article>
            <article className="accounts-panel">
              <div className="accounts-panel-head"><h3>Polymarket account details</h3><span>Read only</span></div>
              <dl className="accounts-facts">
                <div><dt>Open orders</dt><dd>{orders.length}</dd></div>
                <div><dt>Recent trades</dt><dd>{trades.length}</dd></div>
                <div><dt>Unsettled funds</dt><dd>{balances.length === 1 ? currencyMoney(balances[0].unsettledFunds, balances[0].currency) : "By currency"}</dd></div>
                <div><dt>Position coverage</dt><dd>{snapshot.complete?.positions ? "Complete" : "Partial"}</dd></div>
                <div><dt>Account updates</dt><dd>REST every 60 seconds</dd></div>
                <div><dt>Combined exchange NAV</dt><dd>Not verified</dd></div>
              </dl>
              <p className="accounts-fine">Do not add currentBalance to assetNotional or Kalshi totals without verifying valuation semantics and accounting reconciliation. No deposit destinations or bank records are returned.</p>
            </article>
          </div>
          <article className="accounts-panel accounts-fills">
            <div className="accounts-panel-head"><h3>Open Polymarket orders</h3><span>Exchange-reported</span></div>
            <div className="accounts-table-wrap"><table><thead><tr><th>Market</th><th>Side</th><th>Outcome</th><th>Price</th><th>Remaining contracts</th><th>Time (CT)</th></tr></thead><tbody>
              {orders.map((o, i) => <tr key={o.id || i}><td>{o.marketTitle || o.market || "—"}</td><td>{o.side || "—"}</td><td>{o.outcome || "—"}</td><td>{currencyMoney(o.price)}</td><td>{num(o.remaining)}</td><td>{localTime(o.createdAt)}</td></tr>)}
              {!orders.length && <tr><td colSpan="6">No open orders reported.</td></tr>}
            </tbody></table></div>
          </article>
          <article className="accounts-panel accounts-fills">
            <div className="accounts-panel-head"><h3>Recent Polymarket trades</h3><span>{snapshot.complete?.recentTrades ? "Complete available pages" : "Recent pages only — not lifetime"}</span></div>
            <div className="accounts-table-wrap"><table><thead><tr><th>Time (CT)</th><th>Market</th><th>Contracts</th><th>Trade price</th><th>Cost basis</th><th>Realized P&amp;L</th></tr></thead><tbody>
              {trades.map((t, i) => <tr key={t.id || i}><td>{localTime(t.at)}</td><td>{t.market}</td><td>{num(t.quantity)}</td><td>{currencyMoney(t.price)}</td><td>{currencyMoney(t.costBasis)}</td><td>{currencyMoney(t.realizedPnl)}</td></tr>)}
              {!trades.length && <tr><td colSpan="6">No recent trades reported.</td></tr>}
            </tbody></table></div>
          </article>
        </>
      )}
    </section>
  );
}
