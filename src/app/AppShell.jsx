import {
  ADMIN_NAV,
  CUSTOMER_NAV,
  SPORT_FILTERS,
  formatShellDate,
} from "./navigation.js";

/**
 * Product application shell — customer nav + sport filters + admin entry.
 * Presentational only; data loading stays in App.
 */
export default function AppShell({
  route,
  sportFilter = "all",
  freshnessLabel = "MARKET DATA",
  freshnessState = "CURRENT",
  healthLabel = "",
  healthTone = "ok",
  onRouteChange,
  onSportFilterChange,
  onRefresh,
  refreshDisabled = false,
  refreshLabel = "↻ Refresh",
  children,
}) {
  const dateLabel = formatShellDate(new Date());
  const showSportFilter = ["today", "markets", "player-props", "performance"].includes(route);

  return (
    <>
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <header className="app-header app-shell-header">
        <div className="shell-brand">
          <h1>FBIS</h1>
          <div className="header-divider" />
          <div className="shell-brand-copy">
            <span className="shell-date">{dateLabel}</span>
            <span className="shell-tagline">Model → Market → Movement → Price → Decision</span>
          </div>
        </div>

        <nav className="nav-tabs shell-nav" role="tablist" aria-label="Customer views">
          {CUSTOMER_NAV.map((item) => (
            <button
              key={item.id}
              role="tab"
              type="button"
              title={item.description}
              aria-selected={route === item.id}
              className={route === item.id ? "active" : ""}
              onClick={() => onRouteChange?.(item.id)}
            >
              {item.label}
            </button>
          ))}
          {ADMIN_NAV.map((item) => (
            <button
              key={item.id}
              role="tab"
              type="button"
              title={item.description}
              aria-selected={route === item.id}
              className={`shell-admin-tab ${route === item.id ? "active" : ""}`}
              onClick={() => onRouteChange?.(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="header-actions">
          <button
            type="button"
            className="header-btn header-btn-refresh"
            onClick={onRefresh}
            disabled={refreshDisabled}
          >
            {refreshLabel}
          </button>
          <span className={`overall-badge badge-${healthTone}`}>{healthLabel || freshnessLabel}</span>
        </div>
      </header>

      {showSportFilter ? (
        <div className="shell-filter-bar" role="toolbar" aria-label="Sport filter">
          <div className="shell-sport-filters">
            {SPORT_FILTERS.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`shell-sport-chip ${sportFilter === s.id ? "active" : ""}`}
                aria-pressed={sportFilter === s.id}
                onClick={() => onSportFilterChange?.(s.id)}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className={`shell-freshness freshness-${String(freshnessState).toLowerCase()}`}>
            <span className="shell-freshness-dot" aria-hidden="true" />
            <span>{freshnessLabel}</span>
            <span className="muted">{freshnessState}</span>
          </div>
        </div>
      ) : null}

      <main id="main-content" className="shell-main">
        {children}
      </main>
    </>
  );
}

export function FeaturePlaceholder({ title, body, status = "BUILDING" }) {
  return (
    <section className="shell-placeholder panel" aria-label={title}>
      <div className="shell-placeholder-kicker">{status}</div>
      <h2>{title}</h2>
      <p className="muted">{body}</p>
      <p className="shell-placeholder-note">
        FBIS will not invent rankings, prices, or qualified plays to fill this surface.
      </p>
    </section>
  );
}
