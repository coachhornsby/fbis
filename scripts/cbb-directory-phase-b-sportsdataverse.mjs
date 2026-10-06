#!/usr/bin/env node
/**
 * CBB Directory Phase B SportsDataverse bulk-source adapter.
 * Pins immutable GitHub release assets and emits normalized source rows.
 * No model/projection authority. Availability is never inferred from participation.
 */
import { createHash } from "node:crypto";

export const CBB_SD_SOURCES = Object.freeze({
  roster2027: {
    tag: "espn_mens_college_basketball_rosters",
    asset: "rosters_2027.csv",
    sha256: "4d11c6c4f33b31b676ae571df4939b9265f15a08db0345715e6ee63756577c4b",
  },
  schedule2027: {
    tag: "espn_mens_college_basketball_schedules",
    asset: "mbb_schedule_2027.csv",
    sha256: "63a6ec8f565a11dfbaab54ea656cc6fc47e19e3d1b29eb40f0824649f56eb9fa",
  },
  teamCrosswalk2026: {
    tag: "mbb_crosswalk",
    asset: "mbb_team_crosswalk_2026.csv",
    sha256: "f492b4e2cbed5da6faaf48c087638a32213334a934938c57f5e7498accfde0d7",
  },
  playerCrosswalk2026: {
    tag: "mbb_crosswalk",
    asset: "mbb_player_crosswalk_2026.csv",
    sha256: "05ec036f6a0e542dcb78284c54e0fa74060dc39a94f9435de3b0ceb283d4ca9b",
  },
  playerStats2026: {
    tag: "espn_mens_college_basketball_player_season_stats",
    asset: "player_season_stats_2026.csv",
    sha256: "2e1868fcc82b12aa4a6ffcb131ad5c4364a8f8e02cf2a3be3cb6200a44a9eba4",
  },
  gameRosters2026: {
    tag: "espn_mens_college_basketball_game_rosters",
    asset: "game_rosters_2026.csv",
    sha256: "95ecddd648e68aaaa4e9921f201667640a458f58768a8be39e7a61767af3bc06",
  },
});

export function releaseUrl({ tag, asset }) {
  return `https://github.com/sportsdataverse/sportsdataverse-data/releases/download/${tag}/${asset}`;
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function assertPinnedAsset(bytes, source) {
  const actual = sha256(bytes);
  if (actual !== source.sha256) throw new Error(`sportsdataverse-digest-mismatch:${source.asset}`);
  return actual;
}

export function parseCsv(text) {
  const rows=[]; let row=[], field="", quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){
      if(c==='"' && text[i+1]==='"'){field+='"';i++;}
      else if(c==='"') quoted=false;
      else field+=c;
    } else if(c==='"') quoted=true;
    else if(c===','){row.push(field);field="";}
    else if(c==='\n'){row.push(field.replace(/\r$/,""));rows.push(row);row=[];field="";}
    else field+=c;
  }
  if(field || row.length){row.push(field.replace(/\r$/,""));rows.push(row);}
  if(!rows.length) return [];
  const head=rows.shift();
  return rows.filter(r=>r.some(Boolean)).map(r=>Object.fromEntries(head.map((h,i)=>[h,r[i]??""])));
}

export function normalizeRoster(rows, observedAt) {
  return rows.filter(r=>r.athlete_id && r.team_id).map(r=>({
    provider:"ESPN", providerPlayerId:String(r.athlete_id), providerTeamId:String(r.team_id),
    fullName:r.full_name||r.display_name||null, uid:r.uid||null, guid:r.guid||null,
    jersey:r.jersey||null, position:r.position_abbreviation||r.position_name||null,
    height:r.height||null, weight:r.weight||null,
    classYear:r.experience_display_value||r.experience_years||null,
    observedAt, effectiveAt:observedAt, availability:"UNKNOWN",
  }));
}

export function normalizeGameRoster(rows, observedAt) {
  return rows.filter(r=>r.athlete_id && r.team_id).map(r=>({
    providerPlayerId:String(r.athlete_id), providerTeamId:String(r.team_id), gameId:String(r.game_id||""),
    starter:String(r.starter).toLowerCase()==="true",
    didNotPlay:String(r.did_not_play).toLowerCase()==="true",
    active:String(r.active).toLowerCase()==="true",
    observedAt,
    availability:"UNKNOWN", // participation evidence is never an injury/status inference
  }));
}
