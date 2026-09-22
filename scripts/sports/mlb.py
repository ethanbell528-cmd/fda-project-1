"""MLB: games 1990-2026, odds 2010-2021, starting pitchers, player stats.

Sources (all free, no login):
  Retrosheet game logs      https://www.retrosheet.org/gamelogs/gl1871_2025.zip
  Retrosheet per-season CSV https://www.retrosheet.org/downloads/{YYYY}/{YYYY}csvs.zip
  MLB Stats API (2026)      https://statsapi.mlb.com/api/v1/schedule , /game/{gamePk}/boxscore
  SportsbookReviewsOnline   https://www.sportsbookreviewsonline.com/wp-content/uploads/sportsbookreviewsonline_com_737/mlb-odds-{YYYY}.xlsx
  Chadwick register         https://github.com/chadwickbureau/register (Retrosheet <-> MLBAM ids)

The information used here was obtained free of charge from and is copyrighted
by Retrosheet. Interested parties may contact Retrosheet at www.retrosheet.org.
"""
from __future__ import annotations

import gzip
import json
import re
import time
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd

from common import fetch, get_json, to_panel

FIRST, LAST_RETRO, CURRENT = 1990, 2025, 2026
ODDS_YEARS = range(2010, 2022)
PLAYER_GAME_SEASONS = (2024, 2025, 2026)
RETRO_NOTICE = ("The information used here was obtained free of charge from and is copyrighted by "
                "Retrosheet. Interested parties may contact Retrosheet at www.retrosheet.org.")

GL_ZIP = "https://www.retrosheet.org/gamelogs/gl1871_2025.zip"
CSV_ZIP = "https://www.retrosheet.org/downloads/{y}/{y}csvs.zip"
SBR = "https://www.sportsbookreviewsonline.com/wp-content/uploads/sportsbookreviewsonline_com_737/mlb-odds-{y}.xlsx"
SCHED = ("https://statsapi.mlb.com/api/v1/schedule?sportId=1&season={y}"
         "&gameType=R,F,D,L,W&hydrate=linescore,venue")
BOX = "https://statsapi.mlb.com/api/v1/game/{pk}/boxscore"
CHADWICK = "https://raw.githubusercontent.com/chadwickbureau/register/master/data/people-{h}.csv"

# Franchise codes = ESPN abbreviations (so live ESPN data joins directly).
RETRO_TEAM = {
    "ANA": "LAA", "CAL": "LAA", "ARI": "ARI", "ATH": "ATH", "OAK": "ATH", "ATL": "ATL",
    "BAL": "BAL", "BOS": "BOS", "CHA": "CHW", "CHN": "CHC", "CIN": "CIN", "CLE": "CLE",
    "COL": "COL", "DET": "DET", "FLO": "MIA", "MIA": "MIA", "HOU": "HOU", "KCA": "KC",
    "LAN": "LAD", "MIL": "MIL", "MIN": "MIN", "MON": "WSH", "WAS": "WSH", "NYA": "NYY",
    "NYN": "NYM", "PHI": "PHI", "PIT": "PIT", "SDN": "SD", "SEA": "SEA", "SFN": "SF",
    "SLN": "STL", "TBA": "TB", "TEX": "TEX", "TOR": "TOR",
}
STATSAPI_TEAM = {  # Stats API team id -> franchise code
    108: "LAA", 109: "ARI", 110: "BAL", 111: "BOS", 112: "CHC", 113: "CIN", 114: "CLE",
    115: "COL", 116: "DET", 117: "HOU", 118: "KC", 119: "LAD", 120: "WSH", 121: "NYM",
    133: "ATH", 134: "PIT", 135: "SD", 136: "SEA", 137: "SF", 138: "STL", 139: "TB",
    140: "TEX", 141: "TOR", 142: "MIN", 143: "PHI", 144: "ATL", 145: "CHW", 146: "MIA",
    147: "NYY", 158: "MIL",
}
SBR_TEAM = {
    "ARI": "ARI", "ATL": "ATL", "BAL": "BAL", "BOS": "BOS", "BRS": "BOS", "CHC": "CHC",
    "CUB": "CHC", "CIN": "CIN", "CLE": "CLE", "COL": "COL", "CWS": "CHW", "DET": "DET",
    "HOU": "HOU", "KAN": "KC", "LAA": "LAA", "LAD": "LAD", "LOS": "LAD", "MIA": "MIA",
    "MIL": "MIL", "MIN": "MIN", "NYM": "NYM", "NYY": "NYY", "OAK": "ATH", "PHI": "PHI",
    "PIT": "PIT", "SDG": "SD", "SEA": "SEA", "SFG": "SF", "SFO": "SF", "STL": "STL",
    "TAM": "TB", "TEX": "TEX", "TOR": "TOR", "WAS": "WSH",
}
PLAYOFF_LOGS = ["glwc.txt", "gldv.txt", "gllc.txt", "glws.txt"]
GAMETYPES = {"regular", "wildcard", "divisionseries", "lcs", "worldseries"}


