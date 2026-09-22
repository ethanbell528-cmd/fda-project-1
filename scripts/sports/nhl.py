"""NHL: games 1990-91 to present, closing odds 2007-08 to 2022-23 (partial),
goalie game logs 1990-91 to present, skater game logs for recent seasons.

Sources
- NHL Stats REST API (public, no key): https://api.nhle.com/stats/rest/en/game ,
  /team , /skater/summary , /goalie/summary
- SportsbookReviewsOnline NHL odds archive (xlsx per season), retrieved through the
  Internet Archive Wayback Machine because the live site no longer serves the files:
  https://web.archive.org/web/2023id_/https://www.sportsbookreviewsonline.com/scoresoddsarchives/nhl/nhl%20odds%202007-08.xlsx
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

from common import fetch, get_json, to_panel

API = "https://api.nhle.com/stats/rest/en/"
FIRST_SEASON_ID = 19901991
SBR_URL = ("https://web.archive.org/web/2023id_/https://www.sportsbookreviewsonline.com/"
           "scoresoddsarchives/nhl/nhl%20odds%20{name}.xlsx")
# local file suffix -> archive file name; the 2020-21 file is named "2021" on the site
SBR_FILES = {f"{y}-{str(y + 1)[-2:]}": f"{y}-{str(y + 1)[-2:]}" for y in range(2007, 2023) if y != 2020}
SBR_FILES["2021"] = "2021"
SBR_START_YEAR = {k: (2021 if k == "2021" else int(k[:4])) for k in SBR_FILES}

# SportsbookReviewsOnline team names -> NHL franchise code in use today
SBR_TEAMS = {
    "Anaheim": "ANA", "Arizona": "ARI", "Phoenix": "ARI", "Atlanta": "WPG", "Boston": "BOS",
    "Buffalo": "BUF", "Calgary": "CGY", "Carolina": "CAR", "Chicago": "CHI", "Colorado": "COL",
    "Columbus": "CBJ", "Dallas": "DAL", "Detroit": "DET", "Edmonton": "EDM", "Florida": "FLA",
    "LosAngeles": "LAK", "Minnesota": "MIN", "Montreal": "MTL", "NYIslanders": "NYI",
    "NYRangers": "NYR", "Nashville": "NSH", "NewJersey": "NJD", "Ottawa": "OTT",
    "Philadelphia": "PHI", "Pittsburgh": "PIT", "SanJose": "SJS", "St.Louis": "STL",
    "TampaBay": "TBL", "Toronto": "TOR", "Vancouver": "VAN", "Washington": "WSH",
    "Winnipeg": "WPG", "Vegas": "VGK", "Seattle": "SEA", "Seattle Kraken": "SEA",
    "Arizonas": "ARI", "LasVegas": "VGK", "Tampa": "TBL", "WinnipegJets": "WPG", "SeattleKraken": "SEA",
}

SORT_GAME = '[{"property":"gameId","direction":"ASC"},{"property":"playerId","direction":"ASC"}]'
SORT_PLAYER = '[{"property":"playerId","direction":"ASC"}]'


# ----------------------------------------------------------------------------- download
def _api_page(raw: Path, rel: str, endpoint: str, params: dict) -> list:
    """Fetch an NHL stats endpoint with limit=-1 (all rows) and cache the JSON."""
    dest = raw / rel
    if dest.exists() and dest.stat().st_size > 0:
        return json.loads(dest.read_text(encoding="utf-8"))
    j = get_json(API + endpoint, params={**params, "start": 0, "limit": -1})
    data = j["data"]
    if len(data) != j.get("total", len(data)):
        raise RuntimeError(f"{endpoint} {params}: got {len(data)} of {j.get('total')} rows")
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(data), encoding="utf-8")
    return data


def _games_df(raw: Path) -> pd.DataFrame:
    return pd.DataFrame(json.loads((raw / "api_games.json").read_text(encoding="utf-8"))["data"])


def _seasons(raw: Path) -> list[int]:
    g = _games_df(raw)
    done = g[(g["season"] >= FIRST_SEASON_ID) & g["gameType"].isin([2, 3]) & (g["gameStateId"] == 7)]
    return sorted(done["season"].unique().tolist())


def download(raw: Path) -> None:
    raw.mkdir(parents=True, exist_ok=True)
    fetch(API + "game", raw / "api_games.json")
    fetch(API + "team", raw / "api_teams.json")
    for suffix, name in SBR_FILES.items():
        fetch(SBR_URL.format(name=name), raw / f"sbr_nhl_odds_{suffix}.xlsx")
    seasons = _seasons(raw)
    for s in seasons:  # goalie game logs, every season (starting-goalie model input)
        _api_page(raw, f"goalie_games/{s}.json", "goalie/summary",
                  {"isAggregate": "false", "isGame": "true", "sort": SORT_GAME,
                   "cayenneExp": f"seasonId={s} and gameTypeId>=2"})
        for kind in ("skater", "goalie"):  # regular-season player-season totals
            _api_page(raw, f"{kind}_seasons/{s}.json", f"{kind}/summary",
                      {"isAggregate": "false", "isGame": "false", "sort": SORT_PLAYER,
                       "cayenneExp": f"seasonId={s} and gameTypeId=2"})
    for s in _recent_seasons(raw):
        for m in _months(s):
            _api_page(raw, f"skater_games/{s}_{m}.json", "skater/summary",
                      {"isAggregate": "false", "isGame": "true", "sort": SORT_GAME,
                       "cayenneExp": (f"seasonId={s} and gameTypeId>=2 and gameDate>=\"{m}-01\" "
                                      f"and gameDate<\"{_next_month(m)}-01\"")})


def current_files(raw: Path) -> list[Path]:
    """Raw files that change as the latest season is played (re-downloaded by the hourly refresh): the game and
    team lists plus every cached stats page of the newest season with a completed game. Seasons are
    read from the NHL's own game list, so a new season is picked up as soon as its first game is final."""
    files = [raw / "api_games.json", raw / "api_teams.json"]
    if not (raw / "api_games.json").exists():
        return files
    s = _seasons(raw)[-1]
    files += [raw / "goalie_games" / f"{s}.json", raw / "skater_seasons" / f"{s}.json",
              raw / "goalie_seasons" / f"{s}.json"]
    files += sorted((raw / "skater_games").glob(f"{s}_*.json"))
    return files


