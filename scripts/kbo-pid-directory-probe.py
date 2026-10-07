#!/usr/bin/env python3
import json, subprocess, sys, tempfile
from pathlib import Path
ROOT=Path(tempfile.mkdtemp(prefix="fbis-kbo-pid-dir-"))
SRC=ROOT/"collector"
subprocess.run(["git","clone","--depth","1","https://github.com/kbo-data-portal/collector.git",str(SRC)],check=True)
subprocess.run([sys.executable,"-m","pip","install","-q","pandas==2.2.3","beautifulsoup4==4.13.1","requests==2.32.3","lxml==5.3.0"],cwd=SRC,check=True)
sys.path.insert(0,str(SRC))
from scrapers.player import PlayerSeasonStatsScraper
out={}
for typ in ["hitter","pitcher"]:
    s=PlayerSeasonStatsScraper("json",[0],typ,True)
    data=s.fetch(2025,None)
    rows=data[f"player/2025/{typ}/season_summary"]
    out[typ]={
      "count":len(rows),
      "keys":sorted(rows[0].keys()) if rows else [],
      "sample":rows[:5],
      "uniqueNameTeam":len({(str(r.get("P_NM")),str(r.get("TEAM_NM"))) for r in rows}),
      "uniquePid":len({str(r.get("P_ID")) for r in rows})
    }
print("KBO_PID_DIRECTORY_PROBE="+json.dumps(out,ensure_ascii=False))