# --------------------------------------------------------------------------- download
def download(raw: Path) -> None:
    gl = fetch(GL_ZIP, raw / "retrosheet" / "gl1871_2025.zip")
    need = [f"gl{y}.txt" for y in range(FIRST, LAST_RETRO + 1)] + PLAYOFF_LOGS
    if any(not (raw / "retrosheet" / n).exists() for n in need):
        with zipfile.ZipFile(gl) as z:
            for n in need:
                z.extract(n, raw / "retrosheet")
    for y in range(FIRST, LAST_RETRO + 1):
        fetch(CSV_ZIP.format(y=y), raw / "retrosheet_csv" / f"{y}csvs.zip")
    for y in ODDS_YEARS:
        fetch(SBR.format(y=y), raw / "odds_sbr" / f"mlb_odds_{y}.xlsx")
    for h in "0123456789abcdef":
        fetch(CHADWICK.format(h=h), raw / "chadwick" / f"people-{h}.csv")
    sched = raw / "statsapi" / f"schedule_{CURRENT}.json"
    fetch(SCHED.format(y=CURRENT), sched)
    # one boxscore per final 2026 game, trimmed to the fields we use, cached gzipped
    boxdir = raw / "statsapi" / f"boxscore_{CURRENT}"
    boxdir.mkdir(parents=True, exist_ok=True)
    for g in _schedule_games(sched):
        dest = boxdir / f"{g['gamePk']}.json.gz"
        if dest.exists():
            continue
        d = get_json(BOX.format(pk=g["gamePk"]))
        dest.write_bytes(gzip.compress(json.dumps(_trim_box(d)).encode()))
        time.sleep(0.2)


def _schedule_games(path: Path) -> list[dict]:
    """Final (official) games from a saved Stats API schedule, deduplicated by gamePk."""
    d = json.loads(path.read_text())
    out = {}
    for day in d["dates"]:
        for g in day["games"]:
            if g["status"].get("codedGameState") == "F" and g["gameType"] in "RFDLW":
                out[g["gamePk"]] = g
    return list(out.values())


def _trim_box(d: dict) -> dict:
    keep = {}
    for side in ("home", "away"):
        t = d["teams"][side]
        players = {}
        for key, p in t["players"].items():
            st = p.get("stats", {})
            players[key] = {"id": p["person"]["id"], "name": p["person"]["fullName"],
                            "batting": st.get("batting", {}), "pitching": st.get("pitching", {})}
        keep[side] = {"team_id": t["team"]["id"], "batters": t.get("batters", []),
                      "pitchers": t.get("pitchers", []), "players": players}
    return keep


# --------------------------------------------------------------------------- helpers
def _innings(line: str) -> int:
    return len(re.findall(r"\(\d+\)|[0-9xX]", str(line))) if isinstance(line, str) else 0


