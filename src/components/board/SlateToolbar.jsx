import {
  boardDecisionCounts,
  formatBoardDate,
} from "../../lib/boardDecision.js";

const FILTERS = ["ALL", "CONVICTION", "QUALIFIED", "LEAN", "PASS", "NO_MODEL"];

export default function SlateToolbar({
  sport,
  games = [],
  filter,
  onFilterChange,
  hideBlocked,
  onHideBlockedChange,
  weekControls = null,
  slateMeta = null,
}) {
  const counts = boardDecisionCounts(games);
  const firstStart = games.find((g) => g?.start)?.start;
  const date = formatBoardDate(firstStart);
  return (
    <div className="slate-intel-toolbar">
      <div className="slate-intel-left">
        <div className="slate-intel-sport">{String(sport || "").toUpperCase()}</div>
        <div className="slate-intel-date">
          {date.dateLine}
          {slateMeta ? <span className="muted"> · {slateMeta}</span> : null}
        </div>
      </div>
      <div className="slate-intel-filters" role="toolbar" aria-label="Decision filters">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            className={`slate-filter-btn${filter === f ? " active" : ""}`}
            onClick={() => onFilterChange?.(f)}
            aria-pressed={filter === f}
          >
            {f}
            <span className="slate-filter-count">{f === "ALL" ? counts.ALL : counts[f] || 0}</span>
          </button>
        ))}
        <label className="slate-hide-blocked">
          <input
            type="checkbox"
            checked={Boolean(hideBlocked)}
            onChange={(e) => onHideBlockedChange?.(e.target.checked)}
          />
          Hide blocked
        </label>
      </div>
      <div className="slate-intel-summary" aria-live="polite">
        <span>{counts.ALL} GAMES</span>
        <span>{counts.CONVICTION} CONVICTION</span>
        <span>{counts.QUALIFIED} QUALIFIED</span>
        <span>{counts.LEAN} LEAN</span>
        <span>{counts.PASS} PASS</span>
        {counts.NO_MODEL ? <span>{counts.NO_MODEL} NO MODEL</span> : null}
        {counts.BLOCKED ? <span>{counts.BLOCKED} BLOCKED</span> : null}
      </div>
      {weekControls}
      <div className="slate-intel-sort muted">SORT: DECISION → TIME</div>
    </div>
  );
}
