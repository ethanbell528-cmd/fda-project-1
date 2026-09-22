"""Helpers shared by every sport module: HTTP download with caching, odds math,
and turning one-row-per-game frames into the two-rows-per-game panel."""
from __future__ import annotations

import os
import time
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
import requests

from config import PANEL_COLUMNS, SPORTS, season_label

UA = {"User-Agent": "fda-project-1 data pipeline (educational)"}


def fetch(url: str, dest: Path, force: bool = False, retries: int = 3, **kw) -> Path:
    """GET url into dest unless it already exists. Raises on HTTP errors."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 0 and not force:
        return dest
    for i in range(retries):
        try:
            r = requests.get(url, headers=UA, timeout=180, **kw)
            r.raise_for_status()
            dest.write_bytes(r.content)
            return dest
        except requests.RequestException as e:
            not_found = isinstance(e, requests.HTTPError) and e.response is not None and e.response.status_code == 404
            if i == retries - 1 or not_found:  # a 404 won't fix itself on retry
                raise
            time.sleep(2 * (i + 1))
    return dest


def today() -> date:
    """Today's date; set FDA_TODAY=YYYY-MM-DD to simulate another day (testing only)."""
    v = os.environ.get("FDA_TODAY")
    return date.fromisoformat(v) if v else date.today()


def season_start_year(first_month: int) -> int:
    """Start year of the season in progress (or most recently started) for a league whose
    season opens in `first_month`: e.g. NBA/NHL 10, EPL 8, NFL 9, MLB 3."""
    t = today()
    return t.year if t.month >= first_month else t.year - 1


def fetch_optional(url: str, dest: Path, **kw):
    """fetch() that returns None (with a printed note) when the file isn't published yet
    (HTTP 404, e.g. a season that hasn't started). Other errors still raise."""
    try:
        return fetch(url, dest, **kw)
    except requests.HTTPError as e:
        if e.response is not None and e.response.status_code == 404:
            print(f"  not published yet (404), skipped: {url}")
            return None
        raise


def get_json(url: str, retries: int = 3, **kw):
    for i in range(retries):
        try:
            r = requests.get(url, headers=UA, timeout=60, **kw)
            r.raise_for_status()
            return r.json()
        except requests.RequestException:
            if i == retries - 1:
                raise
            time.sleep(2 * (i + 1))


def american_to_prob(ml):
    """Raw implied probability from American odds (vig included)."""
    ml = pd.to_numeric(pd.Series(ml), errors="coerce")
    return pd.Series(np.where(ml < 0, -ml / (-ml + 100), 100 / (ml + 100)), index=ml.index)


