"""Step 4 of the pipeline: precompute every number the report page shows.

Reads data/<sport>.csv, data/<sport>_player_seasons.csv, data/coverage.json and,
when present, backtest_<sport>.json / model_<sport>.json, and writes small JSON
files to data/report/. index.html never loads raw CSVs; every number in the
report text and charts comes from these files.

Metric definitions (identical to the dashboard):
  win %        = rows with result W / all rows (ties and draws count as non-wins)
  cover %      = cover / (cover + miss), pushes and blank lines excluded
  over %       = over / (over + under), pushes excluded
  favorite     = rows with favorite == 1
  home win %   = win % over rows with home_away == H (neutral-site games excluded)
  avg total    = mean of `total` (both teams' combined score)

Usage:  python scripts/build_report_data.py
"""
from __future__ import annotations

import json
import math

import numpy as np
import pandas as pd

from config import DATA, ROOT, SPORTS, season_label

OUT = DATA / "report"
ORDER = list(SPORTS)


def r(x, d=6):
    """Round for storage. Always keep >= 6 decimals: the page rounds for display, and
    rounding twice (e.g. 0.407481 -> 0.4075 -> 40.8%) would show a wrong last digit."""
    if x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))):
        return None
    return round(float(x), max(d, 6))


def win_pct(df):
    return r((df["result"] == "W").mean()) if len(df) else None


def cover_pct(df):
    c = (df["line_result"] == "cover").sum()
    m = (df["line_result"] == "miss").sum()
    return (r(c / (c + m)) if c + m else None), int(c + m)


def over_pct(df):
    o = (df["ou_result"] == "over").sum()
    u = (df["ou_result"] == "under").sum()
    return (r(o / (o + u)) if o + u else None), int(o + u)


def load(sport):
    path = DATA / f"{sport}.csv"
    if not path.exists():
        print(f"WARNING: {path.name} missing - {sport.upper()} skipped (re-run once it exists)")
        return None
    df = pd.read_csv(path, dtype={"game_id": str, "line_result": str, "ou_result": str, "decided_in": str},
                     keep_default_na=True, low_memory=False)
    for c in ("line_result", "ou_result", "decided_in"):
        df[c] = df[c].fillna("")
    df["date"] = pd.to_datetime(df["date"])
    return df


def full_seasons(df):
    """Drop the latest season if it is still early (fewer than half the median games per season).

    Only the most recent season can be 'in progress'; shortened past seasons (lockouts,
    MLB's 60-game 2020) are complete and are kept."""
    n = df.groupby("season")["game_id"].nunique()
    last = n.index.max()
    partial = [int(last)] if n[last] < 0.5 * n.median() else []
    return df[~df["season"].isin(partial)], partial


def label(sport, season):
    return season_label(int(season), SPORTS[sport]["season_style"])


def write(name, obj):
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"{name}.json").write_text(json.dumps(obj, indent=1, ensure_ascii=False), encoding="utf-8")


# --------------------------------------------------------------------------- sections

def favorites(frames):
    """F1: how often the betting favorite wins and covers, by sport."""
    rows = []
    for s, df in frames.items():
        fav = df[df["favorite"] == 1]
        dog = df[df["favorite"] == 0]
        cov, n_cov = cover_pct(fav)
        dcov, _ = cover_pct(dog)
        push = (fav["line_result"] == "push").sum()
        n_line = (fav["line_result"] != "").sum()
        seasons = fav["season"]
        rows.append({
            "sport": s,
            "fav_rows": int(len(fav)),
            "fav_win": win_pct(fav),
            "fav_draw": r((fav["result"] == "D").mean()) if s == "epl" else None,
            "fav_cover": cov, "fav_cover_n": n_cov,
            "dog_cover": dcov,
            "push_rate": r(push / n_line) if n_line else None,
            "first": label(s, seasons.min()), "last": label(s, seasons.max()),
            "line_name": {"nfl": "point spread", "nba": "point spread", "mlb": "run line (±1.5)",
                          "nhl": "puck line (±1.5)", "epl": "Asian handicap"}[s],
        })
    return {"rows": rows}


