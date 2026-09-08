const SPORTS = ["cfb", "nfl", "cbb", "mlb"];
const DEFAULT_SPORT = "cfb";

const state = {
  sport: new URL(window.location.href).searchParams.get("sport") || DEFAULT_SPORT,
  date: new URL(window.location.href).searchParams.get("date") || todayCt(),
  loading: false,
};

if (!SPORTS.includes(state.sport)) state.sport = DEFAULT_SPORT;

const els = {
  grid: document.querySelector("#projection-grid"),
  alert: document.querySelector("#board-alert"),
  date: document.querySelector("#projection-date"),
  refresh: document.querySelector("#refresh-board"),
  title: document.querySelector("#board-title"),
  version: document.querySelector("#model-version"),
  updated: document.querySelector("#board-updated"),
  disclaimer: document.querySelector("#board-disclaimer"),
  sportButtons: [...document.querySelectorAll("[data-sport]")],
};

function todayCt() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function fmtNumber(value, digits = 1) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : "—";
}

function fmtProbability(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 && n < 1 ? `${(n * 100).toFixed(1)}%` : "—";
}

function fmtAmerican(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n > 0 ? `+${Math.round(n)}` : `${Math.round(n)}`;
}

function fmtSpread(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) < 0.001) return "PK";
  return n > 0 ? `+${n.toFixed(1)}` : n.toFixed(1);
}

function fmtTimestamp(value) {
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(ts));
}

function fmtKickoff(value) {
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return "TBD";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(ts));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function teamLogo(team) {
  const name = escapeHtml(team?.name || team?.abbr || "Team");
  const abbr = escapeHtml(team?.abbr || "—");
  return team?.logo
    ? `<img class="team-logo" src="${escapeHtml(team.logo)}" alt="${name} logo" loading="lazy" referrerpolicy="no-referrer" />`
    : `<span class="team-logo fallback" aria-hidden="true">${abbr.slice(0, 3)}</span>`;
}

function projectedScore(card) {
  if (!card?.projection?.independent) {
    return `<div class="score-unavailable">Independent FBIS projection unavailable</div>`;
  }
  const live = card?.gameState?.live;
  const currentAway = card?.gameState?.currentScore?.away;
  const currentHome = card?.gameState?.currentScore?.home;
  const current = live && Number.isFinite(Number(currentAway)) && Number.isFinite(Number(currentHome))
    ? `<div class="live-score">LIVE SCORE ${fmtNumber(currentAway, 0)}–${fmtNumber(currentHome, 0)}</div>`
    : "";
  return `<div class="score"><span>${fmtNumber(card.projection.away)}</span> <small>–</small> <span>${fmtNumber(card.projection.home)}</span></div><div class="score-label">FBIS PREGAME PROJECTION</div>${current}`;
}

function qualityValue(card) {
  const n = Number(card?.quality?.score);
  if (!Number.isFinite(n)) return "—";
  return n <= 1 ? `${Math.round(n * 100)}` : `${Math.round(n)}`;
}

function publicCopy(card) {
  const p = card.projection || {};
  const away = card.away?.abbr || card.away?.name || "Away";
  const home = card.home?.abbr || card.home?.name || "Home";
  const score = p.independent ? `${away} ${fmtNumber(p.away)} — ${home} ${fmtNumber(p.home)}` : "Independent projection unavailable";
  const spread = p.independent ? `Fair margin: ${fmtSpread(-p.margin)} ${home}` : "";
  const total = p.independent ? `Fair total: ${fmtNumber(p.total)}` : "";
  const market = `Pinnacle: ${fmtSpread(card.market?.spread)} / ${fmtNumber(card.market?.total)}`;
  return [`FBIS ${String(card.sport || "").toUpperCase()} Pregame Projection`, score, spread, total, market, `Status: ${card.decision?.status || "PASS"}`].filter(Boolean).join("\n");
}

function gameStatusLabel(card) {
  const gs = card?.gameState || {};
  if (gs.live) return `<span class="live-game-label"><i></i>LIVE${gs.detail ? ` · ${escapeHtml(gs.detail)}` : ""}</span>`;
  if (gs.completed) return `<span class="final-game-label">FINAL${gs.detail ? ` · ${escapeHtml(gs.detail)}` : ""}</span>`;
  return `<span>${escapeHtml(fmtKickoff(card.start))}${card.neutral ? " · NEUTRAL" : ""}</span>`;
}

