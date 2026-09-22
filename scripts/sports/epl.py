"""English Premier League: match results + 1X2 / Asian handicap / O-U 2.5 odds
(football-data.co.uk, 1993-94 onward) and player-match goals/assists
(vaastav/Fantasy-Premier-League, 2016-17 onward)."""
from __future__ import annotations

import csv
import re
from pathlib import Path

import numpy as np
import pandas as pd

from common import fetch, fetch_optional, season_start_year, to_panel

FD_URL = "https://www.football-data.co.uk/mmz4281/{code}/E0.csv"
FPL_URL = "https://raw.githubusercontent.com/vaastav/Fantasy-Premier-League/master/data"
FIRST = 1993                      # first season start year; the last one comes from the date / raw files
FPL_FIRST = 2016
MASTER_LIST_LAST = 2023           # master_team_list.csv covers 2016-17..2023-24
NO_POSITION_LAST = 2019           # merged_gw lacks `position` for 2016-17..2019-20

# FPL short club names -> football-data.co.uk club names (the panel's team codes)
FPL_TO_FD = {
    "Man Utd": "Man United", "Spurs": "Tottenham", "Sheffield Utd": "Sheffield United",
    "Nott'm Forest": "Nott'm Forest", "Nottingham Forest": "Nott'm Forest",
    "Wolverhampton": "Wolves", "Leeds United": "Leeds", "Leicester City": "Leicester",
    "Luton Town": "Luton", "Ipswich Town": "Ipswich", "Brighton & Hove Albion": "Brighton",
    "Huddersfield Town": "Huddersfield", "Cardiff City": "Cardiff", "Norwich City": "Norwich",
    "Stoke City": "Stoke", "Swansea City": "Swansea", "Hull City": "Hull",
    "West Bromwich Albion": "West Brom", "Newcastle United": "Newcastle",
    "West Ham United": "West Ham", "Tottenham Hotspur": "Tottenham",
    "Manchester United": "Man United", "Manchester City": "Man City", "Man City": "Man City",
    "Sunderland AFC": "Sunderland", "Coventry City": "Coventry",
}


def code(season: int) -> str:
    return f"{season % 100:02d}{(season + 1) % 100:02d}"


def fpl_label(season: int) -> str:
    return f"{season}-{(season + 1) % 100:02d}"


def current_season() -> int:
    """Premier League season in progress or most recently started (kicks off in August)."""
    return season_start_year(8)


def last_season(raw_dir: Path) -> int:
    """Newest season whose football-data file is on disk (clean() depends only on raw files)."""
    seasons = []
    for f in (raw_dir / "football-data").glob("E0_*.csv"):
        yy = int(f.stem[3:5])
        seasons.append(1900 + yy if yy >= 90 else 2000 + yy)
    return max(seasons)


def download(raw_dir: Path) -> None:
    cur = current_season()
    for s in range(FIRST, cur + 1):
        get = fetch if s < cur else fetch_optional   # a new season's file appears after matchday 1
        get(FD_URL.format(code=code(s)), raw_dir / "football-data" / f"E0_{code(s)}.csv")
    fetch(f"{FPL_URL}/master_team_list.csv", raw_dir / "fpl" / "master_team_list.csv")
    for s in range(FPL_FIRST, cur + 1):
        lab = fpl_label(s)
        get = fetch if s < cur else fetch_optional
        get(f"{FPL_URL}/{lab}/gws/merged_gw.csv", raw_dir / "fpl" / f"merged_gw_{lab}.csv")
        if s > MASTER_LIST_LAST:
            get(f"{FPL_URL}/{lab}/teams.csv", raw_dir / "fpl" / f"teams_{lab}.csv")
        if s <= NO_POSITION_LAST:  # merged_gw has no position column; take it from players_raw
            fetch(f"{FPL_URL}/{lab}/players_raw.csv", raw_dir / "fpl" / f"players_raw_{lab}.csv")


def current_files(raw_dir: Path) -> list[Path]:
    """Raw files that change as the current season is played (re-downloaded by the hourly refresh)."""
    lab = fpl_label(current_season())
    return [raw_dir / "football-data" / f"E0_{code(current_season())}.csv",
            raw_dir / "fpl" / f"merged_gw_{lab}.csv",
            raw_dir / "fpl" / f"teams_{lab}.csv"]