def home_edge(frames):
    """F2: home win % by season for each sport (neutral sites excluded)."""
    series, overall = {}, []
    for s, df in frames.items():
        df, partial = full_seasons(df)
        h = df[df["home_away"] == "H"]
        by = h.groupby("season").agg(games=("result", "size"), wins=("result", lambda x: (x == "W").sum()))
        by["pct"] = by["wins"] / by["games"]
        series[s] = [{"season": int(k), "label": label(s, k), "pct": r(v.pct), "games": int(v.games)}
                     for k, v in by.iterrows()]
        first10 = by[by.index < by.index.min() + 10]
        last10 = by[by.index > by.index.max() - 10]
        early = first10["wins"].sum() / first10["games"].sum()
        late = last10["wins"].sum() / last10["games"].sum()
        # empty / limited-crowd season: 2020 start year (2020-21 NBA/NHL/EPL, 2020 NFL/MLB)
        c = by.loc[2020] if 2020 in by.index else None
        tie_early = h[h["season"].isin(first10.index)]["result"].eq("T").mean()
        tie_late = h[h["season"].isin(last10.index)]["result"].eq("T").mean()
        overall.append({
            "sport": s, "home_win": win_pct(h), "games": int(len(h)),
            "partial_excluded": [label(s, x) for x in partial],
            "tie_early": r(tie_early) if s != "epl" else None, "tie_late": r(tie_late) if s != "epl" else None,
            "draw": r((h["result"] == "D").mean()) if s == "epl" else None,
            "early_label": f"{label(s, first10.index.min())} to {label(s, first10.index.max())}",
            "early": r(early),
            "late_label": f"{label(s, last10.index.min())} to {label(s, last10.index.max())}",
            "late": r(late),
            "covid_label": label(s, 2020) if c is not None else None,
            "covid": r(c["pct"]) if c is not None else None,
            "max_season": label(s, by["pct"].idxmax()), "max": r(by["pct"].max()),
            "min_season": label(s, by["pct"].idxmin()), "min": r(by["pct"].min()),
        })
    return {"series": series, "overall": overall}


def scoring(frames):
    """F3: average combined score per game by season, indexed to each sport's first 10 seasons = 100."""
    series, summary = {}, []
    for s, df in frames.items():
        df, partial = full_seasons(df)
        games = df.drop_duplicates("game_id")
        by = games.groupby("season")["total"].agg(["mean", "size"])
        base_seasons = by.index[:10]
        base = games[games["season"].isin(base_seasons)]["total"].mean()
        by["index"] = by["mean"] / base * 100
        series[s] = [{"season": int(k), "label": label(s, k), "avg": r(v["mean"], 2), "index": r(v["index"], 1),
                      "games": int(v["size"])} for k, v in by.iterrows()]
        last = by.index.max()
        summary.append({
            "partial_excluded": [label(s, x) for x in partial],
            "sport": s, "unit": {"nfl": "points", "nba": "points", "mlb": "runs", "nhl": "goals", "epl": "goals"}[s],
            "base_label": f"{label(s, base_seasons.min())} to {label(s, base_seasons.max())}", "base_avg": r(base, 2),
            "latest_label": label(s, last), "latest_avg": r(by.loc[last, "mean"], 2),
            "latest_index": r(by.loc[last, "index"], 1),
            "low_label": label(s, by["mean"].idxmin()), "low_avg": r(by["mean"].min(), 2),
            "high_label": label(s, by["mean"].idxmax()), "high_avg": r(by["mean"].max(), 2),
        })
    return {"series": series, "summary": summary}


def totals_market(frames):
    """F9: over/under results against the posted total, by sport."""
    rows = []
    for s, df in frames.items():
        g = df.drop_duplicates("game_id")  # ou_result is identical on both rows of a game
        o, n = over_pct(g)
        push = (g["ou_result"] == "push").sum()
        n_all = (g["ou_result"] != "").sum()
        withline = g[g["total_line"].notna()]
        rows.append({
            "sport": s, "over": o, "games": n, "push_rate": r(push / n_all) if n_all else None,
            "avg_line": r(withline["total_line"].mean(), 2), "avg_actual": r(withline["total"].mean(), 2),
            "first": label(s, withline["season"].min()) if len(withline) else None,
            "last": label(s, withline["season"].max()) if len(withline) else None,
            "mae": r((withline["total"] - withline["total_line"]).abs().mean(), 2),
        })
    return {"rows": rows}


