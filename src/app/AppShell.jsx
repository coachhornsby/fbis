import {
  ADMIN_NAV,
  CUSTOMER_NAV,
  FBIS_PRODUCT_SUBTITLE,
  FBIS_WORKFLOW_TAGLINE,
  SPORT_FILTER_ROUTES,
  SPORT_FILTERS,
  formatShellDate,
} from "./navigation.js";

/**
 * FBIS product shell — Board-first decision workstation.
 * Presentational only; data loading stays in App.
 */
export default function AppShell({
  route,
  sportFilter = "all",
  sportCounts = null,
  freshnessLabel = "DATA",
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
  const showSportFilter = SPORT_FILTER_ROUTES.includes(route);
  const healthDegraded = healthTone === "warn" || healthTone === "bad" || freshnessState === "STALE";

  return (
    <>
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <header className="app-header app-shell-header fbis-shell-header">
        <div className="shell-brand">
          <h1 className="shell-brand-mark">FBIS</h1>
          <div className="header-divider" />
          <div className="shell-brand-copy">
            <span className="shell-product-subtitle">{FBIS_PRODUCT_SUBTITLE}</span>
            <span className="shell-date">{dateLabel}</span>
            <span className="shell-tagline">{FBIS_WORKFLOW_TAGLINE}</span>
          </div>
        </div>

        <nav className="nav-tabs shell-nav shell-nav-desktop" role="tablist" aria-label="Primary views">
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
          <span
            className={`overall-badge badge-${healthTone} ${healthDegraded ? "badge-actionable" : "badge-subtle"}`}
            title={healthDegraded ? "Open SYSTEM for diagnostics" : "Operational health"}
          >
            {healthDegraded ? "⚠ " : "● "}
            {healthLabel || freshnessLabel}
          </span>
        </div>
      </header>

      {showSportFilter ? (
        <div className="shell-filter-bar" role="toolbar" aria-label="Sport filter">
          <div className="shell-sport-filters" role="group" aria-label="Sports">
            {SPORT_FILTERS.map((s) => {
              const count = sportCounts?.[s.id];
              return (
                <button
                  key={s.id}
                  type="button"
                  className={`shell-sport-chip ${sportFilter === s.id ? "active" : ""}`}
                  aria-pressed={sportFilter === s.id}
                  onClick={() => onSportFilterChange?.(s.id)}
                >
                  {s.label}
                  {s.id !== "all" && count != null ? (
                    <span className="shell-sport-count">{count}</span>
                  ) : null}
                </button>
              );
            })}
          </div>
          <div className={`shell-freshness freshness-${String(freshnessState).toLowerCase()}`}>
            <span className="shell-freshness-dot" aria-hidden="true" />
            <span>{freshnessLabel}</span>
            <span className="muted">{freshnessState}</span>
          </div>
        </div>
      ) : null}

      <main id="main-content" className="shell-main fbis-shell-main">
        {children}
      </main>

      <nav className="shell-mobile-nav" aria-label="Mobile primary navigation">
        {[...CUSTOMER_NAV, ...ADMIN_NAV].map((item) => (
          <button
            key={item.id}
            type="button"
            className={`shell-mobile-nav-item ${route === item.id ? "active" : ""}`}
            aria-current={route === item.id ? "page" : undefined}
            onClick={() => onRouteChange?.(item.id)}
          >
            <span className="shell-mobile-nav-label">{item.label}</span>
          </button>
        ))}
      </nav>
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
        FBIS will not invent rankings, prices, EV, or qualified plays to fill this surface.
      </p>
    </section>
  );
}
