/** FBS-vs-FBS research cards; never fabricates a name, usage or sportsbook line. */
const MARKETS = {
  QB1: [["passing_yards", "Pass yards"], ["passing_attempts", "Pass attempts"],
        ["completions", "Completions"], ["rushing_yards", "Rush yards"]],
  RB1: [["rushing_yards", "Rush yards"], ["rushing_attempts", "Carries"]],
  WR1: [["receiving_yards", "Rec yards"], ["receptions", "Receptions"]],
  WR2: [["receiving_yards", "Rec yards"], ["receptions", "Receptions"]],
};
const ROLES = ["QB1", "RB1", "WR1", "WR2"];

function displayNumber(v) {
  if (v == null || v === "" || !Number.isFinite(Number(v))) return "—";
  return Number(v).toFixed(1);
}

export default function CfbFbsPropCards({ game = {} }) {
  if (game.cfbFbsMatchup !== true) return null;
  const current = Array.isArray(game.cfbPlayerRoleCards) ? game.cfbPlayerRoleCards : [];
  return (
    <section className="cfb-fbs-props" aria-label="FBS player prop research cards">
      <div className="cfb-fbs-props-heading">
        <strong>FBS PLAYER PROJECTIONS</strong>
        <span>QB1 · RB1 · WR1 · WR2 · RESEARCH ONLY</span>
      </div>
      <p className="cfb-fbs-props-disclaimer">
        Eight player roles per FBS matchup. FBIS numbers require verified pregame
        identity and usage. Missing projections and market prices are unavailable,
        not zero. No betting authority.
      </p>
      <div className="cfb-fbs-props-grid">
        {["away", "home"].flatMap((side) => ROLES.map((role) => {
          const row = current.find((x) => x.side === side && x.role === role) || {};
          const name = row.playerName || null;
          const available = Boolean(name && row.state === "RESEARCH" && (row.markets || []).length);
          const team = game[side]?.abbr || game[side]?.name || side.toUpperCase();
          return (
            <article className="cfb-fbs-prop-card" key={`${side}:${role}`}
              aria-label={`${team} ${role} research projection`}>
              <header>
                <span>{team} · {role}</span>
                <b>{available ? "PROVISIONAL" : "DATA UNAVAILABLE"}</b>
              </header>
              <strong>{name || "Player not verified"}</strong>
              <div className="cfb-fbs-prop-markets">
                {MARKETS[role].map(([market, label]) => {
                  const projection = available
                    ? row.markets.find((m) => m.market === market)?.fbisProjection
                    : null;
                  return (
                    <div key={market}>
                      <span>{label}</span><b>{displayNumber(projection)}</b>
                    </div>
                  );
                })}
              </div>
              <small>{available
                ? "PIT usage · SHADOW · no market attached"
                : "Awaiting verified pregame role + player stats"}</small>
            </article>
          );
        }))}
      </div>
    </section>
  );
}
