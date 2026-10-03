#!/usr/bin/env python3
"""
Build the canonical FBIS CFB historical research dataset from SportsDataverse bulk releases.

Primary bulk history (2004-current):
- ESPN CFB schedules
- resolved betting lines
- PBP-derived advanced team offense
- advanced passing/QB
- advanced defensive
- turnover
- drive efficiency

The full raw PBP release exists for the same era, but this builder consumes the
already-derived advanced tables to keep the canonical game file compact and
reproducible. No market field is used to construct football-strength features.
All rolling features are shifted by one game.
"""
from __future__ import annotations
import io, json, os, re, urllib.request
from pathlib import Path
import numpy as np
import pandas as pd

START=int(os.getenv("CFB_BULK_START","2004"))
END=int(os.getenv("CFB_BULK_END","2026"))
BASE="https://github.com/sportsdataverse/sportsdataverse-data/releases/download"
OUT=Path("artifacts/cfb-history-v2"); OUT.mkdir(parents=True,exist_ok=True)
SDV_CONF=Path("artifacts/cfb-conference/cfb_team_season_conference_espn_2004_2026.csv")

DATASETS={
    "schedule":("espn_cfb_schedules","cfb_schedule_{year}.parquet"),
    "betting":("espn_cfb_betting","betting_{year}.parquet"),
    "adv_team":("espn_cfb_adv_team","adv_team_{year}.parquet"),
    "adv_passing":("espn_cfb_adv_passing","adv_passing_{year}.parquet"),
    "adv_defensive":("espn_cfb_adv_defensive","adv_defensive_{year}.parquet"),
    "adv_turnover":("espn_cfb_adv_turnover","adv_turnover_{year}.parquet"),
    "adv_drives":("espn_cfb_adv_drives","adv_drives_{year}.parquet"),
    "adv_rushing":("espn_cfb_adv_rushing","adv_rushing_{year}.parquet"),
    "adv_receiving":("espn_cfb_adv_receiving","adv_receiving_{year}.parquet"),
    "adv_situational":("espn_cfb_adv_situational","adv_situational_{year}.parquet"),
    "adv_specialists":("espn_cfb_adv_specialists","adv_specialists_{year}.parquet"),
    "team_box":("espn_cfb_team_box","team_box_{year}.parquet"),
    "power_index":("espn_cfb_power_index","power_index_{year}.parquet"),
    # Lossless research warehouse tables. These are retained even when not
    # currently flattened into the compact model matrix.
    "pbp":("espn_cfb_pbp","cfb_pbp_{year}.parquet"),
    "drives_raw":("espn_cfb_drives","drives_{year}.parquet"),
    "player_box":("espn_cfb_player_box","player_box_{year}.parquet"),
    "rosters":("espn_cfb_rosters","rosters_{year}.parquet"),
    "game_rosters":("espn_cfb_game_rosters","game_rosters_{year}.parquet"),
    "linescores":("espn_cfb_linescores","linescores_{year}.parquet"),
    "team_summaries":("espn_cfb_team_summaries","team_summaries_{year}.parquet"),
}

def fetch_parquet(tag, template, year):
    url=f"{BASE}/{tag}/{template.format(year=year)}"
    req=urllib.request.Request(url,headers={"User-Agent":"FBIS-CFB-History/2.0"})
    with urllib.request.urlopen(req,timeout=180) as r:
        return pd.read_parquet(io.BytesIO(r.read())), url

def norm_id(v):
    if pd.isna(v): return None
    try: return str(int(float(v)))
    except Exception: return str(v).strip()

def num(v):
    try:
        x=float(v)
        return x if np.isfinite(x) else np.nan
    except Exception:
        return np.nan

def resolve_id_col(df, candidates):
    for c in candidates:
        if c in df.columns and df[c].notna().any():
            return c
    return None

def numeric_feature_frame(df, id_cols, prefix, keep_text=()):
    if df is None or df.empty or "game_id" not in df.columns:
        return pd.DataFrame(columns=["game_id","team_id"])
    candidates=[id_cols] if isinstance(id_cols,str) else list(id_cols)
    id_col=resolve_id_col(df,candidates)
    if not id_col:
        return pd.DataFrame(columns=["game_id","team_id"])
    x=df.copy()
    x["game_id"]=x["game_id"].map(norm_id)
    x["team_id"]=x[id_col].map(norm_id)
    drop={"game_id","season","week",id_col,"team_id"}
    cols=[]
    for c in x.columns:
        if c in drop or c in keep_text: continue
        converted=pd.to_numeric(x[c],errors="coerce")
        if converted.notna().any():
            x[c]=converted
            cols.append(c)
    out=x[["game_id","team_id"]+cols].groupby(["game_id","team_id"],as_index=False).mean(numeric_only=True)
    return out.rename(columns={c:f"{prefix}{c}" for c in cols})

