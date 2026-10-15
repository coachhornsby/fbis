/** Read-only player evidence for independently verified tennis fixtures.
 * Player data enriches research cards; it never establishes a fixture or wager authority.
 * Canonical lookup prefers RANKED_ACTIVE library members.
 */
import { TENNIS_LIBRARY_ACTIVE_ORDER, isTennisLibraryActive } from "./tennisActiveLibrary.js";
const normalize = value => String(value || "").normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "").toLowerCase()
  .replace(/[^a-z0-9]+/g, " ").trim();
const validTour = new Set(["atp", "wta"]);
function single(rows, key) {
  const matches = (rows || []).filter(x => normalize(x.player_name) === key);
  if (matches.length === 1) return matches[0];
  const active = matches.filter(isTennisLibraryActive);
  return active.length === 1 ? active[0] : null;
}
export async function resolveTennisFixturePlayers(db, fixture) {
  const tour = String(fixture?.tour || "").toLowerCase();
  const names = [fixture?.away_name, fixture?.home_name];
  if (!db?.prepare || !validTour.has(tour) || !fixture?.id ||
      names.some(n => !n || /[\\/&]/.test(n) || normalize(n).split(" ").length < 2) ||
      normalize(names[0]) === normalize(names[1]))
    return { fixtureId: fixture?.id || null, verified: false, reason: "INVALID_FIXTURE", players: [] };
  const players = [];
  for (const name of names) {
    const key = normalize(name);
    const official = await db.prepare(
      `SELECT fbis_player_id AS player_id,canonical_name AS player_name,current_rank,ranking_points,country_code,official_source,official_headshot_url AS headshot_url,career_wins,career_losses,official_observed_at AS source_as_of,active_state FROM tennis_players WHERE tour=? AND normalized_name=? ORDER BY ${TENNIS_LIBRARY_ACTIVE_ORDER} LIMIT 2`
    ).bind(tour, key).all();
    const canonical = single(official?.results, key);
    const ambiguousOfficial = !canonical && (official?.results || []).length > 1;
    if (ambiguousOfficial) {
      players.push({ fixtureName: name, matched: false, reason: "AMBIGUOUS_CANONICAL_IDENTITY" });
      continue;
    }
    const bank = await db.prepare(
      "SELECT player_id,player_name,current_rank,headshot_url,source_as_of FROM tennis_player_bank WHERE tour=? AND player_key=? LIMIT 2"
    ).bind(tour, key).all();
    const supplement = single(bank?.results, key);
    const ambiguousBank = (bank?.results || []).length > 1;
    if (ambiguousBank && !canonical) {
      players.push({ fixtureName: name, matched: false, reason: "AMBIGUOUS_BANK_IDENTITY" });
      continue;
    }
    if (!canonical && !supplement) {
      players.push({ fixtureName: name, matched: false, reason: "PLAYER_NOT_IN_DIRECTORY" });
      continue;
    }
    players.push({ fixtureName: name, matched: true,
      identityAuthority: canonical ? "CANONICAL" : "SUPPLEMENTAL_NAME_ONLY",
      identitySource: canonical?.official_source || null,
      officialIdentityVerified: /^(ATP|WTA)_OFFICIAL$/.test(canonical?.official_source || ""),
      fbisPlayerId: canonical?.player_id || null,
      supplementalPlayerId: supplement?.player_id || null,
      playerName: canonical?.player_name || supplement.player_name,
      rank: canonical?.current_rank ?? supplement?.current_rank ?? null,
      rankingPoints: canonical?.ranking_points ?? null,
      country: canonical?.country_code ?? null,
      headshotUrl: canonical?.headshot_url || supplement?.headshot_url || null,
      careerWins: canonical?.career_wins ?? null,
      careerLosses: canonical?.career_losses ?? null,
      sourceAsOf: canonical?.source_as_of || supplement?.source_as_of || null
    });
  }
  return { fixtureId: fixture.id, tour, verified: players.every(p => p.matched),
    players, researchOnly: true, canQualify: false, canAuthorizeWager: false };
}