def to_panel(games: pd.DataFrame, sport: str) -> pd.DataFrame:
    """Expand one-row-per-game into two team rows.

    `games` needs: game_id, date, season, game_type, home, away, home_score,
    away_score. Optional: neutral (bool), decided_in, home_line (home handicap,
    negative = home favored), total_line, home_ml, away_ml (American),
    odds_h, odds_d, odds_a (EPL decimal 1X2).
    """
    g = games.reset_index(drop=True).copy()
    for c in ["decided_in", "home_line", "total_line", "home_ml", "away_ml", "odds_h", "odds_d", "odds_a"]:
        if c not in g:
            g[c] = np.nan
    if "neutral" not in g:
        g["neutral"] = False
    g["neutral"] = g["neutral"].fillna(False).astype(bool)

    if sport == "epl":
        inv = 1 / g[["odds_h", "odds_d", "odds_a"]].apply(pd.to_numeric, errors="coerce")
        s = inv.sum(axis=1, min_count=3)
        g["imp_h"], g["imp_a"] = inv["odds_h"] / s, inv["odds_a"] / s
    else:
        ph, pa = american_to_prob(g["home_ml"]), american_to_prob(g["away_ml"])
        s = ph + pa
        g["imp_h"], g["imp_a"] = ph / s, pa / s

    style = SPORTS[sport]["season_style"]
    parts = []
    for side in ("home", "away"):
        opp = "away" if side == "home" else "home"
        sgn = 1 if side == "home" else -1
        parts.append(pd.DataFrame({
            "game_id": g["game_id"].astype(str),
            "date": pd.to_datetime(g["date"]).dt.strftime("%Y-%m-%d"),
            "season": g["season"].astype(int),
            "sport": sport,
            "game_type": g["game_type"],
            "team": g[side],
            "opponent": g[opp],
            "home_away": np.where(g["neutral"], "N", "H" if side == "home" else "A"),
            "score_for": g[f"{side}_score"].astype(int),
            "score_against": g[f"{opp}_score"].astype(int),
            "decided_in": g["decided_in"],
            "line": sgn * pd.to_numeric(g["home_line"], errors="coerce"),
            "total_line": pd.to_numeric(g["total_line"], errors="coerce"),
            "moneyline": pd.to_numeric(g[f"{side}_ml"], errors="coerce"),
            "odds_win": pd.to_numeric(g["odds_h" if side == "home" else "odds_a"], errors="coerce"),
            "odds_draw": pd.to_numeric(g["odds_d"], errors="coerce"),
            "implied_win": g["imp_h" if side == "home" else "imp_a"],
            "_opp_implied": g["imp_a" if side == "home" else "imp_h"],
        }))
    p = pd.concat(parts, ignore_index=True)
    p["line"] = p["line"] + 0.0  # normalise -0.0
    p["season_label"] = p["season"].map(lambda s: season_label(int(s), style))
    p["margin"] = p["score_for"] - p["score_against"]
    p["total"] = p["score_for"] + p["score_against"]
    p["result"] = np.select([p["margin"] > 0, p["margin"] < 0], ["W", "L"],
                            default="D" if sport == "epl" else "T")
    adj = p["margin"] + p["line"]
    p["line_result"] = np.select([p["line"].isna(), adj > 0, adj < 0], ["", "cover", "miss"], default="push")
    ou = p["total"] - p["total_line"]
    p["ou_result"] = np.select([p["total_line"].isna(), ou > 0, ou < 0], ["", "over", "under"], default="push")
    fav = np.where(p["line"] < 0, 1.0, np.where(p["line"] > 0, 0.0, np.nan))
    by_imp = np.where(p["implied_win"] > p["_opp_implied"], 1.0,
                      np.where(p["implied_win"] < p["_opp_implied"], 0.0, np.nan))
    p["favorite"] = np.where(np.isnan(fav), by_imp, fav)
    p["implied_win"] = p["implied_win"].round(4)
    p = p[PANEL_COLUMNS].sort_values(["date", "game_id", "home_away"], kind="stable")
    return p.reset_index(drop=True)


def check_panel(p: pd.DataFrame, sport: str) -> dict:
    """Integrity checks; raises AssertionError with a clear message on failure."""
    assert list(p.columns) == PANEL_COLUMNS, f"{sport}: column order mismatch"
    counts = p.groupby("game_id").size()
    assert (counts == 2).all(), f"{sport}: games without exactly 2 rows: {counts[counts != 2].index[:5].tolist()}"
    assert p["score_for"].notna().all(), f"{sport}: null scores"
    dup = int(p.duplicated(["game_id", "team"]).sum())
    assert dup == 0, f"{sport}: {dup} duplicate team-game rows"
    return {
        "sport": sport,
        "rows": len(p),
        "columns": p.shape[1],
        "games": int(p["game_id"].nunique()),
        "first_season": int(p["season"].min()),
        "last_season": int(p["season"].max()),
        "seasons": int(p["season"].nunique()),
        "teams": int(p["team"].nunique()),
        "rows_with_line": int(p["line"].notna().sum()),
        "rows_with_total_line": int(p["total_line"].notna().sum()),
    }