def player_unit_frame(df, id_cols, prefix):
    if df is None or df.empty or "game_id" not in df.columns:
        return pd.DataFrame(columns=["game_id","team_id"])
    candidates=[id_cols] if isinstance(id_cols,str) else list(id_cols)
    id_col=resolve_id_col(df,candidates)
    if not id_col:
        return pd.DataFrame(columns=["game_id","team_id"])
    x=df.copy()
    x["game_id"]=x["game_id"].map(norm_id)
    x["team_id"]=x[id_col].map(norm_id)
    numeric=[]
    for c in x.columns:
        if c in {"game_id","season","week",id_col,"team_id"}: continue
        z=pd.to_numeric(x[c],errors="coerce")
        if z.notna().any():
            x[c]=z; numeric.append(c)
    rows=[]
    for (gid,tid),g in x.groupby(["game_id","team_id"]):
        r={"game_id":gid,"team_id":tid}
        for c in numeric:
            vals=g[c].dropna()
            if not len(vals): continue
            lc=c.lower()
            if any(t in lc for t in ["rate","pct","percent","per_play","per_opp","average","avg","epa_per","ypt","ypc","success","sr"]):
                r[prefix+c]=float(vals.mean())
            else:
                r[prefix+c]=float(vals.sum())
        r[prefix+"contributors"]=int(len(g))
        rows.append(r)
    return pd.DataFrame(rows)

def primary_qb(df):
    if df is None or df.empty:
        return pd.DataFrame(columns=["game_id","team_id"])
    x=df.copy()
    if "game_id" not in x.columns:
        return pd.DataFrame(columns=["game_id","team_id"])
    id_col=resolve_id_col(x,["pos_team_id","pos_team","team_id"])
    if not id_col:
        return pd.DataFrame(columns=["game_id","team_id"])
    x["game_id"]=x["game_id"].map(norm_id)
    x["team_id"]=x[id_col].map(norm_id)
    if "passer_player_name" in x.columns:
        x=x[x["passer_player_name"].astype(str).str.upper().ne("TEAM")]
    att_col="Att" if "Att" in x.columns else None
    if att_col:
        x["_att"]=pd.to_numeric(x[att_col],errors="coerce").fillna(0)
    else:
        x["_att"]=0
    x=x.sort_values(["game_id","team_id","_att"],ascending=[True,True,False]).drop_duplicates(["game_id","team_id"])
    meta=[c for c in ["passer_player_name"] if c in x.columns]
    numeric=[]
    for c in x.columns:
        if c in {"game_id","team_id","pos_team","pos_team_id","season","week","_att"} or c in meta: continue
        z=pd.to_numeric(x[c],errors="coerce")
        if z.notna().any():
            x[c]=z; numeric.append(c)
    out=x[["game_id","team_id"]+meta+numeric].copy()
    return out.rename(columns={**{c:f"qb_{c}" for c in meta},**{c:f"qb_{c}" for c in numeric}})

def schedule_clean(df):
    x=df.copy()
    x["game_id"]=x["game_id"].map(norm_id)
    # Normalize season-specific conference membership from schedule metadata.
    # These fields are descriptive team identity/context, not market inputs.
    aliases={
      "home_conference":["home_conference","home_conference_name","home_conf","home_team_conference","home_team_conference_name","home_conference_abbreviation","home_team_conference_abbreviation"],
      "away_conference":["away_conference","away_conference_name","away_conf","away_team_conference","away_team_conference_name","away_conference_abbreviation","away_team_conference_abbreviation"],
    }
    for target,cands in aliases.items():
        if target in x.columns and x[target].notna().any(): continue
        src=next((z for z in cands if z in x.columns and x[z].notna().any()),None)
        if src: x[target]=x[src]
    for c in ["home_id","away_id"]:
        if c in x.columns:x[c]=x[c].map(norm_id)
    if "game_date" in x.columns:
        x["game_date"]=pd.to_datetime(x["game_date"],utc=True,errors="coerce")
    return x

