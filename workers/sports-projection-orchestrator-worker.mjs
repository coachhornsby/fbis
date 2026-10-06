import crypto from "node:crypto";
import {
  CFG,
  configureRuntime,
  healthSummary,
  validateModels,
  validateSheetsAccess,
  selectCandidates,
  processQueue,
  runSnapshot,
  syncLearningDashboard,
  syncOperationalProjectionSheets,
  syncWagerFeed,
  syncBetTrackerToD1,
  syncSettledBetsToTracker,
  syncPlayerPropLearningToSheet,
} from "../services/sports-projection-orchestrator/orchestrator.mjs";

let jwksCache = { at: 0, keys: [] };

function json(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function decodePart(part) {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

async function githubJwks() {
  if (jwksCache.keys.length && Date.now() - jwksCache.at < 15 * 60 * 1000) return jwksCache.keys;
  const res = await fetch("https://token.actions.githubusercontent.com/.well-known/jwks", {
    headers: { "user-agent": "fbis-cloudflare-orchestrator" },
  });
  if (!res.ok) throw new Error(`GitHub OIDC JWKS ${res.status}`);
  const body = await res.json();
  jwksCache = { at: Date.now(), keys: Array.isArray(body.keys) ? body.keys : [] };
  return jwksCache.keys;
}

async function verifyGithubOidc(jwt, env) {
  try {
    const parts = String(jwt || "").split(".");
    if (parts.length !== 3) return false;
    const header = decodePart(parts[0]);
    const claims = decodePart(parts[1]);
    const audience = env.GITHUB_OIDC_AUDIENCE || "sports-projection-orchestrator";
    const allowedRepo = env.GITHUB_OIDC_REPOSITORY || "coachhornsby/fbis";
    if (header.alg !== "RS256" || !header.kid) return false;
    if (claims.iss !== "https://token.actions.githubusercontent.com") return false;
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!aud.includes(audience)) return false;
    if (String(claims.repository || "") !== allowedRepo) return false;
    if (!String(claims.ref || "").startsWith("refs/heads/")) return false;
    const now = Math.floor(Date.now() / 1000);
    if (Number(claims.exp || 0) <= now || Number(claims.nbf || 0) > now + 30) return false;
    const keys = await githubJwks();
    const jwk = keys.find((k) => k.kid === header.kid);
    if (!jwk) return false;
    const key = crypto.createPublicKey({ key: jwk, format: "jwk" });
    const ok = crypto.verify(
      "RSA-SHA256",
      Buffer.from(parts[0] + "." + parts[1]),
      key,
      Buffer.from(parts[2], "base64url")
    );
    return ok ? { repository: claims.repository, ref: claims.ref, run_id: claims.run_id || null } : false;
  } catch {
    return false;
  }
}

async function authorization(request, env) {
  const auth = request.headers.get("authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const control = env.ORCH_CONTROL_TOKEN || "";
  if (control && (bearer === control || request.headers.get("x-orch-token") === control)) {
    return { type: "control-token" };
  }
  if (bearer) {
    const gh = await verifyGithubOidc(bearer, env);
    if (gh) return { type: "github-oidc", claims: gh };
  }
  return false;
}

async function requestBody(request) {
  if (!request.body) return {};
  const text = await request.text();
  return text ? JSON.parse(text) : {};
}

function credentialGate() {
  const health = healthSummary();
  const missing = Object.entries(health.credentials)
    .filter(([k, v]) => k !== "googleCredentialParseError" && !v)
    .map(([k]) => k);
  return { health, missing };
}


function chicagoHour(now = new Date()) {
  return Number(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", hour: "2-digit", hourCycle: "h23",
  }).format(now));
}

async function runScheduledActionDaily(env) {
  const hour = chicagoHour();
  if (hour < 7 || hour > 11) return { status: "NOT_DUE", hourCt: hour };
  if (!env.HARVEST_SECRET) return { status: "BLOCKED_FAIL_CLOSED", reason: "HARVEST_SECRET missing", hourCt: hour };
  const base = String(CFG.fbisBaseUrl || "https://fbis-myz.pages.dev").replace(/\\/$/, "");
  const call = async (mode) => {
    const res = await fetch(`${base}/api/action-daily-async?mode=${mode}`, {
      method: "POST",
      headers: { "x-harvest-secret": env.HARVEST_SECRET, "content-type": "application/json" },
      body: JSON.stringify({ mode }),
    });
    const body = await res.json().catch(() => ({}));
    return { http: res.status, body };
  };
  const start = await call("start");
  if (!start.body?.ok || ![200, 202].includes(start.http)) throw new Error(`ACTION daily start failed http=${start.http} status=${start.body?.status || "unknown"}`);
  const terminal = new Set(["already_collected_today", "no_slate", "monthly_budget_blocked", "action_not_configured"]);
  if (terminal.has(String(start.body?.status || ""))) return { status: start.body.status, hourCt: hour, runId: start.body.runId || null };
  const harvest = await call("harvest");
  if (!harvest.body?.ok || ![200, 202].includes(harvest.http)) throw new Error(`ACTION daily harvest failed http=${harvest.http} status=${harvest.body?.status || "unknown"}`);
  return { status: harvest.body.status || "UNKNOWN", hourCt: hour, runId: harvest.body.runId || start.body.runId || null, remainingRows: harvest.body.remainingRows ?? null };
}

