#!/usr/bin/env python3
import json, os, subprocess, sys, tempfile
from pathlib import Path

DATES=["20250405","20250510","20250614","20250712","20250816","20250920"]
ROOT=Path(tempfile.mkdtemp(prefix="fbis-kbo-phase4a-"))
A=ROOT/"KBO-league"
B=ROOT/"collector"

def run(cmd,cwd=None,timeout=240):
    p=subprocess.run(cmd,cwd=cwd,text=True,capture_output=True,timeout=timeout)
    return {"code":p.returncode,"stdout":p.stdout[-8000:],"stderr":p.stderr[-8000:]}

def clone(url,path):
    r=run(["git","clone","--depth","1",url,str(path)],timeout=120)
    if r["code"]!=0: raise RuntimeError(r["stderr"])

def source_a():
    clone("https://github.com/dialektike/KBO-league.git",A)
    sys.path.insert(0,str(A))
    import get_game_schedule, get_game_data
    rows=[]
    for d in DATES:
        games=get_game_schedule.by_date(d, sr_id="0", force_fetch=True, base_dir=str(ROOT/"a-cache"))
        playable=[g for g in games if str(g.get("CANCEL_SC_ID","0"))=="0" and g.get("G_ID")]
        for g in playable[:2]:
            gid=g["G_ID"]
            detail=get_game_data.fetch_game(d,gid[8:],sr_id=int(g.get("SR_ID",0) or 0),season_id=2025)
            c=detail.get("contents",{})
            awayp=c.get("away_pitcher") or []
            homep=c.get("home_pitcher") or []
            awayb=(c.get("away_batter") or {}).get("batters") or []
            homeb=(c.get("home_batter") or {}).get("batters") or []
            rows.append({
                "date":d,"G_ID":gid,"away":g.get("AWAY_NM"),"home":g.get("HOME_NM"),
                "stadium":g.get("S_NM"),"away_score":g.get("T_SCORE_CN"),"home_score":g.get("B_SCORE_CN"),
                "away_batters":len(awayb),"home_batters":len(homeb),
                "away_pitchers":len(awayp),"home_pitchers":len(homep),
                "away_starter":awayp[0].get("name") if awayp else None,
                "home_starter":homep[0].get("name") if homep else None,
                "pitcher_rows_have_np":all(("NP" in p) for p in awayp+homep) if awayp or homep else False,
                "batter_rows_have_name":all(bool(x.get("name")) for x in awayb+homeb) if awayb or homeb else False,
            })
    return {"games":rows,"count":len(rows)}

def source_b():
    clone("https://github.com/kbo-data-portal/collector.git",B)
    pip=run([sys.executable,"-m","pip","install","-q","-r","requirements.txt"],cwd=B,timeout=240)
    attempts=[]
    for d in DATES:
        r=run([sys.executable,"run.py","player","-y","2025","-d",d,"-f","json"],cwd=B,timeout=240)
        files=[str(p.relative_to(B)) for p in B.rglob("*.json")]
        attempts.append({"date":d,"exit":r["code"],"json_files":files[-30:],"stdout_tail":r["stdout"][-1500:],"stderr_tail":r["stderr"][-1500:]})
    return {"pip_exit":pip["code"],"attempts":attempts}

out={"dates":DATES,"sourceA":None,"sourceB":None}
try: out["sourceA"]=source_a()
except Exception as e: out["sourceA"]={"error":repr(e)}
try: out["sourceB"]=source_b()
except Exception as e: out["sourceB"]={"error":repr(e)}
print("PHASE4A_RESULT="+json.dumps(out,ensure_ascii=False))