def _read_gamelog(path: Path, game_type: str) -> pd.DataFrame:
    g = pd.read_csv(path, header=None, dtype=str, keep_default_na=False)
    g = g[g[0].str[:4].astype(int) >= FIRST]
    out = pd.DataFrame({
        "date": pd.to_datetime(g[0], format="%Y%m%d"),
        "num": g[1],
        "away_r": g[3], "home_r": g[6],
        "away_score": pd.to_numeric(g[9], errors="coerce"),
        "home_score": pd.to_numeric(g[10], errors="coerce"),
        "outs": pd.to_numeric(g[11], errors="coerce"),
        "away_line": g[19], "home_line_score": g[20],
        "park": g[16],
        "away_sp_id": g[101], "away_sp": g[102], "home_sp_id": g[103], "home_sp": g[104],
    })
    out["game_type"] = game_type
    out["game_id"] = out["home_r"] + out["date"].dt.strftime("%Y%m%d") + out["num"]
    return out


def _zip_csv(zpath: Path, suffix: str, **kw) -> pd.DataFrame:
    with zipfile.ZipFile(zpath) as z:
        name = next(n for n in z.namelist() if n.endswith(suffix))
        with z.open(name) as f:
            return pd.read_csv(f, low_memory=False, **kw)


def _chadwick(raw: Path) -> pd.DataFrame:
    parts = [pd.read_csv(p, usecols=["key_mlbam", "key_retro"], dtype=str)
             for p in sorted((raw / "chadwick").glob("people-*.csv"))]
    c = pd.concat(parts).dropna()
    c["key_mlbam"] = c["key_mlbam"].astype(int)
    return c.drop_duplicates("key_mlbam")


# --------------------------------------------------------------------------- clean
def clean(raw: Path) -> dict:
    notes, spans = [RETRO_NOTICE], {}
    games, gi_innings = _retro_games(raw, notes)
    cur, cur_starters, cur_players = _current_season(raw, notes)
    notes.append(f"{CURRENT} games come from the MLB Stats API (final/official games through the "
                 f"download date; last game {cur['date'].max().date()}). Retrosheet does not yet cover {CURRENT}.")
    allg = pd.concat([games, cur], ignore_index=True)

    # neutral site = the listed home team played fewer than 5 games at that park that season
    # (Tokyo/London/Mexico City series, Field of Dreams, Little League Classic, one-off relocated
    # makeup games). Temporary homes (Expos in San Juan, 2020-21 Blue Jays in Buffalo/Dunedin,
    # 1999 Mariners' mid-season move) have 5+ games there and stay home games.
    allg["season"] = allg["date"].dt.year
    n_at_park = allg.groupby(["season", "home", "park"])["game_id"].transform("count")
    allg["neutral"] = n_at_park < 5
    notes.append(f"{int(allg['neutral'].sum())} games flagged neutral site (home_away = N): the listed home team played "
                 "fewer than 5 games at that park that season (international series, Field of Dreams, Little League "
                 "Classic, relocated makeup games). Temporary home parks with 5+ games (Expos in San Juan 2003-04, "
                 "Blue Jays in Buffalo/Dunedin 2020-21) count as home games.")

    allg = _attach_odds(allg, raw, notes)

    panel = to_panel(allg, "mlb")
    fav = panel[panel["line"] < 0]
    ml_fav = panel[panel["favorite"] == 1]
    print(f"  moneyline favorites win {100 * (ml_fav.result == 'W').mean():.1f}% of {len(ml_fav):,} team-games")
    print(f"  run-line favorites (-1.5) cover {100 * (fav.line_result == 'cover').mean():.1f}% of {len(fav):,}")
    print(f"  totals: over {100 * (panel.ou_result == 'over').sum() / (panel.ou_result != '').sum():.1f}% of priced games")

    spans.update({
        "scores": f"{FIRST}–{CURRENT}",
        "moneyline": "2010–2021",
        "run_line": "2014–2021",
        "total_line": "2010–2021",
        "starting_pitchers": f"{FIRST}–{CURRENT}",
        "player_games": f"{PLAYER_GAME_SEASONS[0]}–{PLAYER_GAME_SEASONS[-1]}",
        "player_seasons": f"{FIRST}–{CURRENT}",
    })

    starters = pd.concat([
        pd.DataFrame({"game_id": games["game_id"], "team": games["home"],
                      "starter_id": games["home_sp_id"], "starter_name": games["home_sp"]}),
        pd.DataFrame({"game_id": games["game_id"], "team": games["away"],
                      "starter_id": games["away_sp_id"], "starter_name": games["away_sp"]}),
        _map_starters(cur_starters, raw),
    ], ignore_index=True)
    starters = starters[starters["game_id"].isin(panel["game_id"])]

    players, seasons = _players(raw, panel, cur_players, notes)
    return {"games": panel, "players": players, "player_seasons": seasons,
            "extras": {"starters": starters.sort_values(["game_id", "team"]).reset_index(drop=True)},
            "notes": notes, "spans": spans}