def _recent_seasons(raw: Path) -> list[int]:
    seasons = _seasons(raw)
    last = seasons[-1]
    g = _games_df(raw)
    playoffs_done = ((g["season"] == last) & (g["gameType"] == 3) & (g["gameStateId"] == 7)).any()
    return seasons[-2:] if playoffs_done else seasons[-3:]


def _months(season: int) -> list[str]:
    y = season // 10000
    return [f"{y}-{m:02d}" for m in range(9, 13)] + [f"{y + 1}-{m:02d}" for m in range(1, 10)]


def _next_month(m: str) -> str:
    y, mo = int(m[:4]), int(m[5:])
    return f"{y + 1}-01" if mo == 12 else f"{y}-{mo + 1:02d}"


# ----------------------------------------------------------------------------- clean
def _franchise_codes(raw: Path, games: pd.DataFrame) -> tuple[dict, dict]:
    """team id -> current franchise code, using the NHL's own franchiseId."""
    teams = pd.DataFrame(json.loads((raw / "api_teams.json").read_text(encoding="utf-8"))["data"])
    teams = teams.dropna(subset=["franchiseId"])
    last = pd.concat([games[["homeTeamId", "gameDate"]].rename(columns={"homeTeamId": "id"}),
                      games[["visitingTeamId", "gameDate"]].rename(columns={"visitingTeamId": "id"})])
    last = last.groupby("id")["gameDate"].max().rename("last_game")
    teams = teams.merge(last, left_on="id", right_index=True, how="left")
    current = (teams.sort_values("last_game").groupby("franchiseId").tail(1)
               .set_index("franchiseId")["triCode"])
    teams["code"] = teams["franchiseId"].map(current)
    return dict(zip(teams["id"], teams["code"])), dict(zip(teams["id"], teams["triCode"]))