async function runScheduledNhlGoalieShadow(env) {
  if (!env.HARVEST_SECRET) return { status: "BLOCKED_FAIL_CLOSED", reason: "HARVEST_SECRET missing" };
  const base = String(CFG.fbisBaseUrl || "https://fbis-myz.pages.dev").replace(/\/$/, "");
  const call = async (mode) => {
    const res = await fetch(`${base}/api/nhl-goalie-shadow`, {
      method: "POST",
      headers: { "x-harvest-secret": env.HARVEST_SECRET, "content-type": "application/json" },
      body: JSON.stringify({ mode }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body?.ok !== true) throw new Error(`NHL goalie shadow ${mode} failed http=${res.status}`);
    if (body?.productionChampion !== "NHL-PRO-v2" || body?.productionChanged !== false || body?.qualificationChanged !== false || body?.authority !== false || body?.staking !== false) {
      throw new Error(`NHL goalie shadow governance check failed mode=${mode}`);
    }
    return { http: res.status, body };
  };
  const freeze = await call("freeze");
  const settle = await call("settle");
  return {
    status: "EXECUTED",
    freeze: {
      candidates: freeze.body?.candidates ?? null,
      written: freeze.body?.written ?? null,
      existing: freeze.body?.existing ?? null,
      gateFired: freeze.body?.gateFired ?? null,
      temporalIntegrityPassed: freeze.body?.temporalIntegrityPassed ?? null,
      snapshotAt: freeze.body?.snapshotAt ?? null,
    },
    settle: {
      eligible: settle.body?.eligible ?? null,
      graded: settle.body?.graded ?? null,
    },
  };
}

async function runScheduledTennisCapture(env) {
  const hour = chicagoHour();
  if (hour !== 8 && hour !== 14) return { status: "NOT_DUE", hourCt: hour };
  if (!env.HARVEST_SECRET) return { status: "BLOCKED_FAIL_CLOSED", reason: "HARVEST_SECRET missing", hourCt: hour };
  const base = String(CFG.fbisBaseUrl || "https://fbis-myz.pages.dev").replace(/\/$/, "");
  const pulls = [];
  for (const sport of ["atp", "wta"]) {
    const res = await fetch(`${base}/api/action-research-pull`, {
      method: "POST",
      headers: { "x-harvest-secret": env.HARVEST_SECRET, "content-type": "application/json" },
      body: JSON.stringify({ sport, lifecycle: "pregame", profile: "MOVEMENT", gameStatus: "scheduled", maxItems: 10, fitBudgetUsd: 0.20 }),
    });
    const body = await res.json().catch(() => ({}));
    pulls.push({ sport, http: res.status, ok: body?.ok === true, status: body?.status || null, gamesReturned: body?.gamesReturned || 0, observationsWritten: body?.observationsWritten || 0 });
    if (!res.ok || body?.ok !== true) throw new Error(`tennis ${sport} capture failed http=${res.status}`);
  }
  const snap = await fetch(`${base}/api/tennis-v2-snapshot`, {
    method: "POST",
    headers: { "x-harvest-secret": env.HARVEST_SECRET, "content-type": "application/json" },
    body: JSON.stringify({ mode: "all", hours: 8, limit: 200 }),
  });
  const snapshot = await snap.json().catch(() => ({}));
  if (!snap.ok || snapshot?.ok !== true) throw new Error(`tennis snapshot failed http=${snap.status}`);
  return { status: "EXECUTED", hourCt: hour, pulls, snapshot: { marketInserted: snapshot.marketInserted || 0, decisionInserted: snapshot.decisionInserted || 0, captured: snapshot.captured || 0 } };
}

async function fetchLearningReport(env) {
  if (!env.HARVEST_SECRET) throw new Error("HARVEST_SECRET missing");
  const base = String(CFG.fbisBaseUrl || "https://fbis-myz.pages.dev").replace(/\/$/, "");
  const res = await fetch(`${base}/api/learning-report?since=2026-01-01&limit=5000`, {
    headers: {
      "x-harvest-secret": env.HARVEST_SECRET,
      accept: "application/json",
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.ok !== true || body?.source !== "prediction_snapshots") {
    throw new Error(`learning-report failed http=${res.status}`);
  }
  return body;
}

async function scheduledCycle(env) {
  configureRuntime(env);
  if (String(env.ORCH_CRON_ENABLED || "false").toLowerCase() !== "true") {
    return { ok: true, status: "CRON_DISABLED", at: new Date().toISOString() };
  }
  const actionDaily = await runScheduledActionDaily(env); const tennis = await runScheduledTennisCapture(env); const gate = credentialGate();
  if (gate.missing.length) {
    return {
      ok: true,
      status: "BLOCKED_FAIL_CLOSED",
      reason: "runtime_credentials_incomplete",
      missing: gate.missing,
      tennis,
      at: new Date().toISOString(),
    };
  }
  const selected = await selectCandidates({ dryRun: false });
  const report = await fetchLearningReport(env);
  const learning = await syncLearningDashboard(report);
  const operationalSheets = await syncOperationalProjectionSheets();
  const queue = await processQueue();
  return {
    ok: true,
    status: "EXECUTED",
    tennis,
    selected,
    learning,
    operationalSheets,
    queue,
    at: new Date().toISOString(),
  };
}

async function handleFetch(request, env) {
  configureRuntime(env);
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/health") {
    return json(200, {
      ...healthSummary(),
      platform: "cloudflare-workers",
      cronEnabled: String(env.ORCH_CRON_ENABLED || "false").toLowerCase() === "true",
    });
  }

  const auth = await authorization(request, env);
  if (!auth) return json(401, { error: "unauthorized" });

  try {
    if (request.method === "GET" && url.pathname === "/api/validate/sheets") {
      return json(200, await validateSheetsAccess());
    }
    if (request.method === "POST" && url.pathname === "/api/validate/models") {
      return json(200, await validateModels());
    }
    if (request.method === "POST" && url.pathname === "/api/select-candidates") {
      const payload = await requestBody(request);
      return json(200, { auth: auth.type, ...(await selectCandidates({ dryRun: payload.dryRun === true })) });
    }
    if (request.method === "POST" && url.pathname === "/api/process-queue") {
      const gate = credentialGate();
      if (gate.missing.length) {
        return json(200, {
          auth: auth.type,
          ok: true,
          processed: 0,
          status: "BLOCKED_FAIL_CLOSED",
          reason: "runtime_credentials_incomplete",
          missing: gate.missing,
          at: new Date().toISOString(),
        });
      }
      return json(200, { auth: auth.type, ok: true, status: "EXECUTED", ...(await processQueue()) });
    }
    if (request.method === "POST" && url.pathname === "/api/sync-learning-dashboard") {
      const payload = await requestBody(request);
      const report = payload?.report || payload;
      return json(200, { auth: auth.type, ...(await syncLearningDashboard(report)) });
    }
    if (request.method === "POST" && url.pathname === "/api/sync-operational-sheets") {
      return json(200, { auth: auth.type, ...(await syncOperationalProjectionSheets()) });
    }
    if (request.method === "POST" && url.pathname === "/api/sync-wager-feed") {
      const payload = await requestBody(request);
      return json(200, { auth: auth.type, ...(await syncWagerFeed(payload?.rows || [])) });
    }
    if (request.method === "POST" && url.pathname === "/api/sync-bet-tracker") {
      const payload = await requestBody(request);
      return json(200, { auth: auth.type, ...(await syncBetTrackerToD1({ since: payload?.since || "2026-09-21" })) });
    }
    if (request.method === "POST" && url.pathname === "/api/sync-settled-bets-sheet") {
      return json(200, { auth: auth.type, ...(await syncSettledBetsToTracker()) });
    }
    if (request.method === "POST" && url.pathname === "/api/sync-player-prop-learning-sheet") {
      return json(200, { auth: auth.type, ...(await syncPlayerPropLearningToSheet()) });
    }
    if (request.method === "POST" && url.pathname === "/api/run-snapshot") {
      const payload = await requestBody(request);
      return json(200, await runSnapshot(payload.snapshot || payload, {
        persist: payload.persist !== false,
        persistFeatureSnapshot: payload.persistFeatureSnapshot === true,
      }));
    }
    if (request.method === "POST" && url.pathname === "/api/run-cycle") {
      return json(200, { auth: auth.type, ...(await scheduledCycle(env)) });
    }
    return json(404, { error: "not found" });
  } catch (error) {
    return json(500, {
      error: String(error?.message || error),
      providerResults: error?.providerResults || undefined,
    });
  }
}

export default {
  fetch: handleFetch,
  async scheduled(controller, env, ctx) {
    const task = String(controller?.cron || "") === "17 * * * *"
      ? runScheduledNhlGoalieShadow(env)
      : scheduledCycle(env);
    ctx.waitUntil(
      task
        .then((result) => console.log(JSON.stringify({ event: "orchestrator_cron_complete", result })))
        .catch((error) => console.error(JSON.stringify({
          event: "orchestrator_cron_failed",
          error: String(error?.message || error),
          providerResults: error?.providerResults || null,
        })))
    );
  },
};