def _retro_games(raw: Path, notes: list) -> tuple[pd.DataFrame, None]:
    rs = raw / "retrosheet"
    reg = pd.concat([_read_gamelog(rs / f"gl{y}.txt", "regular") for y in range(FIRST, LAST_RETRO + 1)])
    post = pd.concat([_read_gamelog(rs / f, "playoff") for f in PLAYOFF_LOGS])
    g = pd.concat([reg, post], ignore_index=True)
    n0 = len(g)
    g = g.dropna(subset=["home_score", "away_score"])
    if n0 - len(g):
        notes.append(f"Dropped {n0 - len(g)} Retrosheet games with no final score.")
    # scheduled innings (7 for 2020-21 doubleheaders) from Retrosheet gameinfo
    sched = []
    for y in range(FIRST, LAST_RETRO + 1):
        gi = _zip_csv(raw / "retrosheet_csv" / f"{y}csvs.zip", "gameinfo.csv", usecols=["gid", "innings"])
        sched.append(gi)
    sched = pd.concat(sched).drop_duplicates("gid").set_index("gid")["innings"]
    sched = pd.to_numeric(sched, errors="coerce")
    g["sched_inn"] = g["game_id"].map(sched).fillna(9)
    g["innings"] = g["away_line"].map(_innings)
    g["decided_in"] = np.where(g["innings"] > g["sched_inn"], "XI", "REG")
    g["home"] = g["home_r"].map(RETRO_TEAM)
    g["away"] = g["away_r"].map(RETRO_TEAM)
    assert g[["home", "away"]].notna().all().all(), "unmapped Retrosheet team code"
    g["season"] = g["date"].dt.year
    g["home_sp_id"] = g["home_sp_id"].replace("", np.nan)
    g["away_sp_id"] = g["away_sp_id"].replace("", np.nan)
    notes.append("Team codes are current franchise codes: Montreal Expos (MON) -> WSH, Florida Marlins (FLO) -> MIA, "
                 "California/Anaheim Angels (CAL/ANA) -> LAA, Tampa Bay Devil Rays -> TB, Oakland Athletics (OAK) -> ATH, "
                 "Cleveland Indians -> CLE.")
    notes.append(f"Retrosheet {FIRST}–{LAST_RETRO}: {int((g.game_type == 'regular').sum()):,} regular-season and "
                 f"{int((g.game_type == 'playoff').sum()):,} postseason games. All-Star games excluded.")
    return g, None