def rest_effects(frames):
    """F7: win % and cover % by days of rest (days since the team's previous game in the same season)."""
    buckets = {
        "nfl": ("Short week (5 days or fewer)", lambda d: d <= 5, "Normal week (6 to 8 days)", lambda d: (d >= 6) & (d <= 8)),
        "nba": ("Back-to-back (1 day)", lambda d: d == 1, "Rested (2+ days)", lambda d: d >= 2),
        "mlb": ("Played yesterday (1 day or doubleheader)", lambda d: d <= 1, "Day off (2+ days)", lambda d: d >= 2),
        "nhl": ("Back-to-back (1 day)", lambda d: d == 1, "Rested (2+ days)", lambda d: d >= 2),
    }
    rows = []
    for s, df in frames.items():
        if s not in buckets:
            continue
        d = df[df["game_type"] == "regular"].sort_values(["team", "season", "date", "game_id"]).copy()
        d["rest"] = d.groupby(["team", "season"])["date"].diff().dt.days
        opp = d[["game_id", "team", "rest"]].rename(columns={"team": "opponent", "rest": "opp_rest"})
        d = d.merge(opp, on=["game_id", "opponent"], how="left")
        short_name, short_f, norm_name, norm_f = buckets[s]
        rs, rn = short_f(d["rest"]), norm_f(d["rest"])
        # matchups: short-rest team vs a normally rested opponent
        mismatch = d[short_f(d["rest"]) & norm_f(d["opp_rest"])]
        sc, sn = cover_pct(d[rs])
        nc, nn = cover_pct(d[rn])
        mc, mn = cover_pct(mismatch)
        mo = mismatch[mismatch["implied_win"].notna()]
        rows.append({
            "mismatch_odds_n": int(len(mo)), "mismatch_odds_win": win_pct(mo),
            "mismatch_implied": r(mo["implied_win"].mean()),
            "sport": s, "short_name": short_name, "normal_name": norm_name,
            "short_win": win_pct(d[rs]), "short_n": int(rs.sum()), "short_cover": sc, "short_cover_n": sn,
            "normal_win": win_pct(d[rn]), "normal_n": int(rn.sum()), "normal_cover": nc, "normal_cover_n": nn,
            "mismatch_win": win_pct(mismatch), "mismatch_n": int(len(mismatch)), "mismatch_cover": mc, "mismatch_cover_n": mn,
            "first": label(s, d["season"].min()), "last": label(s, d["season"].max()),
        })
    return {"rows": rows}


def epl_draws(frames):
    """F10: EPL draw rate by season and by how close the market thought the match was."""
    if "epl" not in frames:
        return None
    df = frames["epl"]
    h = df[df["home_away"] == "H"].copy()
    by = h.groupby("season").agg(games=("result", "size"), draws=("result", lambda x: (x == "D").sum()),
                                 home=("result", lambda x: (x == "W").sum()), away=("result", lambda x: (x == "L").sum()))
    series = [{"season": int(k), "label": label("epl", k), "draw": r(v.draws / v.games), "home": r(v.home / v.games),
               "away": r(v.away / v.games), "games": int(v.games)} for k, v in by.iterrows()]
    # market-implied draw probability (no-vig, 3-way) vs actual draw frequency
    o = h[h["odds_win"].notna() & h["odds_draw"].notna()].copy()
    opp = df[df["home_away"] == "A"][["game_id", "odds_win"]].rename(columns={"odds_win": "odds_away"})
    o = o.merge(opp, on="game_id")
    inv = 1 / o[["odds_win", "odds_draw", "odds_away"]]
    o["p_draw"] = inv["odds_draw"] / inv.sum(axis=1)
    o["p_home"] = inv["odds_win"] / inv.sum(axis=1)
    o["gap"] = (o["p_home"] - (inv["odds_away"] / inv.sum(axis=1))).abs()
    bins = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 1.0]
    o["bucket"] = pd.cut(o["gap"], bins, include_lowest=True, right=False)
    b = o.groupby("bucket", observed=True).agg(games=("result", "size"), actual=("result", lambda x: (x == "D").mean()),
                                               implied=("p_draw", "mean"))
    # z = (actual - implied) / binomial standard error of the actual rate
    buckets = [{"bucket": f"{int(iv.left*100)}–{int(iv.right*100)} pts", "games": int(v.games), "actual": r(v.actual),
                "implied": r(v.implied), "z": r((v.actual - v.implied) / math.sqrt(v.implied * (1 - v.implied) / v.games), 2)}
               for iv, v in b.iterrows()]
    tot = len(h)
    return {
        "series": series, "buckets": buckets,
        "draw_rate": r((h["result"] == "D").mean()), "home_rate": r((h["result"] == "W").mean()),
        "away_rate": r((h["result"] == "L").mean()), "matches": int(tot),
        "odds_matches": int(len(o)), "implied_draw": r(o["p_draw"].mean()), "actual_draw_odds": r((o["result"] == "D").mean()),
        "first": label("epl", h["season"].min()), "last": label("epl", h["season"].max()),
    }


