import {syncPlayerPropCardSettlements} from '../lib/playerPropCardSettlement.js';
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    },
  });
}

function norm(value) {
  return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function finite(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function writeAuthorized(request, env) {
  const supplied = request.headers.get("x-harvest-secret") || request.headers.get("x-strategy-secret") || "";
  const expected = env.HARVEST_SECRET || env.STRATEGY_IMPORT_SECRET || "";
  return Boolean(expected && supplied && supplied === expected);
}

function terminal(result) {
  return ["WON", "LOST", "PUSH", "VOID"].includes(String(result || "").toUpperCase());
}

function grade(side, line, actual) {
  const s = String(side || "").toUpperCase();
  if (!Number.isFinite(line) || !Number.isFinite(actual)) return null;
  if (actual === line) return { result: "PUSH", hit: null, push: 1 };
  const win = (s === "OVER" || s === "MORE") ? actual > line : actual < line;
  return { result: win ? "WON" : "LOST", hit: win ? 1 : 0, push: 0 };
}

function completed(summary) {
  const comps = summary?.header?.competitions || [];
  return comps.some((c) => c?.status?.type?.completed === true || String(c?.status?.type?.state || "").toLowerCase() === "post");
}

function statsForAthlete(summary, playerName) {
  const wanted = norm(playerName);
  const groups = [];
  for (const team of summary?.boxscore?.players || []) {
    for (const group of team?.statistics || []) {
      const labels = Array.isArray(group?.labels) ? group.labels.map((x) => String(x || "")) : [];
      for (const entry of group?.athletes || []) {
        const athlete = entry?.athlete || {};
        const names = [athlete.displayName, athlete.fullName, athlete.shortName].map(norm).filter(Boolean);
        if (!names.includes(wanted)) continue;
        groups.push({
          name: norm(group?.name || group?.displayName),
          labels,
          stats: Array.isArray(entry?.stats) ? entry.stats : [],
        });
      }
    }
  }
  return groups;
}

function labelValue(group, labels) {
  const wanted = labels.map((x) => norm(x));
  for (let i = 0; i < (group?.labels || []).length; i++) {
    if (wanted.includes(norm(group.labels[i]))) {
      const n = finite(group.stats?.[i]);
      if (n != null) return n;
    }
  }
  return null;
}

function nflActual(summary, playerName, market) {
  const groups = statsForAthlete(summary, playerName);
  const m = String(market || "").toLowerCase();
  if (m === "receiving_yards") {
    for (const g of groups) {
      if (!g.name.includes("receiv")) continue;
      const y = labelValue(g, ["YDS", "Yards"]);
      if (y != null) return y;
    }
  }
  if (m === "passing_attempts" || m === "completions") {
    for (const g of groups) {
      if (!g.name.includes("pass")) continue;
      const separate = m === "passing_attempts"
        ? labelValue(g, ["ATT", "Attempts"])
        : labelValue(g, ["CMP", "Completions"]);
      if (separate != null) return separate;
      const i = (g.labels || []).findIndex((x) => {
        const k = norm(x);
        return k === "c att" || k === "cmp att" || k === "completions attempts";
      });
      if (i >= 0) {
        const parts = String(g.stats?.[i] || "").split("/");
        if (parts.length === 2) {
          const cmp = finite(parts[0]);
          const att = finite(parts[1]);
          return m === "passing_attempts" ? att : cmp;
        }
      }
    }
  }
  return null;
}

async function readPack(db) {
  const cardsQ = await db.prepare(
    "SELECT * FROM player_prop_cards ORDER BY date DESC, captured_at DESC"
  ).all();
  const legsQ = await db.prepare(
    "SELECT * FROM player_prop_legs ORDER BY date(created_at) DESC, card_id, leg_id"
  ).all();
  let calibration = [];
  try {
    const c = await db.prepare(
      "SELECT * FROM player_prop_calibration ORDER BY sport, market, side, model_version"
    ).all();
    calibration = c?.results || [];
  } catch {
    calibration = [];
  }
  const legs = legsQ?.results || [];
  const byCard = new Map();
  for (const leg of legs) {
    if (!byCard.has(leg.card_id)) byCard.set(leg.card_id, []);
    byCard.get(leg.card_id).push(leg);
  }
  const cards = (cardsQ?.results || []).map((card) => ({ ...card, legs: byCard.get(card.card_id) || [] }));
  const graded = legs.filter((x) => x.actual != null);
  const decisions = graded.filter((x) => !Number(x.push || 0));
  return {
    ok: true,
    cards,
    legs,
    calibration,
    summary: {
      cards: cards.length,
      legs: legs.length,
      openLegs: legs.filter((x) => !terminal(x.result)).length,
      gradedLegs: graded.length,
      decisions: decisions.length,
      wins: decisions.filter((x) => Number(x.hit) === 1).length,
      hitRate: decisions.length ? decisions.filter((x) => Number(x.hit) === 1).length / decisions.length : null,
      mae: graded.length ? graded.reduce((s, x) => s + Number(x.absolute_error || 0), 0) / graded.length : null,
      bias: graded.length ? graded.reduce((s, x) => s + Number(x.projection_error || 0), 0) / graded.length : null,
    },
  };
}

async function settleLeg(db, leg, actual, source, closingLine = null) {
  const projection = finite(leg.fbis_projection);
  const line = finite(leg.entry_line);
  const a = finite(actual);
  const g = grade(leg.side, line, a);
  if (!g || a == null) return { ok: false, reason: "invalid-grade" };
  const err = projection == null ? null : a - projection;
  const abs = err == null ? null : Math.abs(err);
  const sq = err == null ? null : err * err;
  const close = finite(closingLine);
  const lineClv = close == null || line == null ? null :
    ((String(leg.side).toUpperCase() === "OVER" || String(leg.side).toUpperCase() === "MORE")
      ? close - line
      : line - close);
  await db.prepare(
    `UPDATE player_prop_legs
       SET actual=?, projection_error=?, absolute_error=?, squared_error=?,
           result=?, hit=?, push=?, closing_line=COALESCE(?, closing_line),
           line_clv=COALESCE(?, line_clv), stat_source=?, graded_at=datetime('now'),
           updated_at=datetime('now')
     WHERE leg_id=?`
  ).bind(a, err, abs, sq, g.result, g.hit, g.push, close, lineClv, source, leg.leg_id).run();
  return { ok: true, legId: leg.leg_id, actual: a, ...g, projectionError: err, absoluteError: abs };
}

async function refreshCards(db) {
  const q = await db.prepare("SELECT * FROM player_prop_cards WHERE status='OPEN'").all();
  for (const card of q?.results || []) {
    const legsQ = await db.prepare("SELECT result,push FROM player_prop_legs WHERE card_id=?").bind(card.card_id).all();
    const legs = legsQ?.results || [];
    if (!legs.length || !legs.every((x) => terminal(x.result))) continue;
    const results = legs.map((x) => String(x.result || "").toUpperCase());
    let result = "WON";
    if (results.includes("LOST")) result = "LOST";
    else if (results.every((x) => x === "PUSH" || x === "VOID")) result = "PUSH";
    else if (results.some((x) => x === "PUSH" || x === "VOID")) result = "ADJUSTED";
    const profit = result === "WON" ? finite(card.to_win) : result === "LOST" ? -Math.abs(finite(card.risk) || 0) : null;
    await db.prepare(
      "UPDATE player_prop_cards SET status='SETTLED', result=?, profit=?, settled_at=datetime('now'), updated_at=datetime('now') WHERE card_id=?"
    ).bind(result, profit, card.card_id).run();
  }
  return syncPlayerPropCardSettlements(db);
}

async function autoSettleNfl(db) {
  const q = await db.prepare(
    "SELECT * FROM player_prop_legs WHERE sport='nfl' AND result='OPEN' AND event_id IS NOT NULL ORDER BY event_id, leg_id"
  ).all();
  const legs = q?.results || [];
  const byEvent = new Map();
  for (const leg of legs) {
    if (!byEvent.has(leg.event_id)) byEvent.set(leg.event_id, []);
    byEvent.get(leg.event_id).push(leg);
  }
  const settled = [];
  const pending = [];
  const errors = [];
  for (const [eventId, eventLegs] of byEvent) {
    try {
      const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${encodeURIComponent(eventId)}`, {
        headers: { accept: "application/json", "user-agent": "FBIS/1.0" },
      });
      if (!res.ok) {
        errors.push({ eventId, error: `ESPN HTTP ${res.status}` });
        continue;
      }
      const summary = await res.json();
      if (!completed(summary)) {
        pending.push({ eventId, reason: "game-not-final", legs: eventLegs.length });
        continue;
      }
      for (const leg of eventLegs) {
        const actual = nflActual(summary, leg.player_name, leg.market);
        if (actual == null) {
          errors.push({ eventId, legId: leg.leg_id, player: leg.player_name, market: leg.market, error: "official-stat-not-found" });
          continue;
        }
        settled.push(await settleLeg(db, leg, actual, "ESPN_OFFICIAL_BOXSCORE"));
      }
    } catch (error) {
      errors.push({ eventId, error: String(error?.message || error) });
    }
  }
  await refreshCards(db);
  return { ok: errors.length === 0, checkedEvents: byEvent.size, settled, pending, errors };
}

export async function onRequestGet(context) {
  if (!context.env?.DB) return json({ ok: false, error: "database unavailable" }, 503);
  try {
    return json(await readPack(context.env.DB));
  } catch (error) {
    return json({ ok: false, error: String(error?.message || error) }, 500);
  }
}

export async function onRequestPost(context) {
  if (!context.env?.DB) return json({ ok: false, error: "database unavailable" }, 503);
  if (!writeAuthorized(context.request, context.env)) return json({ ok: false, error: "unauthorized" }, 401);
  let body = {};
  try { body = await context.request.json(); } catch {}
  const action = String(body?.action || "").toLowerCase();
  try {
    if (action === "auto-settle-nfl") {
      const result = await autoSettleNfl(context.env.DB);
      return json({ ...result, pack: await readPack(context.env.DB) }, result.errors?.length ? 207 : 200);
    }
    if (action === "settle") {
      const legId = String(body?.legId || "");
      const actual = finite(body?.actual);
      if (!legId || actual == null) return json({ ok: false, error: "legId and actual required" }, 400);
      const q = await context.env.DB.prepare("SELECT * FROM player_prop_legs WHERE leg_id=?").bind(legId).first();
      if (!q) return json({ ok: false, error: "leg not found" }, 404);
      const settled = await settleLeg(context.env.DB, q, actual, String(body?.statSource || "OPERATOR"), body?.closingLine);
      await refreshCards(context.env.DB);
      return json({ ok: true, settled, pack: await readPack(context.env.DB) });
    }
    if (action === "live") {
      const legId = String(body?.legId || "");
      const actual = finite(body?.actual);
      if (!legId || actual == null) return json({ ok: false, error: "legId and actual required" }, 400);
      await context.env.DB.prepare(
        "UPDATE player_prop_legs SET live_actual=?, updated_at=datetime('now') WHERE leg_id=?"
      ).bind(actual, legId).run();
      return json({ ok: true, legId, liveActual: actual });
    }
    return json({ ok: false, error: "unknown action" }, 400);
  } catch (error) {
    return json({ ok: false, error: String(error?.message || error) }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type,x-harvest-secret,x-strategy-secret",
    },
  });
}