# ---------------------------------------------------------------- matches
def read_fd(path: Path) -> pd.DataFrame:
    """football-data files have ragged rows (extra trailing fields); pad them
    instead of letting pandas skip them (naive read drops 45 matches in each
    of 2003-04 and 2004-05)."""
    with open(path, encoding="latin-1", newline="") as f:
        rows = list(csv.reader(f))
    hdr = [h.lstrip("﻿ï»¿").strip() for h in rows[0]]
    width = max(len(r) for r in rows)
    hdr += [f"_extra{i}" for i in range(width - len(hdr))]
    df = pd.DataFrame([r + [""] * (width - len(r)) for r in rows[1:]], columns=hdr)
    df = df.loc[:, ~pd.Index(df.columns).duplicated()]
    df = df[df["HomeTeam"].str.strip() != ""].copy()
    return df.replace("", np.nan)


def num(df, col):
    return pd.to_numeric(df[col], errors="coerce") if col in df else pd.Series(np.nan, index=df.index)


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def pick_odds(df: pd.DataFrame, season: int):
    """Return (H, D, A, label) using the documented priority order."""
    for prefix, label in [("AvgC", "closing market average (AvgC)"),
                          ("BbAv", "pre-match market average (BbAv)"),
                          ("B365", "Bet365 pre-match (B365)")]:
        if f"{prefix}H" in df and num(df, f"{prefix}H").notna().any():
            return num(df, f"{prefix}H"), num(df, f"{prefix}D"), num(df, f"{prefix}A"), label
    # 2000-01, 2001-02: single bookmakers only; pick the most complete one
    best = None
    for b in ["WH", "IW", "LB", "SB", "GB"]:
        if f"{b}H" in df:
            n = num(df, f"{b}H").notna().sum()
            if best is None or n > best[1]:
                best = (b, n)
    if best:
        b = best[0]
        return num(df, f"{b}H"), num(df, f"{b}D"), num(df, f"{b}A"), f"single bookmaker {b} pre-match ({b})"
    nan = pd.Series(np.nan, index=df.index)
    return nan, nan, nan, "none"


def pick_ah(df):
    for col, label in [("AHCh", "closing Asian handicap (AHCh)"), ("AHh", "pre-match Asian handicap (AHh)"),
                       ("BbAHh", "pre-match Asian handicap (BbAHh)")]:
        if col in df and num(df, col).notna().any():
            return num(df, col), label
    return pd.Series(np.nan, index=df.index), "none"


def has_ou(df):
    for h in ["AvgC>2.5", "BbAv>2.5", "Avg>2.5", "B365>2.5", "GB>2.5"]:
        if h in df and num(df, h).notna().any():
            return num(df, h).notna(), h
    return pd.Series(False, index=df.index), "none"


def load_matches(raw_dir: Path, notes: list):
    frames, odds_src, ah_src, ou_src = [], {}, {}, {}
    for s in range(FIRST, last_season(raw_dir) + 1):
        df = read_fd(raw_dir / "football-data" / f"E0_{code(s)}.csv")
        n0 = len(df)
        df["date"] = pd.to_datetime(df["Date"], dayfirst=True, format="mixed")
        df["home"], df["away"] = df["HomeTeam"].str.strip(), df["AwayTeam"].str.strip()
        df["home_score"], df["away_score"] = num(df, "FTHG"), num(df, "FTAG")
        df = df[df["home_score"].notna() & df["away_score"].notna()].copy()
        if len(df) != n0:
            notes.append(f"{fpl_label(s)}: dropped {n0 - len(df)} rows without a final score.")
        h, d, a, lab = pick_odds(df, s)
        df["odds_h"], df["odds_d"], df["odds_a"] = h, d, a
        odds_src[s] = (lab, int(h.notna().sum()), len(df))
        df["home_line"], ahl = pick_ah(df)
        ah_src[s] = (ahl, int(df["home_line"].notna().sum()))
        ou_mask, oul = has_ou(df)
        df["total_line"] = np.where(ou_mask, 2.5, np.nan)
        ou_src[s] = (oul, int(ou_mask.sum()))
        df["season"] = s
        df["game_type"] = "regular"
        df["game_id"] = [f"epl_{s}_{slug(x)}_{slug(y)}" for x, y in zip(df["home"], df["away"])]
        frames.append(df[["game_id", "date", "season", "game_type", "home", "away", "home_score",
                          "away_score", "home_line", "total_line", "odds_h", "odds_d", "odds_a"]])
    g = pd.concat(frames, ignore_index=True)
    assert not g["game_id"].duplicated().any(), "duplicate EPL game ids"
    return g, odds_src, ah_src, ou_src


