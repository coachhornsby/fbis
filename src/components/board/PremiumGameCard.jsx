import TeamLogo from "../TeamLogo.jsx";
import { buildGameCardViewModel } from "../../lib/gameCardViewModel.js";
import { venueAtmosphereClass } from "../../lib/venueAtmosphere.js";
import AdvancedGameDetail from "./AdvancedGameDetail.jsx";
import "./premiumGameCard.css";

function StatusPill({ status }) {
  if (!status?.label) return null;
  const tone = String(status.tone || status.key || "neutral").toLowerCase();
  return (
    <span className={`pgc-status pgc-status-${tone}`}>
      {tone === "qualified" ? "✓ " : ""}
      {status.label}
    </span>
  );
}

function SideBox({ title, side }) {
  if (!side) {
    return (
      <div className="pgc-side-box">
        <span className="pgc-side-box-title">{title}</span>
        <span className="pgc-empty-inline">—</span>
      </div>
    );
  }
  const team = side.team || null;
  return (
    <div className="pgc-side-box">
      <span className="pgc-side-box-title">{title}</span>
      <div className="pgc-side-box-body">
        {team ? <TeamLogo team={team} size={20} /> : null}
        <span>{side.label || side.abbr || "—"}</span>
      </div>
    </div>
  );
}

function SplitMeter({ label, awayPct, homePct, away, home }) {
  const a = awayPct ?? 0;
  const h = homePct ?? 0;
  return (
    <div className="pgc-meter">
      <div className="pgc-meter-lab">{label}</div>
      <div className="pgc-meter-row">
        <div className="pgc-meter-track" aria-hidden="true">
          <div className="pgc-meter-away" style={{ width: `${a}%` }} />
          <div className="pgc-meter-home" style={{ width: `${h}%` }} />
        </div>
      </div>
      <div className="pgc-meter-legend">
        <span>
          <TeamLogo team={away} size={14} /> {a}%
        </span>
        <span>
          <TeamLogo team={home} size={14} /> {h}%
        </span>
      </div>
    </div>
  );
}

/**
 * Premium sports-dashboard game card — mockup-faithful, sport-specific units/copy.
 * Presentation only — no authority / model mutation.
 */