def star_arcs():
    """F6: career arc of the span's career leader in each sport's headline stat (regular season)."""
    spec = {
        "nfl": ("nfl_player_seasons.csv", "pass_yds", "passing yards", lambda d: d[d["game_type"] == "regular"]),
        "nba": ("nba_player_seasons.csv", "pts", "points", lambda d: d[d["game_type"] == "regular"]),
        "mlb": ("mlb_player_seasons.csv", "hr", "home runs", lambda d: d[d["role"] == "batter"] if "role" in d else d),
        "nhl": ("nhl_player_seasons.csv", "goals", "goals", lambda d: d[d["role"] == "skater"]),
        "epl": ("epl_player_seasons.csv", "goals", "goals", lambda d: d),
    }
    out = []
    for s, (fname, stat, word, filt) in spec.items():
        path = DATA / fname
        if not path.exists():
            print(f"WARNING: {fname} missing - skipped in star arcs")
            continue
        d = pd.read_csv(path, low_memory=False)
        if "game_type" in d and s == "mlb":
            d = d[d["game_type"] == "regular"]
        d = filt(d)
        if stat not in d:
            print(f"WARNING: {fname} has no column {stat}")
            continue
        # EPL (FPL) element ids are re-numbered every season, so EPL players are keyed by name
        if s == "epl":
            d = d.assign(player_id=d["player"])
        if "games" not in d and "g" in d:  # MLB names the games column g
            d = d.rename(columns={"g": "games"})
        # one row per player-season (players traded mid-season appear once per team)
        ps = d.groupby(["player_id", "season"], as_index=False).agg(player=("player", "first"), val=(stat, "sum"),
                                                                    games=("games", "sum"))
        career = ps.groupby("player_id").agg(player=("player", "first"), total=("val", "sum"),
                                             seasons=("season", "nunique")).sort_values("total", ascending=False)
        top = career.index[0]
        arc = ps[ps["player_id"] == top].sort_values("season")
        leaders = ps.sort_values("val", ascending=False).drop_duplicates("season").sort_values("season")
        led = int((leaders["player_id"] == top).sum())
        peak = arc.loc[arc["val"].idxmax()]
        out.append({
            "sport": s, "stat": word, "player": career.loc[top, "player"], "career_total": int(career.loc[top, "total"]),
            "seasons": int(career.loc[top, "seasons"]),
            "runner_up": career.iloc[1]["player"], "runner_up_total": int(career.iloc[1]["total"]),
            "peak_label": label(s, peak["season"]), "peak": int(peak["val"]),
            "led_league": led,
            "span_first": label(s, d["season"].min()), "span_last": label(s, d["season"].max()),
            "arc": [{"season": int(x.season), "label": label(s, x.season), "val": int(x.val), "games": int(x.games)}
                    for x in arc.itertuples()],
        })
    return {"rows": out}


def market_accuracy(frames):
    """Market-only numbers used next to the model backtest: log loss / Brier of the no-vig implied probability."""
    rows = []
    for s, df in frames.items():
        h = df.drop_duplicates("game_id")
        h = h[h["implied_win"].notna()]
        if s != "epl":  # a tie has no winner; EPL keeps draws as non-wins (3-way probability)
            h = h[h["result"].isin(["W", "L"])]
        if not len(h):
            continue
        y = (h["result"] == "W").astype(float)
        p = h["implied_win"].clip(1e-6, 1 - 1e-6)
        rows.append({"sport": s, "games": int(len(h)), "brier": r(((p - y) ** 2).mean()),
                     "logloss": r(-(y * np.log(p) + (1 - y) * np.log(1 - p)).mean()),
                     "first": label(s, h["season"].min()), "last": label(s, h["season"].max())})
    return {"rows": rows}


