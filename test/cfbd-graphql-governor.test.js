import test from "node:test";
import assert from "node:assert/strict";
import {
  CFBD_GRAPHQL_OPERATIONS,
  CFBD_GRAPHQL_URL,
  cfbdGraphqlReservationUrl,
  fetchCfbdGraphql,
} from "../functions/lib/cfbdGraphql.js";
import { reserveCfbdRequest, cfbdRequestHash } from "../functions/lib/cfbCfbdAcquisition.js";

function mockDb() {
  const seen = new Set();
  const receipts = [];
  const control = [];
  return {
    receipts,
    control,
    prepare(sql) {
      return {
        bind(...params) {
          return {
            async run() {
              if (sql.includes("INSERT OR IGNORE INTO cfb_cfbd_acquisition_receipts")) {
                const unique = params[0] + "|" + params[1];
                if (seen.has(unique)) return { meta: { changes: 0 } };
                seen.add(unique);
                receipts.push(params);
                return { meta: { changes: 1 } };
              }
              control.push({ sql, params });
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  };
}

test("GraphQL reservation URL is stable across variable key order", async () => {
  const a = await cfbdGraphqlReservationUrl({
    operationName: "adjustedTeamMetrics",
    variables: { year: 2026, week: 7 },
  });
  const b = await cfbdGraphqlReservationUrl({
    operationName: "adjustedTeamMetrics",
    variables: { week: 7, year: 2026 },
  });
  assert.equal(a, b);
  assert.match(a, /^https:\/\/graphql\.collegefootballdata\.com\/v1\/graphql\?/);
  assert.match(a, /operationName=adjustedTeamMetrics/);
  assert.match(a, /quotaCostAssumption=1/);
});

test("GraphQL host is accepted by shared governor and prefixes receipt endpoint", async () => {
  const url = await cfbdGraphqlReservationUrl({
    operationName: CFBD_GRAPHQL_OPERATIONS.teamTalent,
    variables: { year: 2026 },
  });
  const hash = await cfbdRequestHash(url);
  assert.match(hash.endpoint, /^cfbd-graphql:/);
  const denied = await reserveCfbdRequest({ DB: mockDb() }, url);
  assert.equal(denied.allowed, false);
  assert.equal(denied.reason, "COLLEGE_OWNER_DENIED");
  const allowed = await reserveCfbdRequest({ DB: mockDb(), cfbdNetworkAuthorized: true }, url);
  assert.equal(allowed.allowed, true);
});

test("GraphQL fetch fails closed without owner authorization and makes zero network calls", async () => {
  let network = 0;
  const res = await fetchCfbdGraphql(
    { DB: mockDb(), CFBD_API_KEY: "test-key-not-real" },
    {
      operationName: "ratings",
      query: "query { ratings { team } }",
      fetchFn: async () => {
        network++;
        return Response.json({ data: { ratings: [] } });
      },
    }
  );
  assert.equal(res.ok, false);
  assert.equal(res.reason, "COLLEGE_OWNER_DENIED");
  assert.equal(res.networkCalls, 0);
  assert.equal(network, 0);
});

test("authorized GraphQL uses one shared receipt and does not claim verified billing", async () => {
  const db = mockDb();
  let network = 0;
  const res = await fetchCfbdGraphql(
    { DB: db, cfbdNetworkAuthorized: true, CFBD_API_KEY: "test-key-not-real" },
    {
      operationName: "adjustedTeamMetrics",
      variables: { year: 2026 },
      query: "query adjustedTeamMetrics($year: Int!) { adjustedTeamMetrics(year: $year) { team } }",
      fetchFn: async (url, init) => {
        network++;
        assert.equal(url, CFBD_GRAPHQL_URL);
        assert.equal(init.method, "POST");
        assert.equal(init.headers.authorization, "Bearer test-key-not-real");
        return Response.json(
          { data: { adjustedTeamMetrics: [{ team: "Georgia" }] } },
          { status: 200, headers: { "X-CallLimit-Remaining": "123" } }
        );
      },
    }
  );
  assert.equal(res.ok, true);
  assert.equal(res.networkCalls, 1);
  assert.equal(res.transport, "graphql");
  assert.equal(res.billingSemanticsVerified, false);
  assert.equal(res.quotaCostAssumption, 1);
  assert.equal(res.canAuthorizeWager, false);
  assert.equal(network, 1);
  assert.equal(db.receipts.length, 1);
  // Duplicate identical operation/variables is blocked by durable receipt.
  const again = await fetchCfbdGraphql(
    { DB: db, cfbdNetworkAuthorized: true, CFBD_API_KEY: "test-key-not-real" },
    {
      operationName: "adjustedTeamMetrics",
      variables: { year: 2026 },
      query: "query adjustedTeamMetrics($year: Int!) { adjustedTeamMetrics(year: $year) { team } }",
      fetchFn: async () => {
        network++;
        return Response.json({ data: {} });
      },
    }
  );
  assert.equal(again.ok, false);
  assert.equal(again.networkCalls, 0);
  assert.equal(network, 1);
});

test("GraphQL schema/query errors fail closed without promoting wager authority", async () => {
  const db = mockDb();
  const res = await fetchCfbdGraphql(
    { DB: db, cfbdNetworkAuthorized: true, CFBD_API_KEY: "test-key-not-real" },
    {
      operationName: "scoreboard",
      query: "query scoreboard { scoreboard { id } }",
      fetchFn: async () =>
        Response.json({ errors: [{ message: "field not found" }], data: null }, { status: 200 }),
    }
  );
  assert.equal(res.ok, false);
  assert.equal(res.reason, "CFBD_GRAPHQL_SCHEMA_OR_QUERY_ERROR");
  assert.equal(res.canAuthorizeWager, false);
  assert.equal(res.networkCalls, 1);
});
