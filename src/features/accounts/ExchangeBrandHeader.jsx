import { useState } from "react";

/**
 * Provider brand names, colors and marks are presentation-only.
 * Assets are from provider-owned public sites; never use images or fonts from account data.
 * Kalshi official brand: https://kalshi.com/brandkit
 * Polymarket official brand: https://polymarket.com/brand
 */
const EXCHANGES = Object.freeze({
  kalshi: {
    name: "Kalshi",
    logo: "https://kalshi.com/favicon.ico",
    fallback: "K",
    refreshLabel: "Refresh Kalshi",
  },
  polymarket: {
    name: "Polymarket",
    suffix: "US",
    logo: "https://polymarket.com/images/brand/icon-blue.png",
    fallback: "P",
    refreshLabel: "Refresh Polymarket",
  },
});

export default function ExchangeBrandHeader({ provider, updatedAt, refreshing = false, onRefresh }) {
  const exchange = EXCHANGES[provider];
  const [imageFailed, setImageFailed] = useState(false);
  if (!exchange) return null;
  return (
    <div className="accounts-exchange-header">
      <div className="accounts-brand-identity">
        <span className="accounts-brand-avatar" aria-hidden="true">
          <span className="accounts-brand-fallback">{exchange.fallback}</span>
          {!imageFailed && <img
            className="accounts-brand-logo"
            src={exchange.logo}
            alt=""
            width="36"
            height="36"
            onError={() => setImageFailed(true)}
            loading="lazy"
            decoding="async"
          />}
        </span>
        <div className="accounts-brand-copy">
          <h3 className="accounts-provider-name">{exchange.name}{exchange.suffix && <span className="accounts-brand-suffix"> {exchange.suffix}</span>}</h3>
          <div className="accounts-provider-meta">PRIVATE REST · {updatedAt ? `Updated ${updatedAt}` : "Awaiting snapshot"}</div>
        </div>
      </div>
      <div className="accounts-exchange-actions">
        <span className="accounts-private-pill">PRIVATE · READ ONLY</span>
        <button type="button" className="accounts-provider-refresh" disabled={refreshing} onClick={onRefresh} aria-label={exchange.refreshLabel}>
          <span aria-hidden="true">↻</span> {refreshing ? "Updating…" : "Refresh"}
        </button>
      </div>
    </div>
  );
}