def betting_clean(df):
    if df is None or df.empty:return pd.DataFrame(columns=["game_id"])
    x=df.copy(); x["game_id"]=x["game_id"].map(norm_id)
    for c in ["game_spread","over_under","home_team_spread"]:
        if c in x.columns:x[c]=pd.to_numeric(x[c],errors="coerce")
    return x.drop_duplicates("game_id")

def merge_team_tables(schedule, tables):
    rows=[]
    for _,g in schedule.iterrows():
        gid=g["game_id"]
        for side,opp in [("home","away"),("away","home")]:
            tid=g.get(f"{side}_id")
            oid=g.get(f"{opp}_id")
            if not tid: continue
            r={
              "game_id":gid,
              "season":int(g["season"]) if pd.notna(g.get("season")) else None,
              "week":int(g["week"]) if pd.notna(g.get("week")) else None,
              "game_date":g.get("game_date"),
              "team_id":tid,"opponent_id":oid,"side":side,
              "team_name":g.get(f"{side}_team"),"opponent_name":g.get(f"{opp}_team"),
              "points_for":pd.to_numeric(pd.Series([g.get(f"{side}_score")]),errors="coerce").iloc[0],
              "points_against":pd.to_numeric(pd.Series([g.get(f"{opp}_score")]),errors="coerce").iloc[0],
              "pregame_rank":pd.to_numeric(pd.Series([g.get(f"{side}_rank")]),errors="coerce").iloc[0] if f"{side}_rank" in g else np.nan,
            }
            for tab in tables:
                if tab.empty: continue
                hit=tab[(tab.game_id==gid)&(tab.team_id==tid)]
                if len(hit):
                    h=hit.iloc[0]
                    for c in tab.columns:
                        if c not in {"game_id","team_id"}: r[c]=h[c]
            rows.append(r)
    return pd.DataFrame(rows)

def add_rolling(team_games):
    x=team_games.copy()
    x=x.sort_values(["team_id","game_date","game_id"]).reset_index(drop=True)
    exclude={"season","week","points_for","points_against","pregame_rank"}
    all_numeric=[]
    for c in x.columns:
        if c in {"game_id","game_date","team_id","opponent_id","side","team_name","opponent_name"} or c in exclude: continue
        if pd.api.types.is_numeric_dtype(x[c]) and x[c].notna().any():
            all_numeric.append(c)

    # Preserve every numeric advanced field in the raw team-game export, but
    # only create rolling model inputs for football-relevant rate/efficiency
    # metrics. This prevents thousands of redundant cumulative/stat-count
    # columns from bloating the game-level matrix.
    relevant_re=re.compile(
        r"(epa|ppa|success|explos|havoc|pressure|sack|pass|rush|qbr|rating|efficien|"
        r"yards_per|points_per|rate|pct|percent|turnover|interception|fumble|"
        r"third|fourth|red.?zone|line.?yards|stuff|drive|pace|completion|"
        r"expected|win_prob|special|kick|punt|field.?goal)",
        re.I
    )
    rolling_features=[c for c in all_numeric if relevant_re.search(c)]
    if len(rolling_features)<25:
        rolling_features=all_numeric

    rolled={}
    by_team=x.groupby("team_id",sort=False)
    by_team_season=x.groupby(["team_id","season"],sort=False)
    for c in rolling_features:
        rolled[f"pregame_season_{c}"]=by_team_season[c].transform(
            lambda z:z.shift(1).expanding(min_periods=1).mean()
        )
        rolled[f"pregame_l5_{c}"]=by_team[c].transform(
            lambda z:z.shift(1).rolling(5,min_periods=1).mean()
        )
    rolled["pregame_rest_days"]=by_team["game_date"].diff().dt.total_seconds()/86400.0
    roll_df=pd.DataFrame(rolled,index=x.index)
    roll_df["pregame_rest_days"]=roll_df["pregame_rest_days"].clip(lower=0,upper=30)
    x=pd.concat([x,roll_df],axis=1)
    return x, all_numeric, rolling_features