def ranges(d: dict, ok) -> str:
    """Compress seasons where ok(value) into 'a-b, c-d' spans of season labels."""
    yrs = sorted(s for s, v in d.items() if ok(v))
    if not yrs:
        return "none"
    groups = [[yrs[0]]]
    for y in yrs[1:]:
        if y == groups[-1][-1] + 1:
            groups[-1].append(y)
        else:
            groups.append([y])
    return ", ".join(fpl_label(a[0]) if len(a) == 1 else f"{fpl_label(a[0])} to {fpl_label(a[-1])}" for a in groups)


# ---------------------------------------------------------------- players
def read_any(path: Path) -> pd.DataFrame:
    """FPL files for 2016-17..2018-19 are latin-1; later seasons are UTF-8."""
    try:
        return pd.read_csv(path, encoding="utf-8", low_memory=False)
    except UnicodeDecodeError:
        return pd.read_csv(path, encoding="latin-1", low_memory=False)


def fpl_team_names(raw_dir: Path, season: int) -> dict:
    lab = fpl_label(season)
    if season <= MASTER_LIST_LAST:
        m = pd.read_csv(raw_dir / "fpl" / "master_team_list.csv")
        m = m[m["season"] == lab]
        ids = dict(zip(m["team"].astype(int), m["team_name"]))
    else:
        t = pd.read_csv(raw_dir / "fpl" / f"teams_{lab}.csv")
        ids = dict(zip(t["id"].astype(int), t["name"]))
    return {k: FPL_TO_FD.get(v, v) for k, v in ids.items()}


def load_players(raw_dir: Path, games: pd.DataFrame, notes: list):
    pos_map = {"GK": "GK", "GKP": "GK", "DEF": "DEF", "MID": "MID", "FWD": "FWD", "AM": "MID"}
    frames = []
    for s in range(FPL_FIRST, last_season(raw_dir) + 1):
        lab = fpl_label(s)
        if not (raw_dir / "fpl" / f"merged_gw_{lab}.csv").exists():
            continue  # FPL archive not published yet for this season
        p = read_any(raw_dir / "fpl" / f"merged_gw_{lab}.csv")
        names = fpl_team_names(raw_dir, s)
        teams_in_season = set(games.loc[games["season"] == s, "home"])
        bad = set(names.values()) - teams_in_season
        assert not bad, f"{lab}: FPL team names not in football-data: {bad}"
        p["opponent"] = p["opponent_team"].astype(int).map(names)
        p["was_home"] = p["was_home"].astype(str).str.lower().eq("true")
        p["kick"] = pd.to_datetime(p["kickoff_time"], utc=True).dt.tz_convert("Europe/London").dt.tz_localize(None).dt.normalize()
        gs = games[games["season"] == s]
        # the player's own team = the other side of the match played that day vs `opponent`
        home_key = gs.set_index(["date", "away"])["home"]      # player at home: opponent is away side
        away_key = gs.set_index(["date", "home"])["away"]      # player away: opponent is home side
        hk = pd.MultiIndex.from_arrays([p["kick"], p["opponent"]])
        p["team"] = np.where(p["was_home"], home_key.reindex(hk).values, away_key.reindex(hk).values)
        p["home_team"] = np.where(p["was_home"], p["team"], p["opponent"])
        p["away_team"] = np.where(p["was_home"], p["opponent"], p["team"])
        gid = gs.set_index(["home", "away"])["game_id"]
        p["game_id"] = gid.reindex(pd.MultiIndex.from_arrays([p["home_team"], p["away_team"]])).values
        # A row that matches no played fixture on that date is a fixture FPL still lists
        # under its original (postponed) kickoff; those rows carry 0 minutes and are dropped.
        joined = p["game_id"].notna()
        msg = (f"FPL {lab}: {joined.sum():,} of {len(p):,} player-match rows joined to a football-data match "
               f"({joined.mean():.1%})")
        if (~joined).any():
            mins = int(p.loc[~joined, "minutes"].sum())
            fx = p.loc[~joined, ["kick", "opponent"]].drop_duplicates()
            msg += (f"; {(~joined).sum():,} rows dropped because FPL lists them under a postponed fixture's original "
                    f"date ({', '.join(sorted(fx['kick'].dt.strftime('%Y-%m-%d').unique()))}) with {mins} total minutes")
        notes.append(msg + ".")
        p = p[joined].copy()
        if "position" not in p:
            pr = read_any(raw_dir / "fpl" / f"players_raw_{lab}.csv")
            etype = dict(zip(pr["id"], pr["element_type"].map({1: "GK", 2: "DEF", 3: "MID", 4: "FWD"})))
            p["position"] = p["element"].map(etype)
        p["position"] = p["position"].map(pos_map)
        p["season"] = s
        p["date"] = p["kick"].dt.strftime("%Y-%m-%d")
        p = p.rename(columns={"element": "player_id", "name": "player", "goals_scored": "goals"})
        p["player"] = p["player"].str.replace(r"_\d+$", "", regex=True).str.replace("_", " ")
        p["home_away"] = np.where(p["was_home"], "H", "A")
        frames.append(p[["date", "season", "game_id", "player_id", "player", "team", "opponent",
                         "home_away", "position", "minutes", "goals", "assists"]])
    allp = pd.concat(frames, ignore_index=True)
    for c in ["minutes", "goals", "assists", "player_id"]:
        allp[c] = allp[c].astype(int)
    dup = allp.duplicated(["season", "player_id", "game_id"]).sum()
    if dup:
        notes.append(f"FPL: dropped {dup} exact duplicate player-match rows.")
        allp = allp.drop_duplicates(["season", "player_id", "game_id"])
    return allp


