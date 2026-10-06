#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";

const BASE = "https://api.collegefootballdata.com";
const START = Number(process.env.CFB_DIRECTORY_START || "2000");
const END = Number(process.env.CFB_DIRECTORY_END || new Date().getUTCFullYear());
const OUT = process.env.CFB_DIRECTORY_SQL || "artifacts/cfb-directory/cfb-team-directory.sql";
const KEY = String(process.env.CFBD_API_KEY || "").trim();

if (!KEY) throw new Error("CFBD_API_KEY is required");
if (!Number.isInteger(START) || !Number.isInteger(END) || START < 1900 || END < START) {
  throw new Error("invalid CFB_DIRECTORY_START/END");
}

const esc = (v) => v == null ? "NULL" : "'" + String(v).replaceAll("'", "''") + "'";
const qnum = (v) => Number.isFinite(Number(v)) ? String(Number(v)) : "NULL";
const norm = (v) => String(v || "").toLowerCase().replace(/&/g," and ").replace(/[^a-z0-9\s]/g," ").replace(/\s+/g," ").trim();
const hash = (...parts) => createHash("sha256").update(parts.join("|")).digest("hex").slice(0,32);
const teamId = (id) => `cfb:cfbd:${String(id)}`;
const iso = () => new Date().toISOString();

async function get(path, query={}) {
  const u = new URL(BASE + path);
  for (const [k,v] of Object.entries(query)) if (v != null) u.searchParams.set(k,String(v));
  const res = await fetch(u, {headers:{Authorization:`Bearer ${KEY}`,Accept:"application/json","User-Agent":"FBIS-CFB-Directory/1.0"}});
  if (!res.ok) throw new Error(`CFBD ${res.status} ${path} ${u.search}`);
  const json = await res.json();
  if (!Array.isArray(json)) throw new Error(`CFBD non-array response for ${path}`);
  return json;
}

function compressMemberships(rows) {
  const byTeam = new Map();
  for (const row of rows) {
    const key = String(row.id);
    if (!byTeam.has(key)) byTeam.set(key,[]);
    byTeam.get(key).push(row);
  }
  const out=[];
  for (const [id,items] of byTeam) {
    items.sort((a,b)=>a.year-b.year);
    let run=null;
    for (const r of items) {
      const conf = r.conference || null;
      const cls = r.classification || null;
      const independent = conf ? 0 : 1;
      if (run && run.conference===conf && run.subdivision===cls && run.independent===independent && r.year===run.endYear+1) {
        run.endYear=r.year;
      } else {
        if (run) out.push(run);
        run={team_id:teamId(id),conference:conf,subdivision:cls,independent,startYear:r.year,endYear:r.year};
      }
    }
    if (run) out.push(run);
  }
  return out;
}

const observedAt = iso();
const currentRows = await get("/teams");
const yearly=[];
for (let year=START; year<=END; year++) {
  const rows = await get("/teams",{year});
  for (const r of rows) if (r?.id != null && r?.school) yearly.push({...r,year});
  process.stdout.write(`CFBD teams year=${year} rows=${rows.length}\n`);
}

const latestById = new Map();
for (const r of currentRows) if (r?.id != null && r?.school) latestById.set(String(r.id),r);
for (const r of yearly) {
  const key=String(r.id);
  const cur=latestById.get(key);
  if (!cur || r.year > Number(cur.__year || -1)) latestById.set(key,{...r,__year:r.year});
}

