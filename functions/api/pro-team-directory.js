import { getProTeamDirectory, loadProTeamRoster } from "../lib/proTeamDirectory.js";

function json(data, status = 200, maxAge = 600) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=" + maxAge + ", stale-while-revalidate=600",
      "access-control-allow-origin": "*"
    }
  });
}

export async function onRequestGet({ request }) {
  const params = new URL(request.url).searchParams;
  const sport = String(params.get("sport") || "").toLowerCase();
  const teams = getProTeamDirectory(sport);
  if (!teams) return json({ ok: false, error: "supported-sports-nfl-nba-nhl" }, 400, 0);
  const team = String(params.get("team") || "").trim();
  if (!team) return json({ ok: true, sport, teams, teamCount: teams.length, source: "FBIS_CANONICAL_TEAM_REGISTRY" }, 200, 3600);
  const roster = await loadProTeamRoster({ sport, team });
  return json(roster, roster.ok ? 200 : roster.status || 502, roster.ok ? 900 : 0);
}
