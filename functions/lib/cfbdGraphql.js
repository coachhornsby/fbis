/**
 * CFBD GraphQL client under the shared CFBD/CBBD acquisition governor.
 *
 * Transport: https://graphql.collegefootballdata.com/v1/graphql
 * Billing: unknown until provider-confirmed. Treat each authorized GraphQL
 * operation as one shared-quota attempt (same as REST) — never assume a
 * smaller payload costs fewer provider calls.
 *
 * Does not open a bypass when the shared monthly remaining-call stop is active.
 */
import { collegeApiKey } from "./collegeSecrets.js";
import { reserveCfbdRequest, completeCfbdRequest } from "./cfbCfbdAcquisition.js";

export const CFBD_GRAPHQL_URL = "https://graphql.collegefootballdata.com/v1/graphql";

export const CFBD_GRAPHQL_OPERATIONS = Object.freeze({
  adjustedTeamMetrics: "adjustedTeamMetrics",
  adjustedPlayerMetrics: "adjustedPlayerMetrics",
  ratings: "ratings",
  teamTalent: "teamTalent",
  recruit: "recruit",
  transfer: "transfer",
  athlete: "athlete",
  athleteTeam: "athleteTeam",
  game: "game",
  gameTeam: "gameTeam",
  gamePlayerStat: "gamePlayerStat",
  gameLines: "gameLines",
  gameWeather: "gameWeather",
  currentTeams: "currentTeams",
  historicalTeam: "historicalTeam",
  scoreboard: "scoreboard",
});

function canonicalJson(value) {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  return "{" + Object.keys(value).sort().map((k) => JSON.stringify(k) + ":" + canonicalJson(value[k])).join(",") + "}";
}

export async function cfbdGraphqlReservationUrl({ operationName, variables = {} } = {}) {
  const op = String(operationName || "").trim();
  if (!op || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(op)) throw Error("CFBD_GRAPHQL_OPERATION_INVALID");
  const bytes = new TextEncoder().encode(canonicalJson(variables || {}));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const varsHash = [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, "0")).join("").slice(0, 32);
  const url = new URL(CFBD_GRAPHQL_URL);
  url.searchParams.set("operationName", op);
  url.searchParams.set("variablesHash", varsHash);
  // Explicit cost accounting marker — one reservation == one shared attempt until
  // provider GraphQL billing semantics are independently verified.
  url.searchParams.set("quotaCostAssumption", "1");
  return url.toString();
}

/**
 * Authorized GraphQL POST. Requires cfbdNetworkAuthorized + D1 receipts.
 * Returns research-safe envelope; never logs the bearer or full query text.
 */
export async function fetchCfbdGraphql(env, {
  query,
  variables = {},
  operationName,
  fetchFn = fetch,
  now = Date.now(),
} = {}) {
  const op = String(operationName || "").trim();
  if (!op) return { ok: false, status: 0, reason: "CFBD_GRAPHQL_OPERATION_REQUIRED", data: null, networkCalls: 0 };
  if (typeof query !== "string" || query.length < 8 || query.length > 20_000)
    return { ok: false, status: 0, reason: "CFBD_GRAPHQL_QUERY_INVALID", data: null, networkCalls: 0 };
  const key = collegeApiKey(env, "cfbd");
  if (!key) return { ok: false, status: 0, reason: "no-api-key", data: null, networkCalls: 0 };

  let reservationUrl;
  try {
    reservationUrl = await cfbdGraphqlReservationUrl({ operationName: op, variables });
  } catch (e) {
    return { ok: false, status: 0, reason: String(e?.message || e), data: null, networkCalls: 0 };
  }

  const permit = await reserveCfbdRequest(env, reservationUrl, now);
  if (!permit.allowed) {
    return {
      ok: false,
      status: 0,
      reason: permit.reason || "CFBD_GRAPHQL_RESERVE_DENIED",
      data: null,
      networkCalls: 0,
      transport: "graphql",
    };
  }

  let response;
  try {
    response = await fetchFn(CFBD_GRAPHQL_URL, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ query, variables, operationName: op }),
    });
  } catch {
    await completeCfbdRequest(env, permit, 0, null, now);
    return { ok: false, status: 0, reason: "CFBD_GRAPHQL_TRANSPORT_ERROR", data: null, networkCalls: 1, transport: "graphql" };
  }

  await completeCfbdRequest(env, permit, response.status, response, now);
  const remaining = response.headers?.get?.("X-CallLimit-Remaining");
  let body = null;
  try { body = await response.json(); } catch { body = null; }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      reason: response.status === 429 ? "CFBD_GRAPHQL_RATE_LIMITED" : "CFBD_GRAPHQL_HTTP_ERROR",
      data: null,
      networkCalls: 1,
      transport: "graphql",
      providerRemaining: remaining != null && /^\d+$/.test(String(remaining)) ? Number(remaining) : null,
      operationName: op,
    };
  }

  if (body?.errors?.length) {
    return {
      ok: false,
      status: response.status,
      reason: "CFBD_GRAPHQL_SCHEMA_OR_QUERY_ERROR",
      data: null,
      networkCalls: 1,
      transport: "graphql",
      errorCount: body.errors.length,
      operationName: op,
      // Do not echo provider error messages that may include query fragments.
      canAuthorizeWager: false,
    };
  }

  return {
    ok: true,
    status: response.status,
    reason: null,
    data: body?.data ?? null,
    networkCalls: 1,
    transport: "graphql",
    operationName: op,
    providerRemaining: remaining != null && /^\d+$/.test(String(remaining)) ? Number(remaining) : null,
    quotaCostAssumption: 1,
    billingSemanticsVerified: false,
    canAuthorizeWager: false,
  };
}