def flatten_games(schedule, betting, team_roll):
    home=team_roll[team_roll.side=="home"].set_index("game_id")
    away=team_roll[team_roll.side=="away"].set_index("game_id")
    b=betting.set_index("game_id") if not betting.empty else pd.DataFrame()
    rows=[]
    rollcols=[c for c in team_roll.columns if c.startswith("pregame_")]
    for _,g in schedule.iterrows():
        gid=g["game_id"]; h=home.loc[gid] if gid in home.index else None; a=away.loc[gid] if gid in away.index else None
        if isinstance(h,pd.DataFrame):h=h.iloc[0]
        if isinstance(a,pd.DataFrame):a=a.iloc[0]
        r={c:g.get(c) for c in schedule.columns}
        hs=pd.to_numeric(pd.Series([g.get("home_score")]),errors="coerce").iloc[0]
        as_=pd.to_numeric(pd.Series([g.get("away_score")]),errors="coerce").iloc[0]
        r["home_margin"]=hs-as_ if pd.notna(hs) and pd.notna(as_) else np.nan
        r["final_total"]=hs+as_ if pd.notna(hs) and pd.notna(as_) else np.nan
        for c in rollcols:
            hv=h.get(c) if h is not None else np.nan; av=a.get(c) if a is not None else np.nan
            r["home_"+c]=hv;r["away_"+c]=av
            try:
                hf=float(hv);af=float(av)
                r["diff_"+c]=hf-af if np.isfinite(hf) and np.isfinite(af) else np.nan
                r["sum_"+c]=hf+af if np.isfinite(hf) and np.isfinite(af) else np.nan
            except Exception:
                pass
        for side,row in [("home",h),("away",a)]:
            if row is not None:
                r[f"{side}_primary_qb"]=row.get("qb_passer_player_name",np.nan)
        if not b.empty and gid in b.index:
            br=b.loc[gid]
            if isinstance(br,pd.DataFrame):br=br.iloc[0]
            for c in betting.columns:
                if c!="game_id":r["market_"+c]=br.get(c)
        # canonical home perspective
        home_spread=pd.to_numeric(pd.Series([r.get("market_home_team_spread")]),errors="coerce").iloc[0]
        total=pd.to_numeric(pd.Series([r.get("market_over_under")]),errors="coerce").iloc[0]
        r["market_home_spread"]=home_spread
        r["market_total"]=total
        r["market_implied_home_margin"]=-home_spread if pd.notna(home_spread) else np.nan
        r["home_ats_margin"]=r["home_margin"]+home_spread if pd.notna(r["home_margin"]) and pd.notna(home_spread) else np.nan
        r["total_margin_vs_market"]=r["final_total"]-total if pd.notna(r["final_total"]) and pd.notna(total) else np.nan
        rows.append(r)
    return pd.DataFrame(rows)