def _current_season(raw: Path, notes: list):
    sched_games = _schedule_games(raw / "statsapi" / f"schedule_{CURRENT}.json")
    boxdir = raw / "statsapi" / f"boxscore_{CURRENT}"
    rows, starters, prow = [], [], []
    for sg in sched_games:
        pk = sg["gamePk"]
        home_id, away_id = sg["teams"]["home"]["team"]["id"], sg["teams"]["away"]["team"]["id"]
        home, away = STATSAPI_TEAM.get(home_id), STATSAPI_TEAM.get(away_id)
        hs, as_ = sg["teams"]["home"].get("score"), sg["teams"]["away"].get("score")
        if home is None or away is None or hs is None or as_ is None:
            continue
        ls = sg.get("linescore", {})
        n_inn = len(ls.get("innings", []))
        sched_inn = ls.get("scheduledInnings", 9)
        gid = f"mlb{CURRENT}_{pk}"
        rows.append({"game_id": gid, "date": pd.Timestamp(sg["officialDate"]), "home": home, "away": away,
                     "home_score": hs, "away_score": as_,
                     "game_type": "regular" if sg["gameType"] == "R" else "playoff",
                     "decided_in": "XI" if n_inn > sched_inn else "REG",
                     "park": str(sg.get("venue", {}).get("id"))})
        bp = boxdir / f"{pk}.json.gz"
        if not bp.exists():
            continue
        box = json.loads(gzip.decompress(bp.read_bytes()))
        for side, team, opp in (("home", home, away), ("away", away, home)):
            t = box[side]
            if t["pitchers"]:
                sp = t["players"][f"ID{t['pitchers'][0]}"]
                starters.append({"game_id": gid, "team": team, "mlbam": sp["id"], "starter_name": sp["name"]})
            for key, p in t["players"].items():
                b, pi = p["batting"], p["pitching"]
                base = {"date": sg["officialDate"], "season": CURRENT, "game_id": gid, "mlbam_id": p["id"],
                        "player": p["name"], "team": team, "opponent": opp,
                        "game_type": "regular" if sg["gameType"] == "R" else "playoff"}
                if b and b.get("plateAppearances", 0) > 0:
                    prow.append({**base, "role": "batter", "pa": b["plateAppearances"], "ab": b["atBats"],
                                 "h": b["hits"], "hr": b["homeRuns"], "rbi": b["rbi"], "sb": b["stolenBases"],
                                 "bb": b["baseOnBalls"], "so": b["strikeOuts"]})
                if pi and pi.get("battersFaced", 0) > 0 or (pi and pi.get("outs", 0) > 0):
                    prow.append({**base, "role": "pitcher", "ip_outs": pi["outs"], "k_p": pi["strikeOuts"],
                                 "er": pi["earnedRuns"], "bf": pi["battersFaced"],
                                 "gs": int(pi.get("gamesStarted", 0) or 0)})
    cur = pd.DataFrame(rows)
    missing_box = len(cur) - len({s["game_id"] for s in starters})
    if missing_box:
        notes.append(f"{missing_box} {CURRENT} games have no cached boxscore; their player rows and starters are absent.")
    return cur, pd.DataFrame(starters), pd.DataFrame(prow)