const sql=[];
sql.push("BEGIN TRANSACTION;");
for (const r of latestById.values()) {
  const tid=teamId(r.id);
  const loc=r.location || {};
  sql.push(`INSERT INTO cfb_canonical_teams
(team_id,school_name,athletic_name,abbreviation,subdivision,current_conference,independent,city,state,country,home_venue_id,home_stadium,latitude,longitude,timezone,elevation_feet,active,identity_confidence,research_only,can_influence_projection,source_json,first_observed_at,last_observed_at,created_at,updated_at)
VALUES (${esc(tid)},${esc(r.school)},${esc(r.mascot)},${esc(r.abbreviation)},${esc(r.classification || "UNKNOWN")},${esc(r.conference)},${r.conference?0:1},${esc(loc.city)},${esc(loc.state)},${esc(loc.countryCode || "USA")},${esc(loc.id)},${esc(loc.name)},${qnum(loc.latitude)},${qnum(loc.longitude)},${esc(loc.timezone)},${qnum(loc.elevation)},1,1.0,1,0,${esc(JSON.stringify(r))},${esc(observedAt)},${esc(observedAt)},${esc(observedAt)},${esc(observedAt)})
ON CONFLICT(team_id) DO UPDATE SET
school_name=excluded.school_name,athletic_name=excluded.athletic_name,abbreviation=excluded.abbreviation,subdivision=excluded.subdivision,current_conference=excluded.current_conference,independent=excluded.independent,city=excluded.city,state=excluded.state,country=excluded.country,home_venue_id=excluded.home_venue_id,home_stadium=excluded.home_stadium,latitude=excluded.latitude,longitude=excluded.longitude,timezone=excluded.timezone,elevation_feet=excluded.elevation_feet,active=1,identity_confidence=1.0,research_only=1,can_influence_projection=0,source_json=excluded.source_json,last_observed_at=excluded.last_observed_at,updated_at=excluded.updated_at;`);

  const pid=`cfbd:${r.id}`;
  sql.push(`INSERT INTO cfb_team_provider_ids
(id,team_id,provider,provider_team_id,provider_team_name,effective_from,effective_to,observed_at,confidence,raw_json,created_at,updated_at)
VALUES (${esc(pid)},${esc(tid)},'CFBD',${esc(r.id)},${esc(r.school)},NULL,NULL,${esc(observedAt)},1.0,${esc(JSON.stringify(r))},${esc(observedAt)},${esc(observedAt)})
ON CONFLICT(id) DO UPDATE SET provider_team_name=excluded.provider_team_name,observed_at=excluded.observed_at,confidence=1.0,raw_json=excluded.raw_json,updated_at=excluded.updated_at;`);

  const aliases=[r.school,r.abbreviation,...(Array.isArray(r.alternateNames)?r.alternateNames:[])].filter(Boolean);
  for (const a of new Set(aliases)) {
    const na=norm(a); if (!na) continue;
    const aid=`alias:${hash(tid,na,"CFBD")}`;
    const type = a===r.school ? "SCHOOL" : a===r.abbreviation ? "ABBREVIATION" : "ALTERNATE";
    sql.push(`INSERT INTO cfb_team_aliases
(id,team_id,alias,normalized_alias,alias_type,source,effective_from,effective_to,observed_at,confidence,created_at)
VALUES (${esc(aid)},${esc(tid)},${esc(a)},${esc(na)},${esc(type)},'CFBD',NULL,NULL,${esc(observedAt)},1.0,${esc(observedAt)})
ON CONFLICT(id) DO UPDATE SET alias=excluded.alias,normalized_alias=excluded.normalized_alias,alias_type=excluded.alias_type,observed_at=excluded.observed_at,confidence=1.0;`);
  }

  const oid=`obs:${hash("CFBD",r.id,observedAt.slice(0,10))}`;
  sql.push(`INSERT OR IGNORE INTO cfb_team_identity_observations
(id,team_id,provider,provider_team_id,school_name,conference_name,subdivision,payload_json,source_timestamp,observed_at,ingested_at,content_hash,supersedes_id,confidence,research_only,can_influence_projection)
VALUES (${esc(oid)},${esc(tid)},'CFBD',${esc(r.id)},${esc(r.school)},${esc(r.conference)},${esc(r.classification)},${esc(JSON.stringify(r))},NULL,${esc(observedAt)},${esc(observedAt)},${esc(hash(JSON.stringify(r)))},NULL,1.0,1,0);`);
}

for (const m of compressMemberships(yearly)) {
  const from=`${m.startYear}-07-01T00:00:00Z`;
  const to=m.endYear < END ? `${m.endYear+1}-07-01T00:00:00Z` : null;
  const mid=`membership:${hash(m.team_id,from,m.conference||"INDEPENDENT")}`;
  sql.push(`INSERT INTO cfb_conference_membership
(id,team_id,conference_id,conference_name,subdivision,independent,effective_from,effective_to,source,observed_at,confidence,raw_json,created_at)
VALUES (${esc(mid)},${esc(m.team_id)},NULL,${esc(m.conference)},${esc(m.subdivision)},${m.independent},${esc(from)},${esc(to)},'CFBD:/teams?year',${esc(observedAt)},1.0,NULL,${esc(observedAt)})
ON CONFLICT(id) DO UPDATE SET conference_name=excluded.conference_name,subdivision=excluded.subdivision,independent=excluded.independent,effective_to=excluded.effective_to,observed_at=excluded.observed_at,confidence=1.0;`);
}
sql.push("COMMIT;");

await mkdir(new URL("../" + OUT.split("/").slice(0,-1).join("/") + "/", import.meta.url), {recursive:true}).catch(()=>{});
await mkdir(OUT.split("/").slice(0,-1).join("/") || ".", {recursive:true});
await writeFile(OUT, sql.join("\n") + "\n");

const qa={
  generatedAt:observedAt,
  startSeason:START,
  endSeason:END,
  currentTeams:currentRows.length,
  canonicalTeams:latestById.size,
  annualTeamRows:yearly.length,
  membershipRuns:compressMemberships(yearly).length,
  output:OUT,
  governance:{overlayVersion:"FBIS-STATE-OVERLAY-v1",canInfluenceProjection:false,canQualify:false,canAuthorizeWager:false}
};
await writeFile(OUT.replace(/\.sql$/,".qa.json"), JSON.stringify(qa,null,2)+"\n");
console.log(JSON.stringify(qa,null,2));
