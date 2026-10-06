#!/usr/bin/env python3
import json, re, subprocess, sys, tempfile
from pathlib import Path

DATES=["20250405","20250510","20250614","20250712","20250816","20250920"]
ROOT=Path(tempfile.mkdtemp(prefix="fbis-kbo-phase4a-"))
A=ROOT/"KBO-league"; B=ROOT/"collector"

def run(cmd,cwd=None,timeout=180):
    try:
        p=subprocess.run(cmd,cwd=cwd,text=True,capture_output=True,timeout=timeout)
        return {"code":p.returncode,"stdout":p.stdout[-6000:],"stderr":p.stderr[-6000:],"timeout":False}
    except subprocess.TimeoutExpired as e:
        out=(e.stdout.decode() if isinstance(e.stdout,bytes) else e.stdout) or ""
        err=(e.stderr.decode() if isinstance(e.stderr,bytes) else e.stderr) or ""
        return {"code":None,"stdout":out[-6000:],"stderr":err[-6000:],"timeout":True}

def clone(url,path):
    r=run(["git","clone","--depth","1",url,str(path)],timeout=120)
    if r["code"]!=0: raise RuntimeError(r["stderr"])

def source_a():
    clone("https://github.com/dialektike/KBO-league.git",A)
    pip=run([sys.executable,"-m","pip","install","-q","-r","requirements.txt"],cwd=A,timeout=180)
    if pip["code"]!=0: return {"pip_exit":pip["code"],"pip_error":pip["stderr"]}
    sys.path.insert(0,str(A))
    import get_game_schedule, get_game_data
    rows=[]
    for d in DATES:
        games=get_game_schedule.by_date(d,sr_id="0",force_fetch=True,base_dir=str(ROOT/"a-cache"))
        playable=[g for g in games if str(g.get("CANCEL_SC_ID","0"))=="0" and g.get("G_ID")]
        for g in playable[:2]:
            gid=g["G_ID"]
            detail=get_game_data.fetch_game(d,gid[8:],sr_id=int(g.get("SR_ID",0) or 0),season_id=2025)
            c=detail.get("contents",{})
            ap=c.get("away_pitcher") or []; hp=c.get("home_pitcher") or []
            ab=(c.get("away_batter") or {}).get("batters") or []
            hb=(c.get("home_batter") or {}).get("batters") or []
            rows.append({
                "date":d,"G_ID":gid,"away":g.get("AWAY_NM"),"home":g.get("HOME_NM"),
                "stadium":g.get("S_NM"),"away_score":g.get("T_SCORE_CN"),"home_score":g.get("B_SCORE_CN"),
                "away_batters":len(ab),"home_batters":len(hb),"away_pitchers":len(ap),"home_pitchers":len(hp),
                "away_starter":ap[0].get("name") if ap else None,"home_starter":hp[0].get("name") if hp else None,
                "pitcher_np_complete":all("NP" in p for p in ap+hp) if ap or hp else False,
                "batter_name_complete":all(bool(x.get("name")) for x in ab+hb) if ab or hb else False
            })
    return {"pip_exit":pip["code"],"count":len(rows),"games":rows}

def source_b():
    clone("https://github.com/kbo-data-portal/collector.git",B)
    player=(B/"scrapers/player.py").read_text(encoding="utf-8")
    contract={
      "extracts_pid":bool(re.search(r'playerId=\\(\\d\+\\)',player)),
      "has_daily_detail":"daily" in player,
      "has_hitter_urls":"HitterBasic" in player,
      "has_pitcher_urls":"PitcherBasic" in player,
      "has_fielder_url":"/Defense/Basic.aspx" in player,
      "has_runner_url":"/Runner/Basic.aspx" in player
    }
    pip=run([sys.executable,"-m","pip","install","-q","-r","requirements.txt"],cwd=B,timeout=180)
    live=run([sys.executable,"run.py","player","-y","2025","-d","20250920","-f","json"],cwd=B,timeout=90)
    files=[str(p.relative_to(B)) for p in B.rglob("*.json")]
    return {"contract":contract,"pip_exit":pip["code"],"live_exit":live["code"],"live_timeout":live["timeout"],
            "json_files":files[-50:],"stdout_tail":live["stdout"][-2500:],"stderr_tail":live["stderr"][-2500:]}

out={"dates":DATES}
try: out["sourceA"]=source_a()
except Exception as e: out["sourceA"]={"error":repr(e)}
try: out["sourceB"]=source_b()
except Exception as e: out["sourceB"]={"error":repr(e)}
print("PHASE4A_RESULT="+json.dumps(out,ensure_ascii=False))
