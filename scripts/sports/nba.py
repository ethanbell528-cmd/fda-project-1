"""NBA: download + clean.

Sources
  Games 1990-91..2000-01  FiveThirtyEight nbaallelo.csv (CC-BY 4.0)
                          https://github.com/fivethirtyeight/data/tree/master/nba-elo
  Games 2001-02..latest   hoopR-nba-data schedule master (ESPN data, CC-BY 4.0)
                          https://github.com/sportsdataverse/hoopR-nba-data
  Score cross-check       hoopR team_box parquet per season
  Players 2001-02..latest hoopR player_box parquet per season
  Lines 2007-08..2021-22  SportsbookReviewsOnline NBA odds archive (xlsx), GitHub mirror
                          https://github.com/DillonKoch/Sports_Betting/tree/master/Data/Odds/NBA
  Lines 2022-23..latest   hoopR betting_lines/closing_lines_odds_api.parquet (consensus close)
  Line gap-filler         hoopR betting_lines/games-archive.json (2017-18..2022-23)
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import numpy as np
import pandas as pd

from common import fetch, to_panel

GH = "https://raw.githubusercontent.com"
HOOPR = f"{GH}/sportsdataverse/hoopR-nba-data/main/nba"
URL_538 = f"{GH}/fivethirtyeight/data/master/nba-elo/nbaallelo.csv"
URL_SCHED = f"{HOOPR}/schedules/nba_schedule_master.csv"
URL_TEAMBOX = HOOPR + "/team_box/parquet/team_box_{y}.parquet"
URL_PLAYERBOX = HOOPR + "/player_box/parquet/player_box_{y}.parquet"
URL_ODDSAPI = f"{HOOPR}/betting_lines/closing_lines_odds_api.parquet"
URL_ARCHIVE = f"{HOOPR}/betting_lines/games-archive.json"
URL_SBRO = f"{GH}/DillonKoch/Sports_Betting/master/Data/Odds/NBA/NBA%20odds%20{{s}}.xlsx"

FIRST_ESPN = 2002          # hoopR season = year the season ENDS (2002 = 2001-02)
SBRO_SEASONS = range(2007, 2022)   # season start years 2007-08 .. 2021-22
PLAYER_GAME_FROM = 2024    # per-game player file: 2024-25 onward

# franchise codes = current NBA abbreviations; relocations follow official lineage
FRANCHISE = {
    # FiveThirtyEight / Basketball-Reference codes
    "CHH": "CHA", "NJN": "BKN", "PHO": "PHX", "SEA": "OKC", "VAN": "MEM", "WSB": "WAS",
    # ESPN codes
    "GS": "GSW", "NY": "NYK", "NO": "NOP", "SA": "SAS", "UTAH": "UTA", "WSH": "WAS", "NJ": "BKN",
    "NOK": "NOP", "NOH": "NOP",
}
NBA30 = {"ATL", "BOS", "BKN", "CHA", "CHI", "CLE", "DAL", "DEN", "DET", "GSW", "HOU", "IND", "LAC",
         "LAL", "MEM", "MIA", "MIL", "MIN", "NOP", "NYK", "OKC", "ORL", "PHI", "PHX", "POR", "SAC",
         "SAS", "TOR", "UTA", "WAS"}
# SportsbookReviewsOnline city names (spaces removed, lower-cased)
SBRO_TEAM = {
    "atlanta": "ATL", "boston": "BOS", "brooklyn": "BKN", "newjersey": "BKN", "charlotte": "CHA",
    "chicago": "CHI", "cleveland": "CLE", "dallas": "DAL", "denver": "DEN", "detroit": "DET",
    "goldenstate": "GSW", "houston": "HOU", "indiana": "IND", "laclippers": "LAC", "lalakers": "LAL",
    "memphis": "MEM", "miami": "MIA", "milwaukee": "MIL", "minnesota": "MIN", "neworleans": "NOP",
    "newyork": "NYK", "oklahomacity": "OKC", "seattle": "OKC", "orlando": "ORL",
    "philadelphia": "PHI", "phoenix": "PHX", "portland": "POR", "sacramento": "SAC",
    "sanantonio": "SAS", "toronto": "TOR", "utah": "UTA", "washington": "WAS",
}


def fr(code) -> str:
    code = str(code).strip()
    return FRANCHISE.get(code, code)


def sbro_name(s: str) -> str:
    return f"{s}-{str(s + 1)[-2:]}"


# ---------------------------------------------------------------- download
def download(raw: Path) -> None:
    stub = raw / "fivethirtyeight_nba_elo.csv"   # 14-byte 404 page saved during recon
    if stub.exists() and stub.stat().st_size < 100:
        stub.unlink()
    fetch(URL_538, raw / "fivethirtyeight_nbaallelo.csv")
    fetch(URL_SCHED, raw / "hoopr" / "nba_schedule_master.csv")
    fetch(URL_ODDSAPI, raw / "hoopr" / "betting_lines" / "closing_lines_odds_api.parquet")
    fetch(URL_ARCHIVE, raw / "hoopr" / "betting_lines" / "games-archive.json")
    for s in SBRO_SEASONS:
        fetch(URL_SBRO.format(s=sbro_name(s)), raw / "sbro_odds" / f"nba odds {sbro_name(s)}.xlsx")
    y = FIRST_ESPN
    while True:  # one parquet per ESPN season until the first season not yet published
        try:
            fetch(URL_TEAMBOX.format(y=y), raw / "hoopr" / "team_box" / f"team_box_{y}.parquet")
            fetch(URL_PLAYERBOX.format(y=y), raw / "hoopr" / "player_box" / f"player_box_{y}.parquet")
        except Exception:
            if y <= 2026:
                raise
            break
        y += 1


# ---------------------------------------------------------------- games
def games_538(raw: Path, notes: list) -> pd.DataFrame:
    d = pd.read_csv(raw / "fivethirtyeight_nbaallelo.csv")
    d = d[(d["lg_id"] == "NBA") & d["year_id"].between(1991, FIRST_ESPN - 1) & (d["_iscopy"] == 0)].copy()
    # the _iscopy==0 row is the home side (or first-listed side at neutral sites)
    h = d["game_location"].isin(["H", "N"]).values
    g = pd.DataFrame({
        "game_id": d["game_id"],
        "date": pd.to_datetime(d["date_game"], format="%m/%d/%Y"),
        "season": d["year_id"] - 1,
        "game_type": np.where(d["is_playoffs"] == 1, "playoff", "regular"),
        "home": pd.Series(np.where(h, d["team_id"], d["opp_id"]), index=d.index).map(fr),
        "away": pd.Series(np.where(h, d["opp_id"], d["team_id"]), index=d.index).map(fr),
        "home_score": np.where(h, d["pts"], d["opp_pts"]).astype(int),
        "away_score": np.where(h, d["opp_pts"], d["pts"]).astype(int),
        "neutral": d["game_location"].eq("N"),
        "decided_in": np.nan,
    })
    notes.append(f"1990-91 to 2000-01: {len(g):,} games from FiveThirtyEight ({int(g['neutral'].sum())} at neutral sites "
                 "such as Tokyo/Mexico City). This source has no overtime flag, so decided_in is blank for these seasons.")
    return g


def games_espn(raw: Path, notes: list) -> pd.DataFrame:
    s = pd.read_csv(raw / "hoopr" / "nba_schedule_master.csv", low_memory=False)
    s = s[s["season"] >= FIRST_ESPN]
    n0 = len(s)
    s = s.assign(home=s["home_abbreviation"].map(fr), away=s["away_abbreviation"].map(fr))
    not_nba = ~(s["home"].isin(NBA30) & s["away"].isin(NBA30))  # all-star / rising stars / TBD cup slots
    pre = s["season_type"].isin([1, 4]) | ~s["season_type"].isin([2, 3, 5])
    unplayed = ~s["status_type_completed"].fillna(False).astype(bool) | s["home_score"].isna() | s["away_score"].isna()
    keep = ~not_nba & ~pre & ~unplayed
    notes.append(f"2001-02 onward (ESPN via hoopR): {n0:,} schedule rows; dropped {int(not_nba.sum()):,} all-star/exhibition "
                 f"or TBD rows, {int((pre & ~not_nba).sum()):,} preseason rows, {int((unplayed & ~not_nba & ~pre).sum()):,} "
                 "unplayed or postponed rows (including the unplayed 2026-27 schedule).")
    s = s[keep].copy()
    cup_final = (s["season_type"] == 2) & s["notes_headline"].fillna("").str.contains(
        r"(?:NBA Cup|In-Season Tournament).*Championship", regex=True)
    notes.append(f"{int(cup_final.sum())} NBA Cup / In-Season Tournament championship games are kept as regular-season rows "
                 "(real games between NBA teams, although the league excludes them from standings).")
    per = pd.to_numeric(s["status_period"], errors="coerce")
    g = pd.DataFrame({
        "game_id": s["id"].astype("int64").astype(str),
        "date": pd.to_datetime(s["game_date"]),
        "season": s["season"].astype(int) - 1,
        "game_type": np.where(s["season_type"] == 2, "regular", "playoff"),  # 3 playoffs, 5 play-in
        "home": s["home"], "away": s["away"],
        "home_score": s["home_score"].astype(int), "away_score": s["away_score"].astype(int),
        "neutral": s["neutral_site"].fillna(False).astype(bool),
        "decided_in": np.select([per == 4, per > 4], ["REG", "OT"], default=""),
    })
    g["decided_in"] = g["decided_in"].replace("", np.nan)
    # 2020 restart: every game from 30 Jul to 11 Oct 2020 was played in the Orlando "bubble" (no home crowd/venue)
    bubble = g["date"].between("2020-07-30", "2020-10-11")
    g.loc[bubble, "neutral"] = True
    notes.append(f"The {int(bubble.sum())} games of the 2020 Orlando bubble (30 Jul - 11 Oct 2020) are coded home_away=N "
                 "(neutral site); ESPN keeps a nominal home team but no team played at home.")
    unk = int(g["decided_in"].isna().sum())
    notes.append(f"Play-in games (season_type 5) are coded game_type=playoff. decided_in comes from ESPN's final period "
                 f"(4 = regulation, 5+ = overtime); {unk:,} games have no usable period value (mostly 2001-02) and are blank.")

    # cross-check scores against the team box scores
    tb = []
    for f in sorted((raw / "hoopr" / "team_box").glob("team_box_*.parquet")):
        t = pd.read_parquet(f, columns=["game_id", "team_home_away", "team_score"])
        tb.append(t[t["team_home_away"] == "home"])
    tb = pd.concat(tb).drop_duplicates("game_id")
    tb["game_id"] = tb["game_id"].astype("int64").astype(str)
    m = g.merge(tb, on="game_id", how="left")
    mism = int((m["team_score"].notna() & (m["team_score"] != m["home_score"])).sum())
    notes.append(f"Score cross-check vs ESPN team box scores: {int(m['team_score'].notna().sum()):,} games compared, "
                 f"{mism} home-score mismatches.")
    return g


# ---------------------------------------------------------------- odds
def _num(v):
    """Parse an odds cell: strips stray bytes, 'pk' -> 0, 'NL'/blank -> NaN."""
    if pd.isna(v):
        return np.nan
    t = str(v).strip().lower()
    if t in ("pk", "p", "pick"):
        return 0.0
    t = re.sub(r"[^0-9.+\-]", "", t)
    try:
        return float(t)
    except ValueError:
        return np.nan


def odds_sbro(raw: Path) -> pd.DataFrame:
    out = []
    for s in SBRO_SEASONS:
        x = pd.read_excel(raw / "sbro_odds" / f"nba odds {sbro_name(s)}.xlsx")
        x = x.reset_index(drop=True)
        # year from MMDD: rows are chronological; roll the year when the month goes backwards
        months, year, prev, years = (x["Date"] // 100).tolist(), s, None, []
        for mo in months:
            if prev is not None and mo < prev:
                year += 1
            years.append(year)
            prev = mo
        x["dt"] = pd.to_datetime(dict(year=years, month=x["Date"] // 100, day=x["Date"] % 100))
        x["team"] = x["Team"].astype(str).str.replace(r"[\s.]", "", regex=True).str.lower().map(SBRO_TEAM)
        x["close"] = x["Close"].map(_num)
        x["ml"] = x["ML"].map(_num)
        # pair consecutive rows by rotation number: odd rot = visitor/first team, next rot = home
        rot = pd.to_numeric(x["Rot"], errors="coerce")
        a = x.iloc[:-1].reset_index(drop=True)
        h = x.iloc[1:].reset_index(drop=True)
        ok = (rot.iloc[1:].values == rot.iloc[:-1].values + 1) & (rot.iloc[:-1].values % 2 == 1)
        a, h = a[ok], h[ok]
        ca, ch = a["close"].values, h["close"].values
        both = ~np.isnan(ca) & ~np.isnan(ch)
        big_a = ca > ch
        total = np.where(both, np.maximum(ca, ch), np.nan)
        spread = np.where(both, np.minimum(ca, ch), np.nan)
        valid = both & (total > 100) & (spread < 40)
        # the spread sits on the favourite's row: if it is on the home row, home is favoured
        home_line = np.where(big_a, -spread, spread)   # big_a -> total on visitor row -> spread on home row
        out.append(pd.DataFrame({
            "date": a["dt"].values, "away": a["team"].values, "home": h["team"].values,
            "neutral_listed": (a["VH"].values == "N"),
            "home_line": np.where(valid, home_line, np.nan), "total_line": np.where(valid, total, np.nan),
            "home_ml": h["ml"].values, "away_ml": a["ml"].values, "sbro_season": s,
        }))
    o = pd.concat(out, ignore_index=True)
    o["home_line"] = o["home_line"] + 0.0
    return o


def attach_odds(g: pd.DataFrame, raw: Path, notes: list) -> pd.DataFrame:
    g = g.copy()
    for c in ["home_line", "total_line", "home_ml", "away_ml"]:
        g[c] = np.nan
    g["odds_src"] = ""

    # 1) SBRO, seasons 2007-08..2021-22, joined on date + home + away
    o = odds_sbro(raw)
    o = o.dropna(subset=["home", "away"]).drop_duplicates(["date", "home", "away"], keep=False)
    key = ["date", "home", "away"]
    sb = g["season"].isin(list(SBRO_SEASONS))
    m = g.loc[sb, key].reset_index().merge(o, on=key, how="left").set_index("index")
    # neutral-site listings may have home/away reversed: try the swapped key
    miss = m["home_line"].isna() & m["total_line"].isna() & m["home_ml"].isna()
    sw = o.rename(columns={"home": "away", "away": "home", "home_ml": "away_ml", "away_ml": "home_ml"})
    sw["home_line"] = -sw["home_line"]
    m2 = g.loc[miss[miss].index, key].reset_index().merge(sw, on=key, how="left").set_index("index")
    m.loc[m2.index, ["home_line", "total_line", "home_ml", "away_ml"]] = m2[["home_line", "total_line", "home_ml", "away_ml"]]
    for c in ["home_line", "total_line", "home_ml", "away_ml"]:
        g.loc[m.index, c] = m[c].astype(float)
    g.loc[m.index[m["total_line"].notna() | m["home_ml"].notna()], "odds_src"] = "SBRO"

    # 2) odds-api consensus closing lines (hoopR), 2022-23 onward, keyed on ESPN game_id
    oa = pd.read_parquet(raw / "hoopr" / "betting_lines" / "closing_lines_odds_api.parquet")
    oa["game_id"] = oa["game_id"].astype("int64").astype(str)
    oa = oa.drop_duplicates("game_id").set_index("game_id")
    later = g["season"] >= 2022
    idx = g.index[later & g["game_id"].isin(oa.index)]
    g.loc[idx, "home_line"] = oa.loc[g.loc[idx, "game_id"], "home_point"].astype(float).values
    g.loc[idx, "total_line"] = oa.loc[g.loc[idx, "game_id"], "over_under"].astype(float).values
    g.loc[idx, "odds_src"] = "odds-api"

    # 3) gap-filler: hoopR games-archive.json (2017-18..2022-23) where lines are still missing
    ga = pd.DataFrame(json.load(open(raw / "hoopr" / "betting_lines" / "games-archive.json")))
    ga = pd.DataFrame({"date": pd.to_datetime(ga["game_date"]).dt.normalize(),
                       "home": ga["home_team_abbrev"].map(fr), "away": ga["visit_team_abbrev"].map(fr),
                       "a_line": pd.to_numeric(ga["line"], errors="coerce"),
                       "a_total": pd.to_numeric(ga["game_over_under"], errors="coerce")})
    ga = ga.drop_duplicates(key, keep=False)
    need = g["home_line"].isna() & g["total_line"].isna() & (g["season"] >= 2017)
    m3 = g.loc[need, key].reset_index().merge(ga, on=key, how="inner").set_index("index")
    g.loc[m3.index, "home_line"] = m3["a_line"]
    g.loc[m3.index, "total_line"] = m3["a_total"]
    g.loc[m3.index, "odds_src"] = "games-archive"

    # match-rate table
    has = g["home_line"].notna() | g["total_line"].notna()
    t = g[g["season"] >= 2007].assign(has=has).groupby("season").agg(
        games=("has", "size"), with_line=("has", "sum"),
        sbro=("odds_src", lambda v: (v == "SBRO").sum()), oddsapi=("odds_src", lambda v: (v == "odds-api").sum()),
        archive=("odds_src", lambda v: (v == "games-archive").sum()))
    t["pct"] = (100 * t["with_line"] / t["games"]).round(1)
    print("NBA odds match rate by season (start year):")
    print(t.to_string())
    rates = ", ".join(f"{s}-{str(s + 1)[-2:]} {r.pct}%" for s, r in t.iterrows())
    notes.append("Betting lines: SportsbookReviewsOnline closing spread/total/moneyline for 2007-08 to 2021-22; "
                 "hoopR consensus closing spread/total (The Odds API, ~9 books) for 2022-23 onward, which has no moneylines; "
                 "hoopR games-archive.json fills a few remaining 2017-18 to 2022-23 gaps. No free lines exist before 2007-08, "
                 "so line/total_line/moneyline are blank for 1990-91 to 2006-07.")
    notes.append("Share of games with a line, by season: " + rates + ".")
    notes.append(f"Lines by source (games): SBRO {int((g['odds_src'] == 'SBRO').sum()):,}, "
                 f"odds-api {int((g['odds_src'] == 'odds-api').sum()):,}, games-archive {int((g['odds_src'] == 'games-archive').sum()):,}.")
    return g.drop(columns="odds_src")


# ---------------------------------------------------------------- players
PCOLS = {"minutes": "min", "points": "pts", "rebounds": "reb", "assists": "ast",
         "field_goals_attempted": "fga", "free_throws_attempted": "fta", "turnovers": "tov"}


def players(raw: Path, panel_games: pd.DataFrame, notes: list):
    frames, dnp_total = [], 0
    for f in sorted((raw / "hoopr" / "player_box").glob("player_box_*.parquet")):
        p = pd.read_parquet(f, columns=["game_id", "game_date", "season", "athlete_id", "athlete_display_name",
                                        "athlete_position_abbreviation", "team_abbreviation",
                                        "opponent_team_abbreviation", "starter", "did_not_play", *PCOLS])
        dnp = p["did_not_play"].fillna(False).astype(bool) | p["minutes"].isna()
        p = p[~dnp]
        p = p.assign(dnp=int(dnp.sum()))
        frames.append(p)
    p = pd.concat(frames, ignore_index=True)
    p["game_id"] = p["game_id"].astype("int64").astype(str)
    n_raw = len(p) + 0
    gi = panel_games.set_index("game_id")
    p = p[p["game_id"].isin(gi.index)]  # drops all-star, preseason, exhibition box scores
    dropped_nonpanel = n_raw - len(p)
    p = p.rename(columns=PCOLS)
    p["team"] = p["team_abbreviation"].map(fr)
    p["opponent"] = p["opponent_team_abbreviation"].map(fr)
    home = gi.loc[p["game_id"], "home"].values
    neutral = gi.loc[p["game_id"], "neutral"].values
    p["home_away"] = np.where(neutral, "N", np.where(p["team"].values == home, "H", "A"))
    p["season"] = p["season"].astype(int) - 1
    p["game_type"] = gi.loc[p["game_id"], "game_type"].values
    p["date"] = pd.to_datetime(p["game_date"]).dt.strftime("%Y-%m-%d")
    p["starter"] = p["starter"].fillna(False).astype(int)
    for c in PCOLS.values():
        p[c] = pd.to_numeric(p[c], errors="coerce")
    p = p.rename(columns={"athlete_id": "player_id", "athlete_display_name": "player",
                          "athlete_position_abbreviation": "position"})
    p["player_id"] = p["player_id"].astype("int64")
    stats = list(PCOLS.values())
    games_cols = ["game_id", "date", "season", "game_type", "player_id", "player", "team", "opponent", "home_away",
                  "position", "starter", *stats]
    pg = p[p["season"] >= PLAYER_GAME_FROM][games_cols].sort_values(["date", "game_id", "team", "player"])
    ps = (p.groupby(["season", "game_type", "player_id", "player", "team"], as_index=False)
          .agg(games=("game_id", "nunique"), starts=("starter", "sum"), **{c: (c, "sum") for c in stats}))
    ps["position"] = p.groupby("player_id")["position"].agg(lambda v: v.mode().iat[0] if v.notna().any() else "").reindex(ps["player_id"]).values
    for c in ["min"]:
        ps[c] = ps[c].round(1)
    dnp_total = sum(int(f["dnp"].iat[0]) for f in frames if len(f))
    notes.append(f"Player box scores (ESPN via hoopR) start in 2001-02; no free bulk player-game source was found for "
                 f"1990-91 to 2000-01. Dropped {dnp_total:,} did-not-play rows (no minutes) and {dropped_nonpanel:,} rows "
                 "from games outside the panel (all-star, preseason, exhibitions).")
    notes.append(f"data/nba_players.csv holds per-game lines for {pg['season'].min()}-{str(pg['season'].min() + 1)[-2:]} "
                 f"onward ({len(pg):,} rows); data/nba_player_seasons.csv holds season totals per player, team and "
                 f"game type for 2001-02 onward ({len(ps):,} rows).")
    return pg.reset_index(drop=True), ps.sort_values(["season", "team", "player"]).reset_index(drop=True)


# ---------------------------------------------------------------- clean
def clean(raw: Path) -> dict:
    notes: list[str] = []
    g = pd.concat([games_538(raw, notes), games_espn(raw, notes)], ignore_index=True)
    dup = int(g.duplicated(["date", "home", "away"]).sum())
    assert dup == 0, f"NBA: {dup} duplicate games across sources"
    g = attach_odds(g, raw, notes)
    notes.append("Team codes are current franchise abbreviations; relocated franchises are mapped to today's team: "
                 "Seattle SuperSonics -> OKC, Vancouver Grizzlies -> MEM, New Jersey Nets -> BKN, Washington Bullets -> WAS, "
                 "Charlotte Hornets 1990-2002 and Bobcats 2004-14 -> CHA, New Orleans (and Oklahoma City) Hornets 2002-13 -> NOP "
                 "(the NBA's official franchise lineage).")

    # sanity checks on line signs
    fav = g.dropna(subset=["home_line"])
    fav = fav[fav["home_line"] != 0]
    home_fav = fav["home_line"] < 0
    margin = fav["home_score"] - fav["away_score"]
    fav_margin = np.where(home_fav, margin, -margin)
    fav_line = fav["home_line"].abs()
    fw = (fav_margin > 0).mean()
    cover = fav_margin - fav_line
    fc = (cover > 0).sum() / ((cover != 0).sum())
    mlg = g.dropna(subset=["home_ml", "away_ml"])
    ml_fav_win = np.where(mlg["home_ml"] < mlg["away_ml"], mlg["home_score"] > mlg["away_score"],
                          mlg["away_score"] > mlg["home_score"]).mean()
    print(f"NBA sanity: spread favourites win {fw:.1%}, cover {fc:.1%} (excl. pushes) over {len(fav):,} games; "
          f"moneyline favourites win {ml_fav_win:.1%} over {len(mlg):,} games")
    tot = g.dropna(subset=["total_line"])
    print(f"NBA sanity: mean total line {tot['total_line'].mean():.1f} vs mean actual total "
          f"{(tot['home_score'] + tot['away_score']).mean():.1f}")

    panel = to_panel(g.drop(columns=[]), "nba")
    pg, ps = players(raw, g, notes)
    has_line = g["home_line"].notna()
    has_ml = g["home_ml"].notna()
    lab = lambda s: f"{int(s)}-{str(int(s) + 1)[-2:]}"
    spans = {
        "scores": f"{lab(g['season'].min())}–{lab(g['season'].max())}",
        "spread_total": f"{lab(g.loc[has_line, 'season'].min())}–{lab(g.loc[has_line, 'season'].max())}",
        "moneyline": f"{lab(g.loc[has_ml, 'season'].min())}–{lab(g.loc[has_ml, 'season'].max())}",
        "player_games": f"{lab(pg['season'].min())}–{lab(pg['season'].max())}",
        "player_seasons": f"{lab(ps['season'].min())}–{lab(ps['season'].max())}",
        "decided_in": "2001-02–" + lab(g["season"].max()),
    }
    return {"games": panel, "players": pg, "player_seasons": ps, "notes": notes, "spans": spans}
