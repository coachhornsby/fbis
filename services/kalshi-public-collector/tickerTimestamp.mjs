// Kalshi ticker docs: msg.ts_ms is update time, not sending_ts_ms queue time.
// https://docs.kalshi.com/websockets/market-ticker
// Research-only provenance. This cannot establish event/settlement identity.
export function kalshiTickerObservedAt(message, receivedAtMs) {
 const value=message?.ts_ms;
 if(!Number.isSafeInteger(receivedAtMs)||!Number.isSafeInteger(value)||value<1_000_000_000_000||value>receivedAtMs)return null;
 return new Date(value).toISOString();
}