def backtests():
    """F4/F5: copy the model backtests (written by scripts/train_model.py) into one file."""
    out = {}
    for s in ORDER:
        p = ROOT / f"backtest_{s}.json"
        if p.exists():
            out[s] = json.loads(p.read_text(encoding="utf-8"))
        else:
            print(f"note: backtest_{s}.json not found yet")
    return out


def models_meta():
    out = {}
    for s in ORDER:
        p = ROOT / f"model_{s}.json"
        if p.exists():
            m = json.loads(p.read_text(encoding="utf-8"))
            # keep it small: formulas, constants and coefficients only (no per-team or per-player tables)
            keep = {k: m[k] for k in ("spans", "edge_threshold", "edge_rationale", "player_formula", "constants") if k in m}
            if isinstance(m.get("elo"), dict):
                keep["elo"] = {k: v for k, v in m["elo"].items() if not isinstance(v, (dict, list))}
            mod = m.get("model") or {}
            feats = mod.get("features")
            if feats:
                keep["features"] = feats
                keep["coefficients"] = {}
                for part, v in mod.items():
                    if isinstance(v, dict) and "coef" in v:
                        coef = v["coef"]
                        if coef and isinstance(coef[0], list):  # multinomial (EPL): one row per class
                            keep["coefficients"][part] = {"classes": v.get("classes"), "intercept": v.get("intercept"),
                                                          "coef": [dict(zip(feats, [round(c, 4) for c in row])) for row in coef]}
                        else:
                            keep["coefficients"][part] = {"intercept": v.get("intercept"),
                                                          "coef": dict(zip(feats, [round(c, 4) for c in coef]))}
            out[s] = keep
    return out


def headline(frames, cov):
    games = sum(int(df["game_id"].nunique()) for df in frames.values())
    rows = sum(len(df) for df in frames.values())
    lined = 0
    for df in frames.values():
        g = df.groupby("game_id")[["line", "total_line", "moneyline", "odds_win"]].apply(lambda x: x.notna().any().any())
        lined += int(g.sum())
    first = min(int(df["season"].min()) for df in frames.values())
    last_dates = max(df["date"].max() for df in frames.values())
    players = sum(int(v.get("player_game_rows", 0)) + int(v.get("player_season_rows", 0))
                  for k, v in cov.items() if k in frames)
    return {"rows": rows, "games": games, "games_with_market": lined, "sports": len(frames),
            "sport_list": [SPORTS[s]["name"] for s in frames], "first_season": first,
            "last_date": last_dates.strftime("%Y-%m-%d"),
            "last_date_text": f"{last_dates.strftime('%B')} {last_dates.day}, {last_dates.year}",
            "player_rows": players,
            "teams": sum(int(df["team"].nunique()) for df in frames.values()),
            "per_sport": [{"sport": s, "rows": len(df), "games": int(df["game_id"].nunique()),
                           "first": label(s, df["season"].min()), "last": label(s, df["season"].max()),
                           "seasons": int(df["season"].nunique()), "teams": int(df["team"].nunique())}
                          for s, df in frames.items()]}


def main():
    frames = {}
    for s in ORDER:
        df = load(s)
        if df is not None:
            frames[s] = df
    cov = json.loads((DATA / "coverage.json").read_text(encoding="utf-8"))
    write("headline", headline(frames, cov))
    write("favorites", favorites(frames))
    write("home_edge", home_edge(frames))
    write("scoring", scoring(frames))
    write("totals", totals_market(frames))
    write("rest", rest_effects(frames))
    e = epl_draws(frames)
    if e:
        write("epl_draws", e)
    write("stars", star_arcs())
    write("market", market_accuracy(frames))
    write("backtests", backtests())
    write("models", models_meta())
    write("coverage", {s: {k: v for k, v in cov[s].items()} for s in ORDER if s in cov})
    print("wrote", sorted(p.name for p in OUT.glob("*.json")))


if __name__ == "__main__":
    main()
