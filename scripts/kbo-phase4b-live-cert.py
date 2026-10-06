#!/usr/bin/env python3
import json, subprocess, sys, tempfile
from pathlib import Path

ROOT=Path(tempfile.mkdtemp(prefix="fbis-kbo-4b-cert-"))
SRC=ROOT/"KBO-league"

def run(cmd,cwd=None,timeout=240):
    p=subprocess.run(cmd,cwd=cwd,text=True,capture_output=True,timeout=timeout)
    if p.returncode: raise RuntimeError(p.stderr[-4000:])
    return p

run(["git","clone","--depth","1","https://github.com/dialektike/KBO-league.git",str(SRC)])
run([sys.executable,"-m","pip","install","-q","-r","requirements.txt"],cwd=SRC)
sys.path.insert(0,str(SRC))
import get_game_schedule, get_game_data

def games_on(d):
    return [g for g in get_game_schedule.by_date(d,sr_id="0",force_fetch=True,base_dir=str(ROOT/"cache"))
            if str(g.get("CANCEL_SC_ID","0"))=="0" and g.get("G_ID")]

double_date="20250517"
double_games=games_on(double_date)
groups={}
for g in double_games:
    key=(g.get("AWAY_ID"),g.get("HOME_ID"))
    groups.setdefault(key,[]).append(g.get("G_ID"))
double_groups=[{"matchup":list(k),"ids":v} for k,v in groups.items() if len(v)>1]

targets=["20250528","20250612","20250808"]
extra=[]
for d in targets:
    for g in games_on(d):
        gid=g["G_ID"]
        detail=get_game_data.fetch_game(d,gid[8:],sr_id=int(g.get("SR_ID",0) or 0),season_id=2025)
        real=detail.get("meta",{}).get("realMaxInning")
        if isinstance(real,int) and real>9:
            c=detail.get("contents",{})
            ap=c.get("away_pitcher") or []; hp=c.get("home_pitcher") or []
            sb=c.get("scoreboard") or {}
            extra.append({
                "date":d,"G_ID":gid,"away":g.get("AWAY_NM"),"home":g.get("HOME_NM"),
                "away_score":g.get("T_SCORE_CN"),"home_score":g.get("B_SCORE_CN"),
                "realMaxInning":real,"innings":sb.get("innings"),
                "awayPitchers":len(ap),"homePitchers":len(hp),
                "allPitchCounts":all("NP" in p for p in ap+hp),
                "awayStarter":ap[0].get("name") if ap else None,
                "homeStarter":hp[0].get("name") if hp else None
            })
print("PHASE4B_CERT="+json.dumps({
  "doubleheaderDate":double_date,
  "doubleheaderPlayable":len(double_games),
  "doubleheaderGroups":double_groups,
  "extraInningTargets":targets,
  "extraInningGames":extra
},ensure_ascii=False))