function cardHtml(card) {
  const status = String(card?.decision?.status || "PASS").toLowerCase();
  const away = card.away || {};
  const home = card.home || {};
  const fairSpread = card.projection?.independent ? -Number(card.projection.margin) : null;
  const marketSpread = card.market?.spread;
  const homeWp = card.projection?.pHome;
  return `
    <article class="game-card status-${escapeHtml(status)}${card?.gameState?.live ? " is-live" : ""}" data-game-id="${escapeHtml(card.id)}">
      <div class="game-top">
        ${gameStatusLabel(card)}
        <span class="status-pill ${escapeHtml(status)}">${escapeHtml(String(card.decision?.status || "PASS"))}</span>
      </div>
      <div class="matchup">
        <div class="team away">
          ${teamLogo(away)}
          <div><span class="team-name">${escapeHtml(away.name || away.abbr || "Away")}</span><span class="team-abbr">AWAY · ${escapeHtml(away.abbr || "—")}</span></div>
        </div>
        <div class="score-block">${projectedScore(card)}</div>
        <div class="team home">
          <div><span class="team-name">${escapeHtml(home.name || home.abbr || "Home")}</span><span class="team-abbr">HOME · ${escapeHtml(home.abbr || "—")}</span></div>
          ${teamLogo(home)}
        </div>
      </div>
      <div class="intel-grid">
        <div class="intel-cell"><span>FBIS FAIR SPREAD</span><strong>${Number.isFinite(fairSpread) ? fmtSpread(fairSpread) : "—"}</strong></div>
        <div class="intel-cell"><span>FBIS FAIR TOTAL</span><strong>${fmtNumber(card.projection?.total)}</strong></div>
        <div class="intel-cell"><span>HOME WIN PROB</span><strong>${fmtProbability(homeWp)}</strong></div>
        <div class="intel-cell"><span>FAIR HOME ML</span><strong>${fmtAmerican(card.projection?.fairHomeMl)}</strong></div>
      </div>
      <div class="intel-grid">
        <div class="intel-cell"><span>PIN SPREAD</span><strong>${fmtSpread(marketSpread)}</strong></div>
        <div class="intel-cell"><span>PIN TOTAL</span><strong>${fmtNumber(card.market?.total)}</strong></div>
        <div class="intel-cell"><span>PIN HOME ML</span><strong>${fmtAmerican(card.market?.homeMl)}</strong></div>
        <div class="intel-cell"><span>MODEL QUALITY</span><strong>${qualityValue(card)}</strong></div>
      </div>
      <div class="card-footer">
        <span>${escapeHtml(card.modelVersion || "Model version unavailable")}${card?.gameState?.live ? " · Live game — pregame projection remains frozen" : ""}${card.decision?.blocked && card.decision?.blockReason ? ` · ${escapeHtml(card.decision.blockReason)}` : ""}</span>
        <button type="button" class="copy-button" data-copy-game="${escapeHtml(card.id)}">COPY PROJECTION</button>
      </div>
    </article>`;
}

function renderLoading() {
  els.grid.innerHTML = `<div class="game-card skeleton"></div><div class="game-card skeleton"></div>`;
}

function renderBoard(data) {
  els.title.textContent = `${String(data.sport || state.sport).toUpperCase()} · ${data.date || state.date} · ${data.games?.length || 0} games`;
  els.version.textContent = data.modelVersion || "—";
  els.updated.textContent = fmtTimestamp(data.generatedAt);
  els.disclaimer.textContent = data.disclaimer || "Model projections and market intelligence are informational.";
  const games = Array.isArray(data.games) ? [...data.games].sort((a, b) => Date.parse(a.start || 0) - Date.parse(b.start || 0)) : [];
  els.grid.innerHTML = games.length ? games.map(cardHtml).join("") : `<div class="empty-state">No projection cards are available for this date. This does not imply a PASS slate; it means the board has no publishable game records.</div>`;
  for (const button of document.querySelectorAll("[data-copy-game]")) {
    button.addEventListener("click", async () => {
      const card = games.find((g) => String(g.id) === button.dataset.copyGame);
      if (!card) return;
      try {
        await navigator.clipboard.writeText(publicCopy(card));
        const before = button.textContent;
        button.textContent = "COPIED";
        setTimeout(() => { button.textContent = before; }, 1200);
      } catch {
        button.textContent = "COPY UNAVAILABLE";
      }
    });
  }
}

function syncControls() {
  els.date.value = state.date;
  for (const button of els.sportButtons) {
    const active = button.dataset.sport === state.sport;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  }
  const url = new URL(window.location.href);
  url.searchParams.set("sport", state.sport);
  url.searchParams.set("date", state.date);
  window.history.replaceState({}, "", url);
}

function showError(message) {
  els.alert.hidden = false;
  els.alert.textContent = message;
}

function clearError() {
  els.alert.hidden = true;
  els.alert.textContent = "";
}

async function loadBoard() {
  if (state.loading) return;
  state.loading = true;
  clearError();
  renderLoading();
  els.refresh.disabled = true;
  els.refresh.textContent = "Loading…";
  syncControls();
  try {
    const query = new URLSearchParams({ sport: state.sport, date: state.date, tier: "public" });
    const response = await fetch(`/api/projections?${query.toString()}`, { headers: { Accept: "application/json" } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.ok) throw new Error(body.detail || body.error || `Projection API HTTP ${response.status}`);
    renderBoard(body);
  } catch (error) {
    showError(`Projection board unavailable: ${String(error?.message || error)}`);
    els.grid.innerHTML = `<div class="empty-state">The public board could not be loaded. No projection or wagering conclusion should be inferred from this outage.</div>`;
  } finally {
    state.loading = false;
    els.refresh.disabled = false;
    els.refresh.textContent = "Refresh";
  }
}

for (const button of els.sportButtons) {
  button.addEventListener("click", () => {
    state.sport = button.dataset.sport;
    loadBoard();
  });
}

els.date.addEventListener("change", () => {
  if (!els.date.value) return;
  state.date = els.date.value;
  loadBoard();
});
els.refresh.addEventListener("click", loadBoard);

syncControls();
loadBoard();