export default function PremiumGameCard({
  game,
  open = false,
  onToggle,
  renderDetail = null,
}) {
  const vm = buildGameCardViewModel(game);
  if (!vm?.id && !game?.id) return null;

  const sport = vm.sport || game?.sport;
  const venueClass = venueAtmosphereClass(sport);
  const cardKey = `${sport || ""}:${vm.id || game?.id}`;
  const units = vm.units || {};
  const away = vm.away;
  const home = vm.home;
  const cmp = vm.comparison || {};
  const action = vm.action || {};
  const ctx = vm.context || {};
  const bars = vm.bars || {};
  const footer = vm.footer || {};

  const handleToggle = () => onToggle?.(cardKey);

  return (
    <article
      className={`pgc${venueClass ? ` ${venueClass}` : ""} status-${String(vm.status?.tone || "neutral").toLowerCase()}${open ? " pgc-open" : ""}`}
      data-sport={sport || ""}
      data-game-id={vm.id || game?.id || ""}
    >
      <div className="pgc-top">
        <div className="pgc-top-left">
          {vm.event?.live ? <span className="pgc-live-dot" aria-hidden="true" /> : null}
          <span className="pgc-time">{vm.timing?.timeLine || "—"}</span>
          <span className="pgc-sport-pill">{String(sport || "").toUpperCase() || "—"}</span>
        </div>
        <StatusPill status={vm.status} />
      </div>

      <section className="pgc-hero" aria-label="Matchup">
        <div className="pgc-hero-team">
          <TeamLogo team={away} size={72} />
          <div className="pgc-hero-id">
            <span className="pgc-hero-abbr">{away?.abbr || "—"}</span>
            <span className="pgc-hero-name">{nickname(away)}</span>
            {away?.record ? <span className="pgc-hero-record">({away.record})</span> : null}
          </div>
          <div className="pgc-hero-proj">
            <span className="pgc-hero-score">
              {vm.projection?.available ? (vm.projection.away ?? "—") : "—"}
            </span>
            <span className="pgc-hero-proj-lab">{units.projectedLabel || "FBIS PROJECTED"}</span>
          </div>
        </div>

        <div className="pgc-hero-mid">
          {ctx.venueLabel ? <div className="pgc-hero-venue">{ctx.venueLabel}</div> : null}
          <div className="pgc-vs">VS</div>
          {ctx.weatherLine ? <div className="pgc-weather">{ctx.weatherLine}</div> : null}
          {vm.projection?.research ? (
            <div className="pgc-research-tag">RESEARCH PROJECTION</div>
          ) : null}
          {!vm.projection?.available ? (
            <div className="pgc-no-fbis">NO FBIS PROJECTION</div>
          ) : null}
        </div>

        <div className="pgc-hero-team">
          <TeamLogo team={home} size={72} />
          <div className="pgc-hero-id">
            <span className="pgc-hero-abbr">{home?.abbr || "—"}</span>
            <span className="pgc-hero-name">{nickname(home)}</span>
            {home?.record ? <span className="pgc-hero-record">({home.record})</span> : null}
          </div>
          <div className="pgc-hero-proj">
            <span className="pgc-hero-score">
              {vm.projection?.available ? (vm.projection.home ?? "—") : "—"}
            </span>
            <span className="pgc-hero-proj-lab">{units.projectedLabel || "FBIS PROJECTED"}</span>
          </div>
        </div>
      </section>

      <section className="pgc-bars" aria-label="FBIS versus market totals">
        <div className="pgc-bar-row">
          <span className="pgc-bar-lab fbis">FBIS</span>
          <div className="pgc-bar-track">
            <div className="pgc-bar-fill fbis" style={{ width: `${bars.fbisPct ?? 0}%` }} />
          </div>
          <span className="pgc-bar-val fbis">
            FBIS TOTAL {bars.fbisTotal ?? "—"}
          </span>
        </div>
        <div className="pgc-bar-row">
          <span className="pgc-bar-lab mkt">MARKET</span>
          <div className="pgc-bar-track">
            <div className="pgc-bar-fill mkt" style={{ width: `${bars.marketPct ?? 0}%` }} />
          </div>
          <span className="pgc-bar-val mkt">
            MARKET TOTAL {bars.marketTotal ?? "—"}
          </span>
        </div>
      </section>

      <section className="pgc-panels">
        <div className="pgc-panel pgc-panel-model">
          <h3 className="pgc-panel-title">MODEL vs MARKET</h3>

          <div className="pgc-diff-cell">
            <span className="pgc-diff-lab">⚔ SIDE DIFF</span>
            <span className="pgc-diff-val">{cmp.sideDiffLabel || "—"}</span>
            {cmp.sideRelationshipLabel ? (
              <span
                className={`pgc-pill ${
                  cmp.sideRelationship === "OPPOSITE_SIDES" ? "warn" : "ok"
                }`}
              >
                {cmp.sideRelationshipLabel}
              </span>
            ) : null}
            <div className="pgc-side-compare">
              <SideBox title="FBIS" side={cmp.fbisSide} />
              <SideBox title="MARKET" side={cmp.marketSide} />
            </div>
          </div>

          <div className="pgc-diff-cell">
            <span className="pgc-diff-lab">TOTAL DIFF</span>
            <span className="pgc-diff-val">{cmp.totalDiffLabel || "—"}</span>
            {cmp.totalDirectionLabel ? (
              <span
                className={`pgc-pill ${
                  cmp.totalDirection === "FBIS_HIGHER"
                    ? "up"
                    : cmp.totalDirection === "FBIS_LOWER"
                      ? "down"
                      : "ok"
                }`}
              >
                {cmp.totalDirection === "FBIS_HIGHER" ? "↑ " : ""}
                {cmp.totalDirectionLabel}
              </span>
            ) : null}
            <div className="pgc-total-compare">
              <div className="pgc-mini-box">
                <span>FBIS</span>
                <strong>{cmp.fbisTotal ?? "—"}</strong>
              </div>
              <div className="pgc-mini-box">
                <span>MARKET</span>
                <strong>{cmp.marketTotal ?? "—"}</strong>
              </div>
            </div>
          </div>
        </div>

        <div className="pgc-panel pgc-panel-action">
          <h3 className="pgc-panel-title">
            <span>🔥 ACTION INTEL</span>
            <span className="pgc-powered">Powered by ACTION</span>
          </h3>

          {action.available ? (
            <>
              {action.headline ? (
                <div className="pgc-signal">
                  <div className="pgc-signal-top">
                    <span>{action.headline.icon || "◎"}</span>
                    <span>{action.headline.label}</span>
                  </div>
                  <div className="pgc-signal-body">
                    {action.headline.team ? (
                      <TeamLogo team={action.headline.team} size={28} />
                    ) : null}
                    <div>
                      {action.headline.lineLabel ? (
                        <div className="pgc-signal-line">{action.headline.lineLabel}</div>
                      ) : null}
                      {action.headline.detail ? (
                        <div className="pgc-signal-detail">{action.headline.detail}</div>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}

              {action.tickets || action.money ? (
                <div className="pgc-meters">
                  {action.tickets ? (
                    <SplitMeter
                      label="TICKETS"
                      awayPct={action.tickets.awayPct}
                      homePct={action.tickets.homePct}
                      away={away}
                      home={home}
                    />
                  ) : null}
                  {action.money ? (
                    <SplitMeter
                      label="MONEY"
                      awayPct={action.money.awayPct}
                      homePct={action.money.homePct}
                      away={away}
                      home={home}
                    />
                  ) : null}
                </div>
              ) : null}

              <div className="pgc-action-facts">
                {action.lineMove?.label ? (
                  <div className="pgc-fact">
                    <span>LINE MOVE</span>
                    <strong>{action.lineMove.label}</strong>
                  </div>
                ) : null}
                {action.sample?.label ? (
                  <div className="pgc-fact">
                    <span>SAMPLE SIZE</span>
                    <strong>
                      {action.sample.label}
                      {action.sample.count != null ? " tracked bets" : ""}
                    </strong>
                  </div>
                ) : null}
                {action.bookRange?.label ? (
                  <div className="pgc-fact">
                    <span>BOOK RANGE</span>
                    <strong>{action.bookRange.label}</strong>
                  </div>
                ) : null}
              </div>
            </>
          ) : (
            <div className="pgc-action-empty" aria-label="ACTION snapshot unavailable">
              <div className="pgc-meters pgc-meters-empty">
                <SplitMeter label="TICKETS" awayPct={0} homePct={0} away={away} home={home} />
                <SplitMeter label="MONEY" awayPct={0} homePct={0} away={away} home={home} />
              </div>
              <div className="pgc-action-facts">
                <div className="pgc-fact">
                  <span>LINE MOVE</span>
                  <strong>—</strong>
                </div>
                <div className="pgc-fact">
                  <span>SAMPLE SIZE</span>
                  <strong>—</strong>
                </div>
                <div className="pgc-fact">
                  <span>BOOK RANGE</span>
                  <strong>—</strong>
                </div>
              </div>
              <p className="pgc-empty">
                {action.emptyLabel || "NO ACTION SNAPSHOT YET"}
              </p>
            </div>
          )}
        </div>

        <div className="pgc-panel pgc-panel-info">
          <h3 className="pgc-panel-title">GAME INFO</h3>

          {ctx.startersLabel && (ctx.starters?.away || ctx.starters?.home) ? (
            <div className="pgc-info-block">
              <div className="pgc-info-lab">⚾ {ctx.startersLabel}</div>
              {["away", "home"].map((side) => {
                const s = ctx.starters?.[side];
                if (!s) return null;
                return (
                  <div key={side} className="pgc-starter">
                    <TeamLogo team={s.team || (side === "away" ? away : home)} size={20} />
                    <div>
                      <strong>{s.name}</strong>
                      <span>
                        {[
                          s.hand ? `${s.hand}HP` : null,
                          s.era != null ? `${Number(s.era).toFixed(2)} ERA` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}

          {ctx.venueLabel ? (
            <div className="pgc-info-row">
              <strong>🏟 {ctx.venueName || ctx.venueLabel}</strong>
              {ctx.venueCity ? <span>{ctx.venueCity}</span> : null}
            </div>
          ) : null}

          {ctx.weatherLine ? (
            <div className="pgc-info-row">
              <strong>🌤 {ctx.weatherLine}</strong>
              {ctx.weather?.windLabel ? <span>{ctx.weather.windLabel}</span> : null}
            </div>
          ) : null}

          {!ctx.starters?.away && !ctx.starters?.home && !ctx.venueLabel && !ctx.weatherLine ? (
            <p className="pgc-empty">No game context yet.</p>
          ) : null}
        </div>
      </section>

      <footer className="pgc-footer">
        <span className="pgc-foot-src">{footer.marketSourceLabel || "Market Source: —"}</span>
        <span className={`pgc-foot-fresh${footer.stale ? " is-stale" : ""}`}>
          {footer.asOfLabel || ""}
        </span>
        {typeof onToggle === "function" ? (
          <button type="button" className="pgc-details-btn" onClick={handleToggle}>
            {open ? "Hide Details" : "View Details"} →
          </button>
        ) : (
          <span className="pgc-details-btn" aria-hidden="true">
            View Details →
          </span>
        )}
      </footer>

      {open ? (
        <div className="pgc-advanced">
          <AdvancedGameDetail game={game} onClose={handleToggle} />
          {typeof renderDetail === "function" ? (
            <div className="pgc-detail">{renderDetail(game)}</div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
function nickname(team) {
  if (!team) return "—";
  const full = String(team.fullName || team.displayName || "").trim();
  const short = String(team.name || "").trim();
  if (short && (!full || full.toUpperCase().endsWith(short.toUpperCase()))) {
    return short.toUpperCase();
  }
  if (full) {
    const parts = full.split(/\s+/);
    return (parts.length > 1 ? parts.slice(1).join(" ") : full).toUpperCase();
  }
  return String(team.abbr || "—").toUpperCase();
}
