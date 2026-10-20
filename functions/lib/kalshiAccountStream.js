import { kalshiSignedHeaders, kalshiPrivateNotification, kalshiSubscribePrivate, kalshiPrivateKeyPem } from "./kalshiAccount.js";

/**
 * Server-side Kalshi WebSocket transport.
 * Requires a dedicated persistent Worker/Durable Object caller. Never import into
 * browser UI or expose a private WebSocket upgrade to unauthenticated visitors.
 * A stream notification is a dirty marker; REST remains the balance authority.
 */
export const KALSHI_WS_URL = "https://external-api-ws.kalshi.com/trade-api/ws/v2";
export async function connectKalshiPrivateStream(env, { fetchImpl = fetch, onDirty = () => {}, now = Date.now() } = {}) {
  if (!env?.KALSHI_API_KEY_ID || !kalshiPrivateKeyPem(env)) throw new Error("kalshi-stream-not-configured");
  const headers = await kalshiSignedHeaders({
    keyId: env.KALSHI_API_KEY_ID,
    privateKeyPem: kalshiPrivateKeyPem(env),
    path: "/trade-api/ws/v2",
    method: "GET",
    timestamp: now,
  });
  // Cloudflare Workers: HTTPS fetch + Upgrade handshake yields response.webSocket.
  const response = await fetchImpl(KALSHI_WS_URL, {
    method: "GET",
    headers: { ...headers, Upgrade: "websocket" },
  });
  if (response.status !== 101 || !response.webSocket) throw new Error("kalshi-stream-handshake-failed");
  const ws = response.webSocket;
  ws.accept();
  ws.addEventListener("message", event => {
    const dirty = kalshiPrivateNotification(event.data);
    if (dirty) onDirty(dirty);
  });
  ws.send(JSON.stringify(kalshiSubscribePrivate(1)));
  return ws;
}