def _load_odds(raw: Path) -> tuple[pd.DataFrame, list[str]]:
    out, notes = [], []
    for suffix in SBR_FILES:
        f = raw / f"sbr_nhl_odds_{suffix}.xlsx"
        if not f.exists():
            continue
        d = pd.read_excel(f)
        cols = list(d.columns)
        d = d.rename(columns={cols[cols.index("CloseOU") + 1]: "CloseOUPrice"})
        if "PuckLine" not in d:
            d["PuckLine"] = np.nan
        # rows come in pairs (visitor then home, or N/N at neutral sites)
        d = d.reset_index(drop=True)
        v, h = d.iloc[0::2].reset_index(drop=True), d.iloc[1::2].reset_index(drop=True)
        n = min(len(v), len(h))
        v, h = v.iloc[:n], h.iloc[:n]
        # attach a year to MMDD: walk forward, bump the year when the month wraps around
        # (a season whose first game is Jan-Jun, e.g. the 2012-13 lockout, starts a year later)
        year, prev, dates = SBR_START_YEAR[suffix], None, []
        if int(v["Date"].iloc[0]) < 700 and suffix != "2021":
            year += 1
        for mmdd in v["Date"].astype(int):
            if prev is not None and mmdd < prev - 600:
                year += 1
            prev = mmdd
            dates.append(pd.Timestamp(year=year, month=mmdd // 100, day=mmdd % 100))
        o = pd.DataFrame({
            "date": dates,
            "away": v["Team"].str.replace(" ", "").map(SBR_TEAMS),
            "home": h["Team"].str.replace(" ", "").map(SBR_TEAMS),
            "away_name": v["Team"], "home_name": h["Team"],
            "away_ml": pd.to_numeric(v["Close"], errors="coerce"),
            "home_ml": pd.to_numeric(h["Close"], errors="coerce"),
            "home_line": pd.to_numeric(h["PuckLine"], errors="coerce"),
            "total_line": pd.to_numeric(h["CloseOU"], errors="coerce"),
            "sbr_home_final": pd.to_numeric(h["Final"], errors="coerce"),
            "sbr_away_final": pd.to_numeric(v["Final"], errors="coerce"),
            "file": suffix,
        })
        bad = o[o["home"].isna() | o["away"].isna()]
        if len(bad):
            names = sorted(set(bad["home_name"]).union(bad["away_name"]) - set(SBR_TEAMS))
            raise ValueError(f"unmapped SBR team names in {suffix}: {names}")
        out.append(o)
    odds = pd.concat(out, ignore_index=True)
    # a handful of ML cells are placeholders like 0 / NL; treat non-plausible as missing
    for c in ("home_ml", "away_ml"):
        odds.loc[odds[c].abs() < 100, c] = np.nan
    odds.loc[~odds["home_line"].isin([-1.5, 1.5]), "home_line"] = np.nan
    return odds, notes


def clean(raw: Path) -> dict:
    notes: list[str] = []
    allg = _games_df(raw)
    code, tri = _franchise_codes(raw, allg)
    g = allg[allg["season"] >= FIRST_SEASON_ID].copy()
    n_all = len(g)
    other = ~g["gameType"].isin([2, 3])
    unplayed = g["gameType"].isin([2, 3]) & ((g["gameStateId"] != 7) | g["homeScore"].isna() | g["visitingScore"].isna())
    notes.append(f"NHL Stats API lists {n_all:,} games since 1990-91; dropped {int(other.sum()):,} preseason, "
                 f"all-star and other exhibition games and {int(unplayed.sum()):,} regular/playoff games not yet "
                 f"played (the 2026-27 schedule and unneeded 'if necessary' playoff games).")
    g = g[~other & ~unplayed].copy()
    g["season_start"] = g["season"] // 10000
    reg = g["gameType"] == 2
    per = g["period"].fillna(3)
    g["decided_in"] = np.where(per <= 3, "REG",
                               np.where(reg & (per >= 5) & (g["season_start"] >= 2005), "SO", "OT"))
    games = pd.DataFrame({
        "game_id": g["id"].astype(str),
        "date": g["gameDate"],
        "season": g["season_start"],
        "game_type": np.where(reg, "regular", "playoff"),
        "home": g["homeTeamId"].map(code),
        "away": g["visitingTeamId"].map(code),
        "home_tri": g["homeTeamId"].map(tri),
        "away_tri": g["visitingTeamId"].map(tri),
        "home_score": g["homeScore"].astype(int),
        "away_score": g["visitingScore"].astype(int),
        "decided_in": g["decided_in"],
    })
    assert games[["home", "away"]].notna().all().all(), "unmapped NHL team id"

    # ---- odds join (date + home + away franchise codes)
    odds, _ = _load_odds(raw)
    odds["key"] = odds["date"].dt.strftime("%Y-%m-%d") + odds["home"] + odds["away"]
    games["key"] = games["date"] + games["home"] + games["away"]
    # neutral-site rows (N/N) may list teams in either order; add swapped copies for those
    dupkeys = odds["key"].duplicated(keep=False)
    notes_dup = int(dupkeys.sum())
    odds = odds[~dupkeys]
    m = games.merge(odds[["key", "home_ml", "away_ml", "home_line", "total_line",
                          "sbr_home_final", "sbr_away_final", "file"]], on="key", how="left")
    # try swapped orientation for unmatched games (SBR sometimes lists neutral/2020 bubble games reversed)
    miss = m["home_ml"].isna()
    sw = odds.rename(columns={"home_ml": "away_ml", "away_ml": "home_ml",
                              "sbr_home_final": "sbr_away_final", "sbr_away_final": "sbr_home_final"})
    sw["home_line"] = -sw["home_line"]
    sw["key"] = sw["date"].dt.strftime("%Y-%m-%d") + sw["away"] + sw["home"]
    fill = m.loc[miss, ["key"]].reset_index().merge(
        sw[["key", "home_ml", "away_ml", "home_line", "total_line", "sbr_home_final", "sbr_away_final", "file"]],
        on="key", how="inner").set_index("index")
    for c in ["home_ml", "away_ml", "home_line", "total_line", "sbr_home_final", "sbr_away_final", "file"]:
        m.loc[fill.index, c] = fill[c]
    # guard: if SBR final score disagrees with the NHL score by more than the shootout goal, drop odds
    diff = (m["sbr_home_final"] - m["home_score"]).abs() + (m["sbr_away_final"] - m["away_score"]).abs()
    wrong = m["file"].notna() & (diff > 1)
    for c in ["home_ml", "away_ml", "home_line", "total_line"]:
        m.loc[wrong, c] = np.nan
    notes.append(f"Odds: SportsbookReviewsOnline closing moneyline and closing total, 2007-08 to 2021-22 plus "
                 f"the part of 2022-23 the Internet Archive kept; puck line (+/-1.5) from 2014-15. "
                 f"No free odds source was found for later seasons, so line fields are blank there. "
                 f"{notes_dup} odds rows with ambiguous duplicate keys and {int(wrong.sum())} matches whose "
                 f"SBR final score disagreed with the NHL score were left without odds.")
    rate = (m.assign(has=m["home_ml"].notna()).groupby("season")["has"].agg(["sum", "size"]))
    per_file = odds.groupby("file").size()
    rate_lines = []
    for s, r in rate.iterrows():
        if s >= 2007 and s <= 2022:
            rate_lines.append(f"{s}-{str(s + 1)[-2:]}: {int(r['sum'])}/{int(r['size'])}")
    notes.append("Odds match rate by season (games with a closing moneyline / games): " + "; ".join(rate_lines))
    print("  odds rows per file:", per_file.to_dict())
    print("  odds match by season:", "; ".join(rate_lines))

    notes.append("Scores are exactly as the NHL publishes them: a shootout win is recorded as a one-goal win "
                 "(the shootout winner is credited one goal). decided_in = REG, OT, or SO (shootouts began 2005-06). "
                 "Regular-season games tied after overtime (1990-91 to 2003-04) have result T.")
    notes.append("Teams use the NHL's own franchise ids mapped to each franchise's current code: Quebec -> COL, "
                 "Hartford -> CAR, Minnesota North Stars -> DAL, Atlanta Thrashers -> WPG, original Winnipeg Jets "
                 "and Phoenix -> ARI. The NHL treats Utah (UTA, 2024-25 on) as a new franchise, so ARI and UTA are "
                 "separate teams.")

    panel = to_panel(m, "nhl")

    # sanity checks on signs
    lp = panel[panel["line"].notna()]
    fav = lp[lp["line"] < 0]
    mlp = panel[panel["moneyline"].notna()]
    mlfav = mlp[mlp["moneyline"] < 0]
    print(f"  puck-line favorites (-1.5): win {100 * (fav['result'] == 'W').mean():.1f}%, "
          f"cover {100 * (fav['line_result'] == 'cover').mean():.1f}% (n={len(fav)})")
    print(f"  moneyline favorites: win {100 * (mlfav['result'] == 'W').mean():.1f}% (n={len(mlfav)})")
    tl = panel[panel["total_line"].notna() & (panel["home_away"] != "A")]
    print(f"  totals: over {100 * (tl['ou_result'] == 'over').mean():.1f}%, "
          f"under {100 * (tl['ou_result'] == 'under').mean():.1f}%, push {100 * (tl['ou_result'] == 'push').mean():.1f}%")

    # ---- goalie game logs (every season) -> extras
    gid_team = pd.concat([
        games[["game_id", "home_tri", "home"]].rename(columns={"home_tri": "tri", "home": "code"}),
        games[["game_id", "away_tri", "away"]].rename(columns={"away_tri": "tri", "away": "code"})])
    tri_to_code = dict(zip(gid_team["tri"], gid_team["code"]))
    gl = []
    for f in sorted((raw / "goalie_games").glob("*.json")):
        gl.extend(json.loads(f.read_text(encoding="utf-8")))
    gl = pd.DataFrame(gl)
    n_raw = len(gl)
    gl = gl.drop_duplicates(["playerId", "gameId"])
    gl["game_id"] = gl["gameId"].astype(str)
    gl = gl[gl["game_id"].isin(set(games["game_id"]))]
    date_season = games.set_index("game_id")[["date", "season"]]
    decision = np.select([gl["wins"] == 1, gl["losses"] == 1, gl["otLosses"] == 1, gl["ties"] == 1],
                         ["W", "L", "OTL", "T"], default="")
    goalies = pd.DataFrame({
        "game_id": gl["game_id"],
        "date": gl["game_id"].map(date_season["date"]),
        "season": gl["game_id"].map(date_season["season"]),
        "team": gl["teamAbbrev"].map(tri_to_code).fillna(gl["teamAbbrev"]),
        "goalie_id": gl["playerId"],
        "goalie": gl["goalieFullName"],
        "started": gl["gamesStarted"].fillna(0).astype(int),
        "toi": gl["timeOnIce"],
        "shots_against": gl["shotsAgainst"],
        "saves": gl["saves"],
        "goals_against": gl["goalsAgainst"],
        "decision": decision,
    }).sort_values(["date", "game_id", "team", "started"], ascending=[True, True, True, False])
    starts = goalies.groupby("game_id")["started"].sum()
    notes.append(f"Goalie game logs: {len(goalies):,} goalie appearances from the NHL Stats API "
                 f"({n_raw - len(goalies):,} duplicate or non-panel rows removed); "
                 f"{int((starts == 2).sum()):,} of {games['game_id'].nunique():,} games have exactly two "
                 f"recorded starting goalies.")

    # ---- skater game logs, recent seasons
    sk = []
    for f in sorted((raw / "skater_games").glob("*.json")):
        sk.extend(json.loads(f.read_text(encoding="utf-8")))
    sk = pd.DataFrame(sk).drop_duplicates(["playerId", "gameId"])
    sk["game_id"] = sk["gameId"].astype(str)
    sk = sk[sk["game_id"].isin(set(games["game_id"]))]
    players = pd.DataFrame({
        "game_id": sk["game_id"],
        "date": sk["game_id"].map(date_season["date"]),
        "season": sk["game_id"].map(date_season["season"]),
        "player_id": sk["playerId"],
        "player": sk["skaterFullName"],
        "team": sk["teamAbbrev"].map(tri_to_code).fillna(sk["teamAbbrev"]),
        "opponent": sk["opponentTeamAbbrev"].map(tri_to_code).fillna(sk["opponentTeamAbbrev"]),
        "home_away": sk["homeRoad"].map({"H": "H", "R": "A"}),
        "position": sk["positionCode"],
        "toi": pd.to_numeric(sk["timeOnIcePerGame"], errors="coerce").round(0),
        "goals": sk["goals"], "assists": sk["assists"], "points": sk["points"], "shots": sk["shots"],
    }).sort_values(["date", "game_id", "team", "player_id"]).reset_index(drop=True)

    # ---- player seasons (regular season), skaters + goalies
    ps = []
    for kind in ("skater", "goalie"):
        for f in sorted((raw / f"{kind}_seasons").glob("*.json")):
            d = pd.DataFrame(json.loads(f.read_text(encoding="utf-8")))
            if d.empty:
                continue
            d["role"] = kind
            ps.append(d)
    ps = pd.concat(ps, ignore_index=True)
    ps["player"] = ps["skaterFullName"].fillna(ps["goalieFullName"]) if "goalieFullName" in ps else ps["skaterFullName"]
    teams_col = ps["teamAbbrevs"].astype(str)
    player_seasons = pd.DataFrame({
        "season": ps["seasonId"] // 10000,
        "player_id": ps["playerId"],
        "player": ps["player"],
        "role": ps["role"],
        "position": ps.get("positionCode"),
        "teams": teams_col.map(lambda t: ",".join(tri_to_code.get(x, x) for x in t.split(","))),
        "games": ps["gamesPlayed"],
        "goals": ps["goals"],
        "assists": ps["assists"],
        "points": ps["points"],
        "shots": ps.get("shots"),
        "games_started": ps.get("gamesStarted"),
        "shots_against": ps.get("shotsAgainst"),
        "saves": ps.get("saves"),
        "save_pct": pd.to_numeric(ps.get("savePct"), errors="coerce").round(4),
    })
    player_seasons.loc[player_seasons["role"] == "goalie", "position"] = "G"
    player_seasons = player_seasons.sort_values(["season", "role", "player_id"]).reset_index(drop=True)

    first = int(panel["season"].min()); last = int(panel["season"].max())
    pl_lo, pl_hi = int(players["season"].min()), int(players["season"].max())
    ps_lo, ps_hi = int(player_seasons["season"].min()), int(player_seasons["season"].max())
    lab = lambda s: f"{s}-{str(s + 1)[-2:]}"
    has_ml = panel.loc[panel["moneyline"].notna(), "season"]
    has_pl = panel.loc[panel["line"].notna(), "season"]
    spans = {
        "scores": f"{lab(first)} to {lab(last)}",
        "moneyline": f"{lab(int(has_ml.min()))} to {lab(int(has_ml.max()))}",
        "total_line": f"{lab(int(has_ml.min()))} to {lab(int(has_ml.max()))}",
        "puck_line": f"{lab(int(has_pl.min()))} to {lab(int(has_pl.max()))}",
        "goalie_games": f"{lab(int(goalies['season'].min()))} to {lab(int(goalies['season'].max()))}",
        "player_games": f"{lab(pl_lo)} to {lab(pl_hi)}",
        "player_seasons": f"{lab(ps_lo)} to {lab(ps_hi)} (regular season)",
    }
    notes.append(f"Player files: per-game skater lines for {lab(pl_lo)} to {lab(pl_hi)} (feeds projections); "
                 f"regular-season player totals for {lab(ps_lo)} to {lab(ps_hi)}. Goalie save % = saves / shots against.")
    return {"games": panel, "players": players, "player_seasons": player_seasons,
            "extras": {"goalie_starts": goalies.reset_index(drop=True)},
            "notes": notes, "spans": spans}
