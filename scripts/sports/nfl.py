"""NFL: games 1990-present, spreads/totals 1990-present, moneylines 2006+,
player-game stats 1999+ (QB/RB/WR/TE).

Sources
- 1990-1998 games + lines: Kaggle "NFL scores and betting data" (spreadspoke_scores.csv,
  tobycrabtree) via a public GitHub mirror:
  https://raw.githubusercontent.com/RussellHerzog/nfl_game_outcomes/master/spreadspoke_scores.csv
- 1999+ games + lines: nflverse schedules (CC-BY-4.0)
  https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv
- Player-week stats 1999+: nflverse stats_player (CC-BY-4.0)
  https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_{YYYY}.csv
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

from common import fetch, fetch_optional, season_start_year, to_panel

GAMES_URL = "https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv"
SPREADSPOKE_URL = ("https://raw.githubusercontent.com/RussellHerzog/nfl_game_outcomes/"
                   "master/spreadspoke_scores.csv")
PLAYER_URL = ("https://github.com/nflverse/nflverse-data/releases/download/"
              "stats_player/stats_player_week_{y}.csv")

FIRST_SEASON = 1990
SPREADSPOKE_LAST = 1998          # nflverse takes over from 1999
PLAYER_FIRST = 1999
RECENT_PLAYER_SEASONS = 3        # per-game file keeps the last 3 seasons (2 completed + current)

# spreadspoke full names -> current nflverse franchise abbreviations
NAME_TO_CODE = {
    "Arizona Cardinals": "ARI", "Phoenix Cardinals": "ARI",
    "Atlanta Falcons": "ATL", "Baltimore Ravens": "BAL", "Buffalo Bills": "BUF",
    "Carolina Panthers": "CAR", "Chicago Bears": "CHI", "Cincinnati Bengals": "CIN",
    "Cleveland Browns": "CLE", "Dallas Cowboys": "DAL", "Denver Broncos": "DEN",
    "Detroit Lions": "DET", "Green Bay Packers": "GB",
    "Houston Oilers": "TEN", "Tennessee Oilers": "TEN", "Tennessee Titans": "TEN",
    "Indianapolis Colts": "IND", "Jacksonville Jaguars": "JAX", "Kansas City Chiefs": "KC",
    "Los Angeles Raiders": "LV", "Oakland Raiders": "LV", "Las Vegas Raiders": "LV",
    "Los Angeles Rams": "LA", "St. Louis Rams": "LA",
    "Miami Dolphins": "MIA", "Minnesota Vikings": "MIN", "New England Patriots": "NE",
    "New Orleans Saints": "NO", "New York Giants": "NYG", "New York Jets": "NYJ",
    "Philadelphia Eagles": "PHI", "Pittsburgh Steelers": "PIT",
    "San Diego Chargers": "LAC", "Los Angeles Chargers": "LAC",
    "San Francisco 49ers": "SF", "Seattle Seahawks": "SEA", "Tampa Bay Buccaneers": "TB",
    "Washington Redskins": "WAS", "Washington Football Team": "WAS", "Washington Commanders": "WAS",
    "Houston Texans": "HOU",
}
# spreadspoke team_favorite_id codes -> panel codes
FAV_ID_FIX = {"LAR": "LA"}
# nflverse historical abbreviations -> current franchise
NFLVERSE_FIX = {"OAK": "LV", "SD": "LAC", "STL": "LA"}


def current_season() -> int:
    """NFL season in progress or most recently started (regular season opens in September)."""
    return season_start_year(9)


def download(raw_dir: Path) -> None:
    fetch(GAMES_URL, raw_dir / "nflverse_games.csv")
    fetch(SPREADSPOKE_URL, raw_dir / "spreadspoke_RussellHerzog_nfl_game_outcomes.csv")
    for y in range(PLAYER_FIRST, current_season() + 1):
        dest = raw_dir / "stats_player_week" / f"stats_player_week_{y}.csv"
        if y < current_season():
            fetch(PLAYER_URL.format(y=y), dest)
        else:  # the newest season's file appears once week 1 is played
            fetch_optional(PLAYER_URL.format(y=y), dest)


def current_files(raw_dir: Path) -> list[Path]:
    """Raw files that change while the current season is played (re-downloaded by the hourly refresh)."""
    y = current_season()
    return [raw_dir / "nflverse_games.csv",
            raw_dir / "stats_player_week" / f"stats_player_week_{y}.csv"]


def _spreadspoke(raw_dir: Path, notes: list) -> pd.DataFrame:
    s = pd.read_csv(raw_dir / "spreadspoke_RussellHerzog_nfl_game_outcomes.csv")
    s = s[s["schedule_season"].between(FIRST_SEASON, SPREADSPOKE_LAST)].copy()
    n0 = len(s)
    s = s.dropna(subset=["score_home", "score_away"])
    if n0 - len(s):
        notes.append(f"Dropped {n0 - len(s)} 1990-1998 spreadspoke rows without final scores.")
    unknown = set(s["team_home"]).union(s["team_away"]) - set(NAME_TO_CODE)
    assert not unknown, f"unmapped spreadspoke team names: {unknown}"
    home = s["team_home"].map(NAME_TO_CODE)
    away = s["team_away"].map(NAME_TO_CODE)
    fav = s["team_favorite_id"].replace(FAV_ID_FIX)
    spread = pd.to_numeric(s["spread_favorite"], errors="coerce")  # negative number, favorite-relative
    # home handicap: negative when home favored. PICK -> 0.
    home_line = np.where(fav == "PICK", 0.0,
                         np.where(fav == home, spread,
                                  np.where(fav == away, -spread, np.nan)))
    bad_fav = fav.notna() & (fav != "PICK") & (fav != home) & (fav != away)
    assert not bad_fav.any(), f"favorite id not matching either team: {s.loc[bad_fav, ['team_home', 'team_away', 'team_favorite_id']].head()}"
    week = s["schedule_week"].astype(str)
    date = pd.to_datetime(s["schedule_date"], format="%m/%d/%Y")
    g = pd.DataFrame({
        # nflverse-style id so the two sources look alike: season_week_away_home
        "game_id": (s["schedule_season"].astype(str) + "_"
                    + week.str.replace("Wildcard", "WC").str.replace("Division", "DIV")
                    .str.replace("Conference", "CON").str.replace("Superbowl", "SB").str.zfill(2)
                    + "_" + away + "_" + home),
        "date": date,
        "season": s["schedule_season"].astype(int),
        "game_type": np.where(s["schedule_playoff"].astype(bool), "playoff", "regular"),
        "home": home, "away": away,
        "home_score": s["score_home"].astype(int), "away_score": s["score_away"].astype(int),
        "neutral": s["stadium_neutral"].astype(bool),
        "decided_in": np.nan,
        "home_line": home_line,
        "total_line": pd.to_numeric(s["over_under_line"], errors="coerce"),
    })
    return g


def _nflverse(raw_dir: Path, notes: list) -> pd.DataFrame:
    n = pd.read_csv(raw_dir / "nflverse_games.csv")
    n = n[n["season"] > SPREADSPOKE_LAST]
    unplayed = n["home_score"].isna() | n["away_score"].isna()
    unplayed_yrs = "/".join(str(int(y)) for y in sorted(n.loc[unplayed, "season"].unique()))
    notes.append(f"Excluded {int(unplayed.sum())} scheduled {unplayed_yrs} nflverse games that have not been played yet "
                 f"(no final score as of the download).")
    n = n[~unplayed].copy()
    # Sign check: nflverse spread_line > 0 means the HOME team is favored (home moneyline negative).
    chk = n.dropna(subset=["spread_line", "home_moneyline"])
    chk = chk[chk["spread_line"] != 0]
    agree = ((chk["spread_line"] > 0) == (chk["home_moneyline"] < 0)).mean()
    print(f"  nflverse sign check: spread_line>0 <=> home ML<0 in {agree:.1%} of {len(chk):,} games")
    assert agree > 0.97, "nflverse spread_line sign convention not as expected"
    notes.append(f"Sign check: in {agree:.1%} of {len(chk):,} nflverse games with both a non-zero spread and a "
                 "moneyline, the spread favorite is also the moneyline favorite; the rest are near pick'em games "
                 "where the two quotes disagree. Both values are kept as published.")
    home = n["home_team"].replace(NFLVERSE_FIX)
    away = n["away_team"].replace(NFLVERSE_FIX)
    g = pd.DataFrame({
        "game_id": n["game_id"],
        "date": pd.to_datetime(n["gameday"]),
        "season": n["season"].astype(int),
        "game_type": np.where(n["game_type"] == "REG", "regular", "playoff"),
        "home": home, "away": away,
        "home_score": n["home_score"].astype(int), "away_score": n["away_score"].astype(int),
        "neutral": n["location"].eq("Neutral"),
        "decided_in": np.where(n["overtime"] == 1, "OT", "REG"),
        "home_line": -n["spread_line"],
        "total_line": n["total_line"],
        "home_ml": n["home_moneyline"],
        "away_ml": n["away_moneyline"],
    })
    return g


def _players(raw_dir: Path, games: pd.DataFrame, notes: list):
    keep = {
        "attempts": "pass_att", "completions": "completions", "passing_yards": "pass_yds",
        "passing_tds": "pass_td", "passing_interceptions": "int", "carries": "carries",
        "rushing_yards": "rush_yds", "rushing_tds": "rush_td", "targets": "targets",
        "receptions": "rec", "receiving_yards": "rec_yds", "receiving_tds": "rec_td",
    }
    frames = []
    files = sorted((raw_dir / "stats_player_week").glob("stats_player_week_*.csv"))
    for f in files:
        if int(f.stem.rsplit("_", 1)[1]) < PLAYER_FIRST:
            continue
        d = pd.read_csv(f, low_memory=False,
                        usecols=["player_id", "player_display_name", "position", "season", "week",
                                 "season_type", "game_id", "team", "opponent_team", *keep])
        frames.append(d[d["position"].isin(["QB", "RB", "WR", "TE"])])
    p = pd.concat(frames, ignore_index=True).rename(columns=keep)
    p = p.rename(columns={"player_display_name": "player", "opponent_team": "opponent"})
    p["team"] = p["team"].replace(NFLVERSE_FIX)
    p["opponent"] = p["opponent"].replace(NFLVERSE_FIX)
    p["game_type"] = np.where(p["season_type"] == "REG", "regular", "playoff")
    stat_cols = list(keep.values())
    p[stat_cols] = p[stat_cols].fillna(0).astype(int)

    # attach date + home/away from the panel games
    gi = games[["game_id", "date", "home", "neutral"]].copy()
    gi["date"] = pd.to_datetime(gi["date"]).dt.strftime("%Y-%m-%d")
    p = p.merge(gi, on="game_id", how="left")
    unmatched = int(p["date"].isna().sum())
    notes.append(f"Player-game rows whose game_id is not in the games panel: {unmatched} "
                 f"(of {len(p):,}); kept with blank date/home_away.")
    p["home_away"] = np.where(p["neutral"].fillna(False).astype(bool), "N",
                              np.where(p["home"] == p["team"], "H",
                                       np.where(p["home"].isna(), "", "A")))

    cols = ["game_id", "date", "season", "week", "game_type", "player_id", "player", "position",
            "team", "opponent", "home_away", *stat_cols]
    last = int(p["season"].max())
    recent = p[p["season"] > last - RECENT_PLAYER_SEASONS][cols].sort_values(["date", "game_id", "team", "player"])

    seasons = (p.groupby(["season", "game_type", "player_id", "player", "position", "team"], as_index=False)
                 .agg(games=("game_id", "nunique"), **{c: (c, "sum") for c in stat_cols}))
    seasons = seasons.sort_values(["season", "team", "player"]).reset_index(drop=True)
    return recent.reset_index(drop=True), seasons, (int(p["season"].min()), last,
                                                   int(recent["season"].min()))


def clean(raw_dir: Path) -> dict:
    notes: list[str] = []
    old = _spreadspoke(raw_dir, notes)
    new = _nflverse(raw_dir, notes)
    games = pd.concat([old, new], ignore_index=True).sort_values(["date", "game_id"])
    assert games["game_id"].is_unique

    panel = to_panel(games, "nfl")

    # --- sanity checks --------------------------------------------------
    per = games.groupby("season").size()
    print("  games per season:", per.to_dict())
    fav = panel[panel["line"] < 0]
    print(f"  favorites (line<0): win {(fav['result'] == 'W').mean():.1%}, "
          f"cover {(fav['line_result'] == 'cover').mean():.1%}, push {(fav['line_result'] == 'push').mean():.1%} "
          f"of {len(fav):,} team-games")
    mlfav = panel[panel["moneyline"] < 0]
    print(f"  moneyline favorites: win {(mlfav['result'] == 'W').mean():.1%} of {len(mlfav):,}")
    agree = ((panel["line"] < 0) == (panel["moneyline"] < 0))[panel["moneyline"].notna() & (panel["line"] != 0)].mean()
    print(f"  line sign agrees with moneyline sign: {agree:.1%}")

    line_seasons = panel.loc[panel["line"].notna(), "season"]
    ml_seasons = panel.loc[panel["moneyline"].notna(), "season"]
    tot_seasons = panel.loc[panel["total_line"].notna(), "season"]
    ml_cov = panel[panel["season"] >= 2006].groupby("season")["moneyline"].apply(lambda x: x.notna().mean())
    line_cov = panel.groupby("season")["line"].apply(lambda x: x.notna().mean())
    print("  line coverage by season:", line_cov.round(3).to_dict())
    print("  moneyline coverage 2006+:", ml_cov.round(3).to_dict())

    players, player_seasons, (p_first, p_last, p_recent) = _players(raw_dir, games, notes)

    notes += [
        f"Games 1990-{SPREADSPOKE_LAST} come from the spreadspoke (Kaggle) archive; games 1999-{int(games['season'].max())} "
        "come from nflverse. Both include regular season and playoffs.",
        "Point spreads and totals: spreadspoke 1990-1998 (stored favorite-relative, converted to the home team's "
        "handicap), nflverse 1999+ (spread_line is home-favored-positive; the panel stores the negative so "
        "a favored team has a negative line). These are the sources' pre-game reference lines, not verified closing lines.",
        f"Line coverage: {panel['line'].notna().mean():.1%} of team-games have a spread, "
        f"{panel['total_line'].notna().mean():.1%} have a total.",
        f"Moneylines only exist in nflverse from {int(ml_seasons.min())}; seasons before that have a blank moneyline "
        f"and blank implied_win. Moneyline coverage {int(ml_seasons.min())}+: "
        f"{panel.loc[panel['season'] >= ml_seasons.min(), 'moneyline'].notna().mean():.1%} of team-games.",
        "Franchise codes follow the current franchise: Houston/Tennessee Oilers -> TEN, "
        "Los Angeles/Oakland Raiders -> LV, Los Angeles/St. Louis Rams -> LA, San Diego Chargers -> LAC, "
        "Phoenix Cardinals -> ARI, Washington (all names) -> WAS. The 1990-1995 Cleveland Browns are CLE "
        "(the NFL assigns that history to Cleveland); the Baltimore Ravens (BAL) start in 1996.",
        "decided_in (OT vs REG) is only known for 1999+ (nflverse overtime flag); it is blank for 1990-1998.",
        "Neutral-site games (Super Bowls, international games) have home_away = N for both teams.",
        f"Player-game stats start in {p_first} (nflverse); there is no free per-game player data for 1990-1998. "
        f"Only QB/RB/WR/TE rows are kept. data/nfl_players.csv holds per-game rows for {p_recent}-{p_last}; "
        f"data/nfl_player_seasons.csv holds season totals for {p_first}-{p_last} (one row per player, season, team and game type, so regular season and playoffs are separate).",
    ]
    spans = {
        "scores": f"{int(games['season'].min())}–{int(games['season'].max())}",
        "spread": f"{int(line_seasons.min())}–{int(line_seasons.max())}",
        "total_line": f"{int(tot_seasons.min())}–{int(tot_seasons.max())}",
        "moneyline": f"{int(ml_seasons.min())}–{int(ml_seasons.max())}",
        "overtime_flag": f"1999–{int(games['season'].max())}",
        "player_games": f"{p_recent}–{p_last}",
        "player_seasons": f"{p_first}–{p_last}",
    }
    return {"games": panel, "players": players, "player_seasons": player_seasons,
            "notes": notes, "spans": spans}