def _read_sbr(path: Path, year: int) -> pd.DataFrame:
    x = pd.read_excel(path)
    cols = list(x.columns)
    i = cols.index("Close")
    rename = {cols[i]: "close_ml"}
    rest = cols[i + 1:]
    if len(rest) == 6:  # run line present (2014+)
        rename.update({rest[0]: "rl", rest[1]: "rl_price", rest[4]: "close_ou"})
    else:
        rename.update({rest[2]: "close_ou"})
    x = x.rename(columns=rename)
    if "rl" not in x:
        x["rl"] = np.nan
    x = x.reset_index(drop=True)
    v, h = x.iloc[0::2].reset_index(drop=True), x.iloc[1::2].reset_index(drop=True)
    num = lambda s: pd.to_numeric(s, errors="coerce")
    mmdd = v["Date"].astype(int)
    out = pd.DataFrame({
        "date": pd.to_datetime(dict(year=year, month=mmdd // 100, day=mmdd % 100)),
        "away": v["Team"].map(SBR_TEAM), "home": h["Team"].map(SBR_TEAM),
        "away_score": num(v["Final"]), "home_score": num(h["Final"]),
        "away_ml": num(v["close_ml"]), "home_ml": num(h["close_ml"]),
        "home_rl": num(h["rl"]), "away_rl": num(v["rl"]),
        "total_line": num(v["close_ou"]).fillna(num(h["close_ou"])),
    })
    assert out[["home", "away"]].notna().all().all(), f"unmapped SBR team in {year}"
    return out


def _attach_odds(g: pd.DataFrame, raw: Path, notes: list) -> pd.DataFrame:
    g = g.copy()
    for c in ["home_ml", "away_ml", "home_line", "total_line"]:
        g[c] = np.nan
    g = g.reset_index(drop=True)
    g["rid"] = np.arange(len(g))
    rates, assign = [], {}
    for y in ODDS_YEARS:
        o = _read_sbr(raw / "odds_sbr" / f"mlb_odds_{y}.xlsx", y)
        gy = g[g["season"] == y]
        used = set()
        matched = ambiguous = 0
        idx = {}
        for r in gy.itertuples():
            idx.setdefault((r.date, frozenset((r.home, r.away))), []).append(r)
        for r in o.itertuples():
            cands = []
            for dd in (0, -1, 1):
                cands = [c for c in idx.get((r.date + pd.Timedelta(days=dd), frozenset((r.home, r.away))), [])
                         if c.rid not in used]
                if cands:
                    break
            # use the final score to pick among doubleheader games / confirm the match
            def score_ok(c):
                if c.home == r.home:
                    return c.home_score == r.home_score and c.away_score == r.away_score
                return c.home_score == r.away_score and c.away_score == r.home_score
            good = [c for c in cands if score_ok(c)]
            if len(good) != 1:
                if len(good) > 1 or len(cands) > 1:
                    ambiguous += 1
                continue
            c = good[0]
            used.add(c.rid)
            flip = c.home != r.home  # SBR lists the teams the other way round (neutral sites)
            assign[c.rid] = (r.away_ml if flip else r.home_ml, r.home_ml if flip else r.away_ml,
                            r.away_rl if flip else r.home_rl, r.total_line)
            matched += 1
        n_games = len(gy)
        rates.append(f"{y}: {matched:,}/{n_games:,} games ({100 * matched / n_games:.1f}%)"
                     + (f", {ambiguous} ambiguous left blank" if ambiguous else ""))
        print(f"  SBR odds {rates[-1]} [{len(o):,} SBR rows]")
    if assign:
        ii = np.fromiter(assign.keys(), int)
        vals = np.array(list(assign.values()), dtype=float)
        g.iloc[ii, [g.columns.get_loc(c) for c in ["home_ml", "away_ml", "home_line", "total_line"]]] = vals
    notes.append("Odds (closing moneyline, closing total; run line 2014+) from SportsbookReviewsOnline season "
                 "files 2010–2021, matched on date + teams + final score. No free odds archive covers 1990–2009 or "
                 "2022–2026, so those seasons have blank odds columns. Match rate by season: " + "; ".join(rates) + ".")
    notes.append("MLB `line` is the run line (±1.5). Run line favorite = the team laying 1.5 runs.")
    bad = g["home_ml"].notna() & (g["home_ml"].abs() < 100)
    if bad.any():
        notes.append(f"{int(bad.sum())} matched games had a moneyline between -100 and +100 (invalid); moneylines blanked.")
        g.loc[bad, ["home_ml", "away_ml"]] = np.nan
    return g.drop(columns="rid")


def _map_starters(cs: pd.DataFrame, raw: Path) -> pd.DataFrame:
    m = dict(zip(*_chadwick(raw)[["key_mlbam", "key_retro"]].T.values))
    sid = cs["mlbam"].map(m)
    sid = sid.where(sid.notna(), "mlbam" + cs["mlbam"].astype(str))
    return pd.DataFrame({"game_id": cs["game_id"], "team": cs["team"], "starter_id": sid,
                         "starter_name": cs["starter_name"]})


def _players(raw: Path, panel: pd.DataFrame, cur: pd.DataFrame, notes: list):
    chad = _chadwick(raw)
    mlbam_to_retro = dict(zip(chad["key_mlbam"], chad["key_retro"]))
    retro_to_mlbam = dict(zip(chad["key_retro"], chad["key_mlbam"]))
    ha = panel.set_index(["game_id", "team"])["home_away"]

    names, bat_s, pit_s, games = {}, [], [], []
    for y in range(FIRST, LAST_RETRO + 1):
        z = raw / "retrosheet_csv" / f"{y}csvs.zip"
        ap = _zip_csv(z, "allplayers.csv", usecols=["id", "last", "first"], dtype=str)
        names.update(dict(zip(ap["id"], ap["first"].fillna("") + " " + ap["last"].fillna(""))))
        b = _zip_csv(z, "batting.csv", usecols=["gid", "id", "team", "b_pa", "b_ab", "b_h", "b_hr", "b_rbi",
                                               "b_sb", "b_w", "b_k", "date", "opp", "gametype", "stattype"])
        p = _zip_csv(z, "pitching.csv", usecols=["gid", "id", "team", "p_ipouts", "p_bfp", "p_k", "p_er",
                                                "p_gs", "date", "opp", "gametype", "stattype"])
        b = b[(b.stattype == "value") & b.gametype.isin(GAMETYPES)]
        p = p[(p.stattype == "value") & p.gametype.isin(GAMETYPES)]
        b = b.rename(columns={"b_pa": "pa", "b_ab": "ab", "b_h": "h", "b_hr": "hr", "b_rbi": "rbi", "b_sb": "sb",
                              "b_w": "bb", "b_k": "so"})
        p = p.rename(columns={"p_ipouts": "ip_outs", "p_bfp": "bf", "p_k": "k_p", "p_er": "er", "p_gs": "gs"})
        p["gs"] = p["gs"].fillna(0).astype(int)
        for d in (b, p):
            d["team"] = d["team"].map(RETRO_TEAM)
            d["opp"] = d["opp"].map(RETRO_TEAM)
            d["season"] = y
            d["game_type"] = np.where(d["gametype"] == "regular", "regular", "playoff")
        reg_b, reg_p = b[b.game_type == "regular"], p[p.game_type == "regular"]
        bat_s.append(reg_b.groupby(["season", "id", "team"]).agg(
            g=("gid", "nunique"), pa=("pa", "sum"), ab=("ab", "sum"), h=("h", "sum"), hr=("hr", "sum"),
            rbi=("rbi", "sum"), sb=("sb", "sum"), bb=("bb", "sum"), so=("so", "sum")).reset_index())
        pit_s.append(reg_p.groupby(["season", "id", "team"]).agg(
            g=("gid", "nunique"), gs=("gs", "sum"), ip_outs=("ip_outs", "sum"), k_p=("k_p", "sum"),
            er=("er", "sum"), bf=("bf", "sum")).reset_index())
        if y in PLAYER_GAME_SEASONS:
            for d, role in ((b, "batter"), (p, "pitcher")):
                d = d.assign(role=role, date=pd.to_datetime(d["date"].astype(str), format="%Y%m%d").dt.strftime("%Y-%m-%d"))
                games.append(d.rename(columns={"gid": "game_id", "id": "player_id", "opp": "opponent"}))

    # Stats API season (current) -> Retrosheet ids where the Chadwick register knows them
    cur = cur.copy()
    cur["player_id"] = cur["mlbam_id"].map(mlbam_to_retro)
    unmapped = cur["player_id"].isna()
    cur.loc[unmapped, "player_id"] = "mlbam" + cur.loc[unmapped, "mlbam_id"].astype(str)
    notes.append(f"Player ids are Retrosheet ids; {CURRENT} Stats API players are mapped via the Chadwick register "
                 f"({int(unmapped.sum()):,} of {len(cur):,} {CURRENT} player-game rows unmapped, kept with id 'mlbam<id>').")
    for _, r in cur.drop_duplicates("player_id").iterrows():
        names.setdefault(r["player_id"], r["player"])
    games.append(cur)

    pg = pd.concat(games, ignore_index=True)
    pg["player"] = pg["player_id"].map(names)
    pg["mlbam_id"] = pg["player_id"].map(retro_to_mlbam).fillna(pg.get("mlbam_id"))
    pg = pg.merge(ha.reset_index(), on=["game_id", "team"], how="left")
    n0 = len(pg)
    pg = pg[pg["game_id"].isin(panel["game_id"])]
    if n0 - len(pg):
        notes.append(f"Dropped {n0 - len(pg):,} player-game rows whose game is not in the panel.")
    pcols = ["date", "season", "game_id", "game_type", "player_id", "mlbam_id", "player", "team", "opponent",
             "home_away", "role", "pa", "ab", "h", "hr", "rbi", "sb", "bb", "so", "ip_outs", "k_p", "er", "bf", "gs"]
    pg = pg[pcols].sort_values(["date", "game_id", "team", "role", "player_id"]).reset_index(drop=True)
    pg["mlbam_id"] = pd.to_numeric(pg["mlbam_id"], errors="coerce").astype("Int64")
    for c in ["pa", "ab", "h", "hr", "rbi", "sb", "bb", "so", "ip_outs", "k_p", "er", "bf", "gs"]:
        pg[c] = pd.to_numeric(pg[c], errors="coerce").astype("Int64")

    # current-season totals from the per-game rows
    cb = cur[(cur.role == "batter") & (cur.game_type == "regular")].groupby(["season", "player_id", "team"]).agg(
        g=("game_id", "nunique"), pa=("pa", "sum"), ab=("ab", "sum"), h=("h", "sum"), hr=("hr", "sum"),
        rbi=("rbi", "sum"), sb=("sb", "sum"), bb=("bb", "sum"), so=("so", "sum")).reset_index().rename(columns={"player_id": "id"})
    cp = cur[(cur.role == "pitcher") & (cur.game_type == "regular")].groupby(["season", "player_id", "team"]).agg(
        g=("game_id", "nunique"), gs=("gs", "sum"), ip_outs=("ip_outs", "sum"), k_p=("k_p", "sum"),
        er=("er", "sum"), bf=("bf", "sum")).reset_index().rename(columns={"player_id": "id"})
    bs = pd.concat(bat_s + [cb], ignore_index=True).assign(role="batter")
    ps = pd.concat(pit_s + [cp], ignore_index=True).assign(role="pitcher")
    ps = ps[(ps["ip_outs"] > 0) | (ps["bf"] > 0)]
    bs = bs[bs["pa"] > 0]
    seasons = pd.concat([bs, ps], ignore_index=True).rename(columns={"id": "player_id"})
    seasons["player"] = seasons["player_id"].map(names)
    scols = ["season", "player_id", "player", "team", "role", "g", "pa", "ab", "h", "hr", "rbi", "sb", "bb", "so",
             "gs", "ip_outs", "k_p", "er", "bf"]
    seasons = seasons[scols].sort_values(["season", "role", "team", "player_id"]).reset_index(drop=True)
    for c in scols[5:]:
        seasons[c] = pd.to_numeric(seasons[c], errors="coerce").astype("Int64")
    notes.append(f"Player-game file covers {PLAYER_GAME_SEASONS[0]}–{PLAYER_GAME_SEASONS[-1]} (regular season + "
                 f"postseason; batter and pitcher rows separate). Player-season file covers {FIRST}–{CURRENT}, regular "
                 "season only, one row per player/team/role (a traded player has one row per team).")
    return pg, seasons
