/** Read-only player evidence for independently verified tennis fixtures.
 * Player data enriches research cards; it never establishes a fixture or wager authority.
 */
const normalize = value => String(value || "").normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "").toLowerCase()
  .replace(/[^a-z0-9]+/g, " ").trim();
const validTour = new Set(["atp", "wta"]);
function single(rows, key) {
  const matches = (rows || []).filter(x => normalize(x.player_name) === key);
  return matches.length === 1 ? matches[0] : null;
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
      "SELECT fbis_player_id AS player_id,canonical_name AS player_name,current_rank,ranking_points,country_code,official_source,official_headshot_source AS headshot_source,official_headshot_url AS headshot_url,career_wins,career_losses,official_observed_at AS source_as_of FROM tennis_players WHERE tour=? AND normalized_name=? LIMIT 2"
    ).bind(tour, key).all();
    let canonical = single(official?.results, key);
    let aliasSource = null;
    const ambiguousOfficial = (official?.results || []).length > 1;
    // Resolve only explicitly registered, active aliases. An alias cannot
    // override a direct identity, and multiple canonical destinations fail shut.
    if (!canonical && !ambiguousOfficial) {
      const aliases = await db.prepare(`SELECT p.fbis_player_id AS player_id,
        p.canonical_name AS player_name,p.current_rank,p.ranking_points,
        p.country_code,p.official_source,p.official_headshot_source AS headshot_source,
        p.official_headshot_url AS headshot_url,p.career_wins,p.career_losses,
        p.official_observed_at AS source_as_of,a.source AS alias_source
        FROM tennis_player_aliases a
        JOIN tennis_players p ON p.fbis_player_id=a.fbis_player_id
        WHERE a.alias_normalized=? AND a.active=1 AND p.tour=?
        ORDER BY a.source_priority DESC LIMIT 3`)
        .bind(key,tour).all();
      const unique = new Map((aliases?.results || []).map(r=>[r.player_id,r]));
      if (unique.size>1) {
        players.push({fixtureName:name,matched:false,reason:"AMBIGUOUS_CANONICAL_ALIAS"});
        continue;
      }
      canonical = [...unique.values()][0] || null;
      aliasSource = canonical?.alias_source || null;
    }
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
      identityAliasSource: aliasSource,
      officialIdentityVerified: /^(ATP|WTA)_OFFICIAL$/.test(canonical?.official_source || ""),
      fbisPlayerId: canonical?.player_id || null,
      supplementalPlayerId: supplement?.player_id || null,
      playerName: canonical?.player_name || supplement.player_name,
      rank: canonical?.current_rank ?? supplement?.current_rank ?? null,
      rankingPoints: canonical?.ranking_points ?? null,
      country: canonical?.country_code ?? null,
      headshotUrl: canonical?.headshot_url || supplement?.headshot_url || null,
      headshotSource: canonical?.headshot_source || null,
      careerWins: canonical?.career_wins ?? null,
      careerLosses: canonical?.career_losses ?? null,
      sourceAsOf: canonical?.source_as_of || supplement?.source_as_of || null
    });
  }
  return { fixtureId: fixture.id, tour, verified: players.every(p => p.matched),
    players, researchOnly: true, canQualify: false, canAuthorizeWager: false };
}