def clean(raw_dir: Path) -> dict:
    notes: list[str] = []
    g, odds_src, ah_src, ou_src = load_matches(raw_dir, notes)

    per = g.groupby("season").size()
    LAST = int(per.index.max())
    complete = int(per.get(LAST, 0)) >= 380
    done = LAST if complete else LAST - 1
    notes.append(f"Matches per season: 462 in 1993-94 and 1994-95 (22 clubs), 380 from 1995-96 to {fpl_label(done)} "
                 + ("(20 clubs)." if complete else
                    f"(20 clubs); {fpl_label(LAST)} is in progress with {int(per.get(LAST, 0))} matches played by the download date.")
                 if (per.loc[1993:1994] == 462).all() and (per.loc[1995:done] == 380).all()
                 else f"Matches per season: {per.to_dict()}")
    notes.append("All Premier League matches are regular-season (no playoffs) and played at the home club's ground; "
                 "team codes are football-data.co.uk club names, which are stable across seasons (no relocations).")
    notes.append("1X2 odds source by season: " + "; ".join(
        f"{ranges(odds_src, lambda v, L=L: v[0] == L)}: {L}" for L in dict.fromkeys(v[0] for v in odds_src.values())))
    notes.append("Only 2019-20 onward uses true closing odds (market average at kick-off); earlier seasons are "
                 "pre-match snapshots, and 1993-94 to 1999-00 have no odds at all.")
    for s, (lab, n, tot) in odds_src.items():
        if lab != "none" and n < tot:
            notes.append(f"{fpl_label(s)}: 1X2 odds present for {n} of {tot} matches (rest left blank).")
    notes.append("Asian handicap line (the `line` column, home handicap, negative = favored) by season: " + "; ".join(
        f"{ranges(ah_src, lambda v, L=L: v[0] == L)}: {L}" for L in dict.fromkeys(v[0] for v in ah_src.values())))
    notes.append("`total_line` is set to 2.5 goals only where the file carries over/under-2.5 odds for the match "
                 "(so `ou_result` is over/under 2.5 goals); blank otherwise. O/U odds column by season: " + "; ".join(
                     f"{ranges(ou_src, lambda v, L=L: v[0] == L)}: {L}" for L in dict.fromkeys(v[0] for v in ou_src.values())))
    for s, (lab, n) in ah_src.items():
        tot = int(per[s])
        if lab != "none" and n < tot:
            notes.append(f"{fpl_label(s)}: Asian handicap line present for {n} of {tot} matches (rest left blank).")
    for s, (lab, n) in ou_src.items():
        tot = int(per[s])
        if lab != "none" and n < tot:
            notes.append(f"{fpl_label(s)}: over/under-2.5 odds present for {n} of {tot} matches.")

    # sanity checks on sign conventions
    ah = g[g["home_line"].notna() & (g["home_line"] != 0)]
    fav_home = ah["home_line"] < 0
    home_win = ah["home_score"] > ah["away_score"]
    print(f"  AH sign check: home win% when home_line<0: {home_win[fav_home].mean():.3f}; "
          f"when home_line>0: {home_win[~fav_home].mean():.3f}")
    assert home_win[fav_home].mean() > home_win[~fav_home].mean(), "Asian handicap sign convention looks inverted"

    panel = to_panel(g, "epl")
    f = panel[panel["favorite"] == 1]
    lined = f[f["line_result"] != ""]
    lr = lined["line_result"].value_counts(normalize=True)
    print(f"  favorites: {len(f):,} team-games, win {(f['result'] == 'W').mean():.3f}, "
          f"draw {(f['result'] == 'D').mean():.3f}; vs Asian handicap cover {lr.get('cover', 0):.3f}, "
          f"push {lr.get('push', 0):.3f}, miss {lr.get('miss', 0):.3f}")
    notes.append(f"Sanity check: market favorites won {(f['result'] == 'W').mean():.1%} and drew "
                 f"{(f['result'] == 'D').mean():.1%} of {len(f):,} team-games with odds.")
    notes.append("Asian handicap quarter lines (e.g. -0.75) split the stake across two lines; `line_result` here is "
                 "simply margin + line compared with zero, so a quarter-line half-win counts as cover.")

    players_all = load_players(raw_dir, g, notes)
    last_p = int(players_all["season"].max())
    notes.append("Player goals and assists come from Fantasy Premier League data (vaastav/Fantasy-Premier-League), "
                 "available from 2016-17; they follow FPL scoring rules, not official Opta records.")
    n26 = players_all[players_all["season"] == LAST]
    if len(n26) and n26["game_id"].nunique() < int(per.get(LAST, 0)):
        notes.append(f"FPL data for {fpl_label(LAST)} is stale in the source repository: {n26['game_id'].nunique()} matches "
                     f"up to {n26['date'].max()} only.")
    PLAYER_GAME_SEASONS = (LAST - 2, LAST - 1, LAST)   # two completed seasons + the current one
    players = players_all[players_all["season"].isin(PLAYER_GAME_SEASONS)].sort_values(["date", "game_id", "team", "player"])
    ps = (players_all[players_all["minutes"] > 0]
          .groupby(["season", "player_id", "player", "team"], as_index=False)
          .agg(position=("position", "last"), games=("game_id", "nunique"), minutes=("minutes", "sum"),
               goals=("goals", "sum"), assists=("assists", "sum")))
    notes.append("Player-season rows count only matches with minutes > 0; a player transferred between clubs mid-season "
                 "has one row per club.")

    has = lambda col: g.loc[g[col].notna(), "season"]
    span = lambda s: f"{fpl_label(int(s.min()))}–{fpl_label(int(s.max()))}" if len(s) else "n/a"
    spans = {
        "scores": span(g["season"]),
        "odds_1x2": span(has("odds_h")),
        "closing_odds_1x2": "2019-20–" + fpl_label(LAST),
        "asian_handicap": span(has("home_line")),
        "over_under_2.5": span(has("total_line")),
        "player_games": f"{fpl_label(PLAYER_GAME_SEASONS[0])}–{fpl_label(last_p)}",
        "player_seasons": f"{fpl_label(FPL_FIRST)}–{fpl_label(last_p)}",
    }
    return {"games": panel, "players": players.reset_index(drop=True), "player_seasons": ps,
            "notes": notes, "spans": spans}