def main():
    conf=pd.read_csv(CFBD_CONF,low_memory=False) if CFBD_CONF.exists() else pd.DataFrame()
    if conf.empty: raise RuntimeError("missing CFBD historical conference dimension")
    conf["game_id"]=conf["game_id"].map(norm_id)
    conf=conf.drop_duplicates("game_id")
    schedules=[]; bets=[]; team_rows=[]; coverage=[]; sources={}
    for year in range(START,END+1):
        season={}
        urls={}
        for name,(tag,tpl) in DATASETS.items():
            try:
                d,url=fetch_parquet(tag,tpl,year)
                season[name]=d;urls[name]=url
            except Exception as e:
                season[name]=pd.DataFrame();urls[name]=f"ERROR:{e}"
        sched=schedule_clean(season["schedule"]) if not season["schedule"].empty else pd.DataFrame()
        if not sched.empty:
            yr=conf[conf["season"].eq(year)].copy()
            cmap=yr.set_index("team_id").to_dict("index")
            def add_membership(side):
                ids=sched[f"{side}_id"].map(norm_id)
                sched[f"{side}_conference"]=ids.map(lambda z:(cmap.get(z) or {}).get("conference_name") or (cmap.get(z) or {}).get("conference_id"))
                sched[f"{side}_conference_id"]=ids.map(lambda z:(cmap.get(z) or {}).get("conference_id"))
                sched[f"{side}_conference_abbreviation"]=ids.map(lambda z:(cmap.get(z) or {}).get("conference_abbreviation"))
                sched[f"{side}_classification"]=ids.map(lambda z:(cmap.get(z) or {}).get("classification"))
                sched[f"{side}_conference_sources_agree"]=ids.map(lambda z:(cmap.get(z) or {}).get("sources_agree"))
                sched[f"{side}_conference_source"]=ids.map(lambda z:(cmap.get(z) or {}).get("source"))
            add_membership("home"); add_membership("away")
        bet=betting_clean(season["betting"])
        at=numeric_feature_frame(season["adv_team"],["pos_team_id","pos_team","team_id"],"off_")
        ad=numeric_feature_frame(season["adv_defensive"],["def_pos_team_id","def_pos_team","team_id"],"def_")
        av=numeric_feature_frame(season["adv_turnover"],["pos_team_id","pos_team","team_id"],"to_")
        drv=numeric_feature_frame(season["adv_drives"],["pos_team_id","pos_team","team_id"],"drive_")
        sit=numeric_feature_frame(season["adv_situational"],["pos_team_id","pos_team","team_id"],"situ_")
        team_box=numeric_feature_frame(season["team_box"],["team_id","pos_team_id","pos_team"],"box_")
        rush=player_unit_frame(season["adv_rushing"],["pos_team_id","pos_team","team_id"],"rush_")
        recv=player_unit_frame(season["adv_receiving"],["pos_team_id","pos_team","team_id"],"recv_")
        spec=player_unit_frame(season["adv_specialists"],["pos_team_id","pos_team","team_id"],"st_")
        qb=primary_qb(season["adv_passing"])
        if not sched.empty:
            tg=merge_team_tables(sched,[at,ad,av,drv,sit,team_box,rush,recv,spec,qb]);team_rows.append(tg);schedules.append(sched)
        if not bet.empty:bets.append(bet)
        # Preserve every successfully acquired source table losslessly by season.
        raw_dir=OUT/"raw"/str(year); raw_dir.mkdir(parents=True,exist_ok=True)
        for source_name,source_df in season.items():
            if source_df is not None and not source_df.empty:
                source_df.to_parquet(raw_dir/f"{source_name}.parquet",index=False)
        coverage.append({
          "season":year,"scheduleRows":len(sched),"bettingRows":len(bet),
          "advTeamRows":len(season["adv_team"]),"advPassingRows":len(season["adv_passing"]),
          "advDefensiveRows":len(season["adv_defensive"]),"advTurnoverRows":len(season["adv_turnover"]),
          "advDriveRows":len(season["adv_drives"]),
          "advRushingRows":len(season["adv_rushing"]),
          "advReceivingRows":len(season["adv_receiving"]),
          "advSituationalRows":len(season["adv_situational"]),
          "advSpecialistsRows":len(season["adv_specialists"]),
          "teamBoxRows":len(season["team_box"]),
          "powerIndexRows":len(season["power_index"]),
          "pbpRows":len(season["pbp"]),"drivesRawRows":len(season["drives_raw"]),
          "playerBoxRows":len(season["player_box"]),"rosterRows":len(season["rosters"]),
          "gameRosterRows":len(season["game_rosters"]),"linescoreRows":len(season["linescores"]),
          "teamSummaryRows":len(season["team_summaries"]),
          "gamesWithBothConferences":int((sched["home_conference"].notna() & sched["away_conference"].notna()).sum()) if len(sched) and "home_conference" in sched and "away_conference" in sched else 0,
          "conferenceMembershipSource":"SportsDataverse cfb_groups",
        })
        sources[str(year)]=urls
        print(json.dumps(coverage[-1]),flush=True)

    schedule=pd.concat(schedules,ignore_index=True) if schedules else pd.DataFrame()
    betting=pd.concat(bets,ignore_index=True) if bets else pd.DataFrame()
    team=pd.concat(team_rows,ignore_index=True) if team_rows else pd.DataFrame()
    # Preserve full team-game advanced matrix separately from the model-ready rolling game file.
    team.to_parquet(OUT/"cfb_team_game_advanced_2004_2026.parquet",index=False)
    team.to_csv(OUT/"cfb_team_game_advanced_2004_2026.csv",index=False)
    rolled, raw_features, rolling_features=add_rolling(team)
    games=flatten_games(schedule,betting,rolled)
    games=games.sort_values(["season","week","game_date","game_id"]).reset_index(drop=True)

    # Final/model eligibility. ESPN-native schedule is FBS-scoped but can contain FCS opponents.
    final_mask=pd.to_numeric(games.get("home_score"),errors="coerce").notna() & pd.to_numeric(games.get("away_score"),errors="coerce").notna()
    games["is_final"]=final_mask.astype(int)
    games["training_eligible"]=(final_mask & (games["season"]<END)).astype(int)

    games.to_csv(OUT/"cfb_game_training_2004_2026.csv",index=False)
    betting.to_csv(OUT/"cfb_betting_resolved_2004_2026.csv",index=False)
    pd.DataFrame(coverage).to_csv(OUT/"cfb_bulk_coverage.csv",index=False)
    (OUT/"cfb_bulk_sources.json").write_text(json.dumps(sources,indent=2))

    q={
      "generatedAt":pd.Timestamp.utcnow().isoformat(),
      "seasons":[START,END],
      "gameRows":int(len(games)),
      "finalGames":int(final_mask.sum()),
      "duplicateGameIds":int(games.game_id.duplicated().sum()),
      "resolvedBettingRows":int(len(betting)),
      "gamesWithSpread":int(games.market_home_spread.notna().sum()),
      "gamesWithTotal":int(games.market_total.notna().sum()),
      "spreadCoveragePct":round(float(games.market_home_spread.notna().mean()*100),3) if len(games) else 0,
      "totalCoveragePct":round(float(games.market_total.notna().mean()*100),3) if len(games) else 0,
      "rawAdvancedFeatureCount":len(raw_features),
      "rollingRawFeatureCount":len(rolling_features),
      "pregameFeatureColumns":len([c for c in games.columns if c.startswith(("home_pregame_","away_pregame_","diff_pregame_","sum_pregame_"))]),
      "firstSeason":int(games.season.min()) if len(games) else None,
      "lastSeason":int(games.season.max()) if len(games) else None,
      "gamesWithHomeConference":int(games["home_conference"].notna().sum()) if "home_conference" in games else 0,
      "gamesWithAwayConference":int(games["away_conference"].notna().sum()) if "away_conference" in games else 0,
      "conferenceCoveragePct":round(float((games["home_conference"].notna() & games["away_conference"].notna()).mean()*100),3) if len(games) and "home_conference" in games and "away_conference" in games else 0,
      "temporalIntegrity":"All rolling football features use shift(1). Rankings/rest are game-known pregame context. Betting is benchmark/evaluation only.",
      "rawPbpAvailability":"SportsDataverse espn_cfb_pbp is retained losslessly by season in the canonical research warehouse when available; compact model matrices remain derived artifacts.",
      "marketPolicy":"ESPN/SportsDataverse resolved betting line is retained as benchmark only. CFBD provider-level/opening line enrichment is merged separately when available.",
      "sourceCatalog":{
        "rawPbp":"espn_cfb_pbp (2004-current; ~383 columns/play; audit/source-of-truth, not duplicated into compact artifact)",
        "advanced":["adv_team","adv_passing","adv_rushing","adv_receiving","adv_defensive","adv_turnover","adv_drives","adv_situational","adv_specialists"],
        "context":["team_box","power_index","schedules","betting"],
        "additionalAvailableNotEmbedded":["play_participants","game_rosters","rosters","player_box","drives","linescores","team_summaries","ratings_weekly","fpi_weekly","team_talent","recruits","returning_production"]
      }
    }
    (OUT/"cfb_bulk_qa.json").write_text(json.dumps(q,indent=2))
    min_rows=500 if START==END else 10000
    if q["firstSeason"]!=START or q["lastSeason"]!=END or q["gameRows"]<min_rows:
        raise RuntimeError(f"bulk CFB history unexpectedly incomplete: {q}")
    if q["gamesWithSpread"]==0 or q["pregameFeatureColumns"]<100 or q["rawAdvancedFeatureCount"]<25:
        raise RuntimeError(f"bulk CFB market/features unexpectedly incomplete: {q}")
    if q["gamesWithHomeConference"]==0 or q["gamesWithAwayConference"]==0:
        conf_like=[z for z in schedule.columns if "conf" in z.lower()]
        raise RuntimeError(f"CFB schedule lacks usable home/away conference membership; conference-like columns={conf_like}")
    if q["conferenceCoveragePct"]<95:
        raise RuntimeError(f"CFB historical conference coverage below 95%: {q['conferenceCoveragePct']}")
    print(json.dumps(q,indent=2))

if __name__=="__main__":
    main()
