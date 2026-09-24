"""Step 3 of the pipeline: train one prediction model per sport, backtest it
honestly, and export everything the static site needs as JSON.

Usage:  python scripts/train_model.py --sport nba
        python scripts/train_model.py --all

Outputs (repo root):
  model_<sport>.json     coefficients, scaling, Elo constants, current team state,
                         starter/goalie ratings, player projections
  backtest_<sport>.json  holdout metrics vs. the betting market, calibration,
                         per-season series, projection check, JS parity samples

Method (all sports):
  1. Elo ratings are run game by game from the first season. Only PRE-game
     ratings become features. Constants (K, home edge, between-season regression)
     are picked by a small grid search on seasons BEFORE any evaluation window.
  2. Pre-game features: Elo difference, neutral site, rest days, back-to-back
     flags (NBA/NHL), last-10 form, last-10 scoring for/against, league scoring
     level, plus a starting-pitcher rating (MLB), starting-goalie save % (NHL),
     or attack/defence ratings (EPL).
  3. scikit-learn models on standardised features: logistic regression for the
     win probability (multinomial home/draw/away for EPL), linear regressions for
     the home margin and the game total.
  4. Holdout = the last two completed seasons. The exported coefficients are the
     ones fit on the training seasons only, so the backtest is exactly the model
     the site runs.
"""
from __future__ import annotations

import argparse
import json
import math
from collections import deque
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.linear_model import LinearRegression, LogisticRegression

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
EPOCH = date(1970, 1, 1)

# Edge flag threshold, fixed BEFORE looking at any holdout result: a side is
# flagged only when the model's win probability exceeds the no-vig market
# probability by more than 3 percentage points (roughly the size of a typical
# sportsbook margin, so smaller gaps are within the market's own noise).
EDGE_THRESHOLD = 0.03

RECENT_N = 10          # last-N games used for form features
BURN_IN_SEASONS = 2    # first seasons dropped from training while Elo settles

CFG = {
    "nfl": dict(first=1990, k=[15, 20, 25, 30], hfa=[40, 55, 70], reg=[0.25, 0.33, 0.5],
                rest_cap=14, b2b=False, lg_n=267, proj_k=5),
    "nba": dict(first=1990, k=[15, 20, 25], hfa=[60, 80, 100], reg=[0.25, 0.33, 0.5],
                rest_cap=5, b2b=True, lg_n=1230, proj_k=5),
    "mlb": dict(first=1990, k=[3, 4, 6], hfa=[15, 25, 35], reg=[0.25, 0.33, 0.5],
                rest_cap=3, b2b=False, lg_n=2430, proj_k=5),
    "nhl": dict(first=1990, k=[6, 8, 10, 12], hfa=[25, 35, 50], reg=[0.25, 0.33, 0.5],
                rest_cap=5, b2b=True, lg_n=1312, proj_k=5),
    "epl": dict(first=1993, k=[15, 20, 25, 30], hfa=[50, 70, 90], reg=[0.25, 0.33, 0.5],
                rest_cap=10, b2b=False, lg_n=380, proj_k=5),
}
SP_PRIOR = 5          # MLB: starter rating shrinks toward league runs/game with 5 pseudo-starts
SP_N = 10             # MLB: last 10 starts
G_PRIOR_SHOTS = 300   # NHL: goalie save % shrinks toward league with 300 pseudo-shots
G_N = 20              # NHL: last 20 starts
G_LG_N = 2000         # NHL: league save % over the last 2000 goalie starts
EW_ALPHA = 0.1        # EPL: attack/defence exponential weight per match

TEAM_NAMES = {
    "nfl": {"ARI": "Arizona Cardinals", "ATL": "Atlanta Falcons", "BAL": "Baltimore Ravens", "BUF": "Buffalo Bills",
            "CAR": "Carolina Panthers", "CHI": "Chicago Bears", "CIN": "Cincinnati Bengals", "CLE": "Cleveland Browns",
            "DAL": "Dallas Cowboys", "DEN": "Denver Broncos", "DET": "Detroit Lions", "GB": "Green Bay Packers",
            "HOU": "Houston Texans", "IND": "Indianapolis Colts", "JAX": "Jacksonville Jaguars", "KC": "Kansas City Chiefs",
            "LA": "Los Angeles Rams", "LAC": "Los Angeles Chargers", "LV": "Las Vegas Raiders", "MIA": "Miami Dolphins",
            "MIN": "Minnesota Vikings", "NE": "New England Patriots", "NO": "New Orleans Saints", "NYG": "New York Giants",
            "NYJ": "New York Jets", "PHI": "Philadelphia Eagles", "PIT": "Pittsburgh Steelers", "SEA": "Seattle Seahawks",
            "SF": "San Francisco 49ers", "TB": "Tampa Bay Buccaneers", "TEN": "Tennessee Titans", "WAS": "Washington Commanders"},
    "nba": {"ATL": "Atlanta Hawks", "BKN": "Brooklyn Nets", "BOS": "Boston Celtics", "CHA": "Charlotte Hornets",
            "CHI": "Chicago Bulls", "CLE": "Cleveland Cavaliers", "DAL": "Dallas Mavericks", "DEN": "Denver Nuggets",
            "DET": "Detroit Pistons", "GSW": "Golden State Warriors", "HOU": "Houston Rockets", "IND": "Indiana Pacers",
            "LAC": "LA Clippers", "LAL": "Los Angeles Lakers", "MEM": "Memphis Grizzlies", "MIA": "Miami Heat",
            "MIL": "Milwaukee Bucks", "MIN": "Minnesota Timberwolves", "NOP": "New Orleans Pelicans", "NYK": "New York Knicks",
            "OKC": "Oklahoma City Thunder", "ORL": "Orlando Magic", "PHI": "Philadelphia 76ers", "PHX": "Phoenix Suns",
            "POR": "Portland Trail Blazers", "SAC": "Sacramento Kings", "SAS": "San Antonio Spurs", "TOR": "Toronto Raptors",
            "UTA": "Utah Jazz", "WAS": "Washington Wizards"},
    "nhl": {"ANA": "Anaheim Ducks", "ARI": "Arizona Coyotes (to 2024)", "BOS": "Boston Bruins", "BUF": "Buffalo Sabres",
            "CAR": "Carolina Hurricanes", "CBJ": "Columbus Blue Jackets", "CGY": "Calgary Flames", "CHI": "Chicago Blackhawks",
            "COL": "Colorado Avalanche", "DAL": "Dallas Stars", "DET": "Detroit Red Wings", "EDM": "Edmonton Oilers",
            "FLA": "Florida Panthers", "LAK": "Los Angeles Kings", "MIN": "Minnesota Wild", "MTL": "Montreal Canadiens",
            "NJD": "New Jersey Devils", "NSH": "Nashville Predators", "NYI": "New York Islanders", "NYR": "New York Rangers",
            "OTT": "Ottawa Senators", "PHI": "Philadelphia Flyers", "PIT": "Pittsburgh Penguins", "SEA": "Seattle Kraken",
            "SJS": "San Jose Sharks", "STL": "St. Louis Blues", "TBL": "Tampa Bay Lightning", "TOR": "Toronto Maple Leafs",
            "UTA": "Utah Mammoth", "VAN": "Vancouver Canucks", "VGK": "Vegas Golden Knights", "WPG": "Winnipeg Jets",
            "WSH": "Washington Capitals"},
    "mlb": {"ARI": "Arizona Diamondbacks", "ATH": "Athletics", "ATL": "Atlanta Braves", "BAL": "Baltimore Orioles",
            "BOS": "Boston Red Sox", "CHC": "Chicago Cubs", "CHW": "Chicago White Sox", "CWS": "Chicago White Sox",
            "CIN": "Cincinnati Reds", "CLE": "Cleveland Guardians", "COL": "Colorado Rockies", "DET": "Detroit Tigers",
            "HOU": "Houston Astros", "KC": "Kansas City Royals", "KCR": "Kansas City Royals", "LAA": "Los Angeles Angels",
            "LAD": "Los Angeles Dodgers", "MIA": "Miami Marlins", "MIL": "Milwaukee Brewers", "MIN": "Minnesota Twins",
            "NYM": "New York Mets", "NYY": "New York Yankees", "PHI": "Philadelphia Phillies", "PIT": "Pittsburgh Pirates",
            "SD": "San Diego Padres", "SDP": "San Diego Padres", "SEA": "Seattle Mariners", "SF": "San Francisco Giants",
            "SFG": "San Francisco Giants", "STL": "St. Louis Cardinals", "TB": "Tampa Bay Rays", "TBR": "Tampa Bay Rays",
            "TEX": "Texas Rangers", "TOR": "Toronto Blue Jays", "WSN": "Washington Nationals", "WSH": "Washington Nationals"},
}


# ----------------------------------------------------------------------------
# data loading
# ----------------------------------------------------------------------------

def day_num(d) -> int:
    return (d - EPOCH).days


def load_games(sport: str) -> pd.DataFrame:
    p = pd.read_csv(DATA / f"{sport}.csv", dtype={"game_id": str}, low_memory=False)
    # the home row is the H row; for neutral sites (both N) the first row in file order
    is_home = (p["home_away"] == "H") | ((p["home_away"] == "N") & ~p.duplicated("game_id"))
    h = p[is_home].set_index("game_id")
    a = p[~is_home].set_index("game_id").loc[h.index]
    g = pd.DataFrame({
        "game_id": h.index,
        "date": pd.to_datetime(h["date"]).dt.date.values,
        "season": h["season"].astype(int).values,
        "game_type": h["game_type"].values,
        "home": h["team"].values,
        "away": a["team"].values,
        "hs": h["score_for"].astype(int).values,
        "as_": a["score_for"].astype(int).values,
        "neutral": (h["home_away"] == "N").astype(int).values,
        "home_line": h["line"].values,
        "total_line": h["total_line"].values,
        "p_mkt_home": h["implied_win"].values,
        "p_mkt_away": a["implied_win"].values,
        "home_ml": h["moneyline"].values,
        "away_ml": a["moneyline"].values,
        "odds_h": h["odds_win"].values,
        "odds_d": h["odds_draw"].values,
        "odds_a": a["odds_win"].values,
    })
    g = g.sort_values(["date", "game_id"], kind="stable").reset_index(drop=True)
    g["day"] = [day_num(d) for d in g["date"]]
    return g


def season_status(sport: str, g: pd.DataFrame):
    """Completed seasons and the in-progress one (deterministic from the data):
    the latest season is in progress if it has no playoff games yet (US) or fewer
    than 380 matches (EPL)."""
    seasons = sorted(int(x) for x in g["season"].unique())
    last = seasons[-1]
    lg = g[g["season"] == last]
    if sport == "epl":
        in_prog = len(lg) < 380
    else:
        in_prog = not (lg["game_type"] == "playoff").any()
    completed = seasons[:-1] if in_prog else seasons
    return completed, (last if in_prog else None)


# ----------------------------------------------------------------------------
# Elo
# ----------------------------------------------------------------------------

def mov_mult(margin: int, dw: float) -> float:
    """538-style margin-of-victory multiplier; dw = winner's pre-game Elo edge."""
    if margin == 0:
        return 1.0
    return math.log(abs(margin) + 1) * 2.2 / (dw * 0.001 + 2.2)


def elo_grid_score(g: pd.DataFrame, K, HFA, R, score_from: int, score_to: int) -> float:
    """Mean squared error of the Elo expected score on seasons [score_from, score_to)."""
    elo, last_s = {}, {}
    H, A, S = g["home"].tolist(), g["away"].tolist(), g["season"].tolist()
    HS, AS, N = g["hs"].tolist(), g["as_"].tolist(), g["neutral"].tolist()
    se, cnt = 0.0, 0
    for i in range(len(H)):
        h, a, s = H[i], A[i], S[i]
        for t in (h, a):
            if t not in elo:
                elo[t] = 1500.0
                last_s[t] = s
            elif last_s[t] != s:
                elo[t] = elo[t] * (1 - R) + 1500.0 * R
                last_s[t] = s
        d = elo[h] - elo[a] + (0 if N[i] else HFA)
        exp = 1.0 / (1.0 + 10 ** (-d / 400.0))
        m = HS[i] - AS[i]
        res = 1.0 if m > 0 else (0.0 if m < 0 else 0.5)
        if score_from <= s < score_to:
            se += (res - exp) ** 2
            cnt += 1
        dw = d if res == 1.0 else -d
        delta = K * mov_mult(m, dw) * (res - exp)
        elo[h] += delta
        elo[a] -= delta
    return se / max(cnt, 1)


def tune_elo(sport, g, tune_end):
    c = CFG[sport]
    start = c["first"] + BURN_IN_SEASONS
    best = None
    for K in c["k"]:
        for HFA in c["hfa"]:
            for R in c["reg"]:
                sc = elo_grid_score(g, K, HFA, R, start, tune_end)
                if best is None or sc < best[0]:
                    best = (sc, K, HFA, R)
    return {"K": best[1], "HFA": best[2], "season_regression": best[3],
            "tuned_on": f"{start}-{tune_end - 1} (mean squared error of Elo expected score)",
            "tune_mse": round(best[0], 6)}


# ----------------------------------------------------------------------------
# features: the SAME function is used in training and (via the exported JSON)
# re-implemented line for line in js/predict.js
# ----------------------------------------------------------------------------

def feature_names(sport):
    f = ["elo_diff", "neutral", "rest_h", "rest_a"]
    if CFG[sport]["b2b"]:
        f += ["b2b_h", "b2b_a"]
    f += ["wp10_diff", "mg10_diff", "pf10_h", "pa10_h", "pf10_a", "pa10_a", "lg_total"]
    if sport == "mlb":
        f += ["sp_h", "sp_a"]
    if sport == "nhl":
        f += ["gsv_h", "gsv_a"]
    if sport == "epl":
        f += ["att_h", "def_h", "att_a", "def_a"]
    return f


def form(team_state, lg_total):
    r = team_state["recent"] if team_state else []
    n = len(r)
    half = lg_total / 2.0
    wp = (sum(x[3] for x in r) + 0.5 * (RECENT_N - n)) / RECENT_N
    mg = sum(x[0] for x in r) / RECENT_N
    pf = (sum(x[1] for x in r) + half * (RECENT_N - n)) / RECENT_N
    pa = (sum(x[2] for x in r) + half * (RECENT_N - n)) / RECENT_N
    return wp, mg, pf, pa


def starter_rating(st, key, lg_total):
    lg_ra = lg_total / 2.0
    s = st["starters"].get(key) if key is not None else None
    ra = s["ra"] if s else []
    return (sum(ra) + lg_ra * SP_PRIOR) / (len(ra) + SP_PRIOR)


def goalie_rating(st, key):
    lg_sv = st["league"]["lg_sv"]
    gl = st["goalies"].get(key) if key is not None else None
    sv = gl["sv"] if gl else []
    saves = sum(x[0] for x in sv)
    shots = sum(x[1] for x in sv)
    return (saves + lg_sv * G_PRIOR_SHOTS) / (shots + G_PRIOR_SHOTS)


def featurize(sport, st, home, away, day, neutral, hkey=None, akey=None):
    c = CFG[sport]
    th, ta = st["teams"].get(home), st["teams"].get(away)
    lg = st["league"]["lg_total"]
    eh = th["elo"] if th else 1500.0
    ea = ta["elo"] if ta else 1500.0
    hfa = st["elo_constants"]["HFA"]
    x = {"elo_diff": eh - ea + (0 if neutral else hfa), "neutral": 1 if neutral else 0}
    cap = c["rest_cap"]
    rh = min(day - th["last_day"], cap) if th and th.get("last_day") is not None else cap
    ra = min(day - ta["last_day"], cap) if ta and ta.get("last_day") is not None else cap
    x["rest_h"], x["rest_a"] = rh, ra
    if c["b2b"]:
        x["b2b_h"], x["b2b_a"] = (1 if rh == 1 else 0), (1 if ra == 1 else 0)
    wph, mgh, pfh, pah = form(th, lg)
    wpa, mga, pfa, paa = form(ta, lg)
    x.update({"wp10_diff": wph - wpa, "mg10_diff": mgh - mga, "pf10_h": pfh, "pa10_h": pah,
              "pf10_a": pfa, "pa10_a": paa, "lg_total": lg})
    if sport == "mlb":
        x["sp_h"], x["sp_a"] = starter_rating(st, hkey, lg), starter_rating(st, akey, lg)
    if sport == "nhl":
        x["gsv_h"], x["gsv_a"] = goalie_rating(st, hkey), goalie_rating(st, akey)
    if sport == "epl":
        half = lg / 2.0
        x["att_h"] = th["att"] if th and "att" in th else half
        x["def_h"] = th["def"] if th and "def" in th else half
        x["att_a"] = ta["att"] if ta and "att" in ta else half
        x["def_a"] = ta["def"] if ta and "def" in ta else half
    return x


def load_starters(sport, g):
    """Per game (home key, away key) for MLB starters / NHL starting goalies."""
    if sport == "mlb":
        s = pd.read_csv(DATA / "mlb_starters.csv", dtype={"game_id": str, "starter_id": str})
        idc, namec = "starter_id", "starter_name"
    elif sport == "nhl":
        s = pd.read_csv(DATA / "nhl_goalie_starts.csv", dtype={"game_id": str, "goalie_id": str})
        s = s[s["started"] == 1]
        idc, namec = "goalie_id", "goalie"
    else:
        return None, None
    s = s.drop_duplicates(["game_id", "team"])
    key = dict(zip(zip(s["game_id"], s["team"]), s[idc]))
    names = dict(zip(s[idc], s[namec]))
    hk = [key.get((gid, t)) for gid, t in zip(g["game_id"], g["home"])]
    ak = [key.get((gid, t)) for gid, t in zip(g["game_id"], g["away"])]
    extra = None
    if sport == "nhl":
        extra = {(r.game_id, r.team): (r.saves, r.shots_against) for r in s.itertuples()}
    return (hk, ak, names, extra), s


def run_pipeline(sport, g, elo_c):
    """Chronological pass: pre-game features for every game, then state update."""
    c = CFG[sport]
    K, HFA, R = elo_c["K"], elo_c["HFA"], elo_c["season_regression"]
    st = {"teams": {}, "league": {"lg_total": 0.0, "lg_sv": 0.9}, "starters": {}, "goalies": {},
          "elo_constants": {"HFA": HFA}}
    lg_q, lg_sum = deque(), 0.0
    gq, g_sv_sum, g_sh_sum = deque(), 0.0, 0.0
    st_info, _ = load_starters(sport, g)
    names = {}
    if st_info:
        hk_all, ak_all, names, extra = st_info
    rows, elo_exp, pre_elo = [], [], []
    # seed the league scoring level with the first season's mean so early games have a sane value
    st["league"]["lg_total"] = float((g.loc[g["season"] == g["season"].min(), "hs"] +
                                      g.loc[g["season"] == g["season"].min(), "as_"]).mean())
    for i, r in enumerate(g.itertuples(index=False)):
        h, a, s = r.home, r.away, r.season
        for t in (h, a):
            ts = st["teams"].get(t)
            if ts is None:
                ts = {"elo": 1500.0, "last_season": s, "last_day": None, "recent": []}
                if sport == "epl":
                    ts["att"] = ts["def"] = st["league"]["lg_total"] / 2.0
                st["teams"][t] = ts
            elif ts["last_season"] != s:
                ts["elo"] = ts["elo"] * (1 - R) + 1500.0 * R
                ts["last_season"] = s
        hkey = hk_all[i] if st_info else None
        akey = ak_all[i] if st_info else None
        pre_elo.append((st["teams"][h]["elo"], st["teams"][a]["elo"]))
        x = featurize(sport, st, h, a, r.day, r.neutral, hkey, akey)
        rows.append(x)
        d = x["elo_diff"]
        exp = 1.0 / (1.0 + 10 ** (-d / 400.0))
        elo_exp.append(exp)
        # ---- update state with the result ----
        m = r.hs - r.as_
        res = 1.0 if m > 0 else (0.0 if m < 0 else 0.5)
        dw = d if res == 1.0 else -d
        delta = K * mov_mult(m, dw) * (res - exp)
        th, ta = st["teams"][h], st["teams"][a]
        th["elo"] += delta
        ta["elo"] -= delta
        for ts, pf, pa in ((th, r.hs, r.as_), (ta, r.as_, r.hs)):
            w = 1.0 if pf > pa else (0.0 if pf < pa else 0.5)
            ts["recent"].append([pf - pa, pf, pa, w])
            if len(ts["recent"]) > RECENT_N:
                ts["recent"].pop(0)
            ts["last_day"] = r.day
        if sport == "epl":
            for ts, gf, ga in ((th, r.hs, r.as_), (ta, r.as_, r.hs)):
                ts["att"] = (1 - EW_ALPHA) * ts["att"] + EW_ALPHA * gf
                ts["def"] = (1 - EW_ALPHA) * ts["def"] + EW_ALPHA * ga
        tot = r.hs + r.as_
        lg_q.append(tot)
        lg_sum += tot
        if len(lg_q) > c["lg_n"]:
            lg_sum -= lg_q.popleft()
        st["league"]["lg_total"] = lg_sum / len(lg_q)
        if sport == "mlb":
            for key, ra_ in ((hkey, r.as_), (akey, r.hs)):
                if key is None:
                    continue
                e = st["starters"].setdefault(key, {"name": names.get(key, str(key)), "ra": [], "last_day": None})
                e["ra"].append(ra_)
                if len(e["ra"]) > SP_N:
                    e["ra"].pop(0)
                e["last_day"] = r.day
        if sport == "nhl":
            for key, team in ((hkey, h), (akey, a)):
                if key is None:
                    continue
                sv, sh = extra.get((r.game_id, team), (None, None))
                if sv is None or sh is None or pd.isna(sv) or pd.isna(sh) or sh <= 0:
                    continue
                e = st["goalies"].setdefault(key, {"name": names.get(key, str(key)), "sv": [], "last_day": None})
                e["sv"].append([int(sv), int(sh)])
                if len(e["sv"]) > G_N:
                    e["sv"].pop(0)
                e["last_day"] = r.day
                gq.append((sv, sh))
                g_sv_sum += sv
                g_sh_sum += sh
                if len(gq) > G_LG_N:
                    o = gq.popleft()
                    g_sv_sum -= o[0]
                    g_sh_sum -= o[1]
                st["league"]["lg_sv"] = g_sv_sum / g_sh_sum
    X = pd.DataFrame(rows)[feature_names(sport)]
    st["pre_elo"] = np.array(pre_elo)  # (home, away) pre-game ratings per game, for predictions_<sport>.csv
    return X, np.array(elo_exp), st


# ----------------------------------------------------------------------------
# models
# ----------------------------------------------------------------------------

class Fitted:
    def __init__(self, sport, X, g, mask):
        self.sport = sport
        self.feats = list(X.columns)
        Xt = X[mask].to_numpy(float)
        self.mean = Xt.mean(axis=0)
        self.std = Xt.std(axis=0)
        self.std[self.std == 0] = 1.0
        Z = (Xt - self.mean) / self.std
        gt = g[mask]
        margin = (gt["hs"] - gt["as_"]).to_numpy(float)
        total = (gt["hs"] + gt["as_"]).to_numpy(float)
        if sport == "epl":
            y = np.where(margin > 0, "H", np.where(margin < 0, "A", "D"))
            self.win = LogisticRegression(max_iter=2000, C=1.0).fit(Z, y)
            self.n_train_win = len(y)
        else:
            keep = margin != 0  # ties (NFL, pre-2005 NHL) are not wins or losses
            self.win = LogisticRegression(max_iter=2000, C=1.0).fit(Z[keep], (margin[keep] > 0).astype(int))
            self.n_train_win = int(keep.sum())
        self.marg = LinearRegression().fit(Z, margin)
        self.tot = LinearRegression().fit(Z, total)
        self.n_train = int(mask.sum())

    def z(self, X):
        return (X.to_numpy(float) - self.mean) / self.std

    def predict(self, X):
        Z = self.z(X)
        out = {"margin": self.marg.predict(Z), "total": self.tot.predict(Z)}
        pr = self.win.predict_proba(Z)
        if self.sport == "epl":
            cl = list(self.win.classes_)
            out["pH"], out["pD"], out["pA"] = pr[:, cl.index("H")], pr[:, cl.index("D")], pr[:, cl.index("A")]
        else:
            out["pH"] = pr[:, 1]
        return out

    def export(self):
        d = {"features": self.feats,
             "mean": [round(float(v), 6) for v in self.mean],
             "std": [round(float(v), 6) for v in self.std],
             "margin": {"coef": [round(float(v), 6) for v in self.marg.coef_], "intercept": round(float(self.marg.intercept_), 6)},
             "total": {"coef": [round(float(v), 6) for v in self.tot.coef_], "intercept": round(float(self.tot.intercept_), 6)}}
        if self.sport == "epl":
            d["win"] = {"classes": [str(c) for c in self.win.classes_],
                        "coef": [[round(float(v), 6) for v in row] for row in self.win.coef_],
                        "intercept": [round(float(v), 6) for v in self.win.intercept_]}
        else:
            d["win"] = {"coef": [round(float(v), 6) for v in self.win.coef_[0]], "intercept": round(float(self.win.intercept_[0]), 6)}
        return d


# ----------------------------------------------------------------------------
# metrics
# ----------------------------------------------------------------------------

def ll2(p, y):
    p = np.clip(p, 1e-12, 1 - 1e-12)
    return float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))


def brier2(p, y):
    return float(np.mean((p - y) ** 2))


def ll3(P, Y):
    return float(-np.mean(np.log(np.clip((P * Y).sum(axis=1), 1e-12, 1))))


def brier3(P, Y):
    return float(np.mean(((P - Y) ** 2).sum(axis=1)))


def jdefault(o):
    if isinstance(o, np.integer):
        return int(o)
    if isinstance(o, np.floating):
        return float(o)
    if isinstance(o, np.bool_):
        return bool(o)
    raise TypeError(type(o))


def r4(v):
    return None if v is None or (isinstance(v, float) and not math.isfinite(v)) else round(float(v), 4)


def ml_profit(ml):
    return ml / 100.0 if ml > 0 else 100.0 / -ml


def side_record(pick_home, margin, home_line):
    """pick_home bool array; returns wins, losses, pushes of the pick vs the line."""
    adj = margin + home_line
    home_res = np.sign(adj)
    res = np.where(pick_home, home_res, -home_res)
    return int((res > 0).sum()), int((res < 0).sum()), int((res == 0).sum())


def record_block(w, l, p, roi_price=None):
    n = w + l
    out = {"bets": w + l + p, "wins": w, "losses": l, "pushes": p,
           "win_pct_ex_push": r4(w / n) if n else None}
    if roi_price is not None and (w + l + p):
        out["roi_at_-110"] = r4((w * (100 / 110) - l) / (w + l + p))
        out["break_even_pct"] = r4(110 / 210)
    return out


def evaluate(sport, fit, X, g, mask, label):
    """Holdout metrics on g[mask] (all games evaluated with the given fit)."""
    gg = g[mask].reset_index(drop=True)
    pr = fit.predict(X[mask])
    margin = (gg["hs"] - gg["as_"]).to_numpy(float)
    total = (gg["hs"] + gg["as_"]).to_numpy(float)
    out = {"label": label, "seasons": sorted(int(s) for s in gg["season"].unique()), "games": int(len(gg))}
    if sport == "epl":
        P = np.column_stack([pr["pH"], pr["pD"], pr["pA"]])
        Y = np.column_stack([margin > 0, margin == 0, margin < 0]).astype(float)
        out["win_model"] = {"log_loss": r4(ll3(P, Y)), "brier": r4(brier3(P, Y)),
                            "accuracy": r4(np.mean(P.argmax(axis=1) == Y.argmax(axis=1)))}
        base = np.array(fit.class_freq)
        B = np.tile(base, (len(gg), 1))
        out["baseline"] = {"name": "training-season H/D/A frequencies", "log_loss": r4(ll3(B, Y)), "brier": r4(brier3(B, Y))}
        o = gg[["odds_h", "odds_d", "odds_a"]].to_numpy(float)
        has = np.isfinite(o).all(axis=1)
        if has.sum():
            inv = 1 / o[has]
            Q = inv / inv.sum(axis=1, keepdims=True)
            out["market"] = {"games": int(has.sum()), "log_loss_market": r4(ll3(Q, Y[has])),
                             "log_loss_model_same_games": r4(ll3(P[has], Y[has])),
                             "brier_market": r4(brier3(Q, Y[has])), "brier_model_same_games": r4(brier3(P[has], Y[has])),
                             "accuracy_market": r4(np.mean(Q.argmax(axis=1) == Y[has].argmax(axis=1)))}
            # 1X2 edge bets: back the outcome whose model prob beats no-vig prob by > threshold
            E = P[has] - Q
            best = E.argmax(axis=1)
            take = E.max(axis=1) > EDGE_THRESHOLD
            won = Y[has][np.arange(has.sum()), best] == 1
            price = o[has][np.arange(has.sum()), best]
            prof = np.where(won, price - 1, -1.0)[take]
            out["edge_bets_1x2"] = {"threshold": EDGE_THRESHOLD, "bets": int(take.sum()), "wins": int(won[take].sum()),
                                    "roi": r4(prof.mean()) if take.sum() else None,
                                    "odds_used": "closing market average 2019-20+, else pre-match average"}
        pHome = P[:, 0]
    else:
        keep = margin != 0
        y = (margin > 0).astype(float)
        p = pr["pH"]
        out["ties_excluded"] = int((~keep).sum())
        out["win_model"] = {"log_loss": r4(ll2(p[keep], y[keep])), "brier": r4(brier2(p[keep], y[keep])),
                            "accuracy": r4(np.mean((p[keep] > 0.5) == (y[keep] == 1)))}
        out["baseline"] = {"name": "training-season home win rate", "p": r4(fit.home_rate),
                           "log_loss": r4(ll2(np.full(keep.sum(), fit.home_rate), y[keep])),
                           "brier": r4(brier2(np.full(keep.sum(), fit.home_rate), y[keep]))}
        q = gg["p_mkt_home"].to_numpy(float)
        has = keep & np.isfinite(q)
        if has.sum():
            out["market"] = {"games": int(has.sum()), "log_loss_market": r4(ll2(q[has], y[has])),
                             "log_loss_model_same_games": r4(ll2(p[has], y[has])),
                             "brier_market": r4(brier2(q[has], y[has])), "brier_model_same_games": r4(brier2(p[has], y[has])),
                             "accuracy_market": r4(np.mean((q[has] > 0.5) == (y[has] == 1))),
                             "accuracy_model_same_games": r4(np.mean((p[has] > 0.5) == (y[has] == 1)))}
        # moneyline edge bets
        hm, am = gg["home_ml"].to_numpy(float), gg["away_ml"].to_numpy(float)
        okm = np.isfinite(hm) & np.isfinite(am) & np.isfinite(q)
        if okm.sum():
            eh = p - q
            ea = (1 - p) - (1 - q)
            bet_h = okm & (eh > EDGE_THRESHOLD)
            bet_a = okm & (ea > EDGE_THRESHOLD)
            prof = []
            wins = 0
            for i in np.where(bet_h | bet_a)[0]:
                side_home = bet_h[i]
                ml = hm[i] if side_home else am[i]
                if margin[i] == 0:
                    prof.append(0.0)
                    continue
                won = (margin[i] > 0) == side_home
                wins += int(won)
                prof.append(ml_profit(ml) if won else -1.0)
            out["edge_bets_moneyline"] = {"threshold": EDGE_THRESHOLD, "eligible_games": int(okm.sum()),
                                          "bets": len(prof), "wins": wins,
                                          "roi": r4(np.mean(prof)) if prof else None}
        pHome = p
    # margin / line
    hl = gg["home_line"].to_numpy(float)
    okl = np.isfinite(hl)
    out["margin_mae_model"] = r4(np.mean(np.abs(pr["margin"] - margin)))
    if okl.sum():
        out["line"] = {"games": int(okl.sum()),
                       "margin_mae_model": r4(np.mean(np.abs(pr["margin"][okl] - margin[okl]))),
                       "margin_mae_market_line": r4(np.mean(np.abs(-hl[okl] - margin[okl])))}
        pick_home = (pr["margin"][okl] + hl[okl]) > 0
        w, l, pu = side_record(pick_home, margin[okl], hl[okl])
        out["line"]["model_side_vs_line"] = record_block(w, l, pu, roi_price=-110 if sport in ("nfl", "nba") else None)
    tl = gg["total_line"].to_numpy(float)
    okt = np.isfinite(tl)
    out["total_mae_model"] = r4(np.mean(np.abs(pr["total"] - total)))
    if okt.sum():
        out["totals"] = {"games": int(okt.sum()),
                         "total_mae_model": r4(np.mean(np.abs(pr["total"][okt] - total[okt]))),
                         "total_mae_market_line": r4(np.mean(np.abs(tl[okt] - total[okt])))}
        over = pr["total"][okt] > tl[okt]
        diff = total[okt] - tl[okt]
        res = np.where(over, np.sign(diff), -np.sign(diff))
        out["totals"]["model_side_vs_total"] = record_block(int((res > 0).sum()), int((res < 0).sum()), int((res == 0).sum()),
                                                            roi_price=-110 if sport in ("nfl", "nba") else None)
    # calibration (home win probability)
    yy = (margin > 0).astype(float)
    bins = np.clip((pHome * 10).astype(int), 0, 9)
    cal = []
    for b in range(10):
        sel = bins == b
        if sport != "epl":
            sel = sel & (margin != 0)
        if sel.sum():
            cal.append({"bin": f"{b / 10:.1f}-{(b + 1) / 10:.1f}", "n": int(sel.sum()),
                        "predicted": r4(pHome[sel].mean()), "observed": r4(yy[sel].mean())})
    out["calibration_home_win"] = cal
    return out, pr


def per_season(sport, fit, X, elo_exp, g, mask_all, holdout_start):
    pr = fit.predict(X[mask_all])
    gg = g[mask_all].reset_index(drop=True)
    ee = elo_exp[mask_all.to_numpy()]
    rows = []
    for s, idx in gg.groupby("season").groups.items():
        idx = np.array(list(idx))
        sub = gg.loc[idx]
        m = (sub["hs"] - sub["as_"]).to_numpy(float)
        row = {"season": int(s), "in_sample": bool(s < holdout_start), "games": int(len(sub)),
               "home_win_rate": r4(np.mean(m > 0))}
        if sport == "epl":
            P = np.column_stack([pr["pH"][idx], pr["pD"][idx], pr["pA"][idx]])
            Y = np.column_stack([m > 0, m == 0, m < 0]).astype(float)
            row["model_log_loss"] = r4(ll3(P, Y))
            row["model_accuracy"] = r4(np.mean(P.argmax(1) == Y.argmax(1)))
            o = sub[["odds_h", "odds_d", "odds_a"]].to_numpy(float)
            has = np.isfinite(o).all(axis=1)
            row["market_games"] = int(has.sum())
            if has.sum():
                inv = 1 / o[has]
                Q = inv / inv.sum(1, keepdims=True)
                row["market_log_loss"] = r4(ll3(Q, Y[has]))
                row["model_log_loss_market_games"] = r4(ll3(P[has], Y[has]))
        else:
            keep = m != 0
            y = (m > 0).astype(float)
            p = pr["pH"][idx]
            row["model_log_loss"] = r4(ll2(p[keep], y[keep]))
            row["elo_log_loss"] = r4(ll2(ee[idx][keep], y[keep]))
            row["model_accuracy"] = r4(np.mean((p[keep] > 0.5) == (y[keep] == 1)))
            q = sub["p_mkt_home"].to_numpy(float)
            has = keep & np.isfinite(q)
            row["market_games"] = int(has.sum())
            if has.sum():
                row["market_log_loss"] = r4(ll2(q[has], y[has]))
                row["model_log_loss_market_games"] = r4(ll2(p[has], y[has]))
                row["elo_log_loss_market_games"] = r4(ll2(ee[idx][has], y[has]))
        hl = sub["home_line"].to_numpy(float)
        ok = np.isfinite(hl)
        if ok.sum():
            row["line_mae"] = r4(np.mean(np.abs(-hl[ok] - m[ok])))
            row["model_margin_mae_line_games"] = r4(np.mean(np.abs(pr["margin"][idx][ok] - m[ok])))
        rows.append(row)
    return rows


# ----------------------------------------------------------------------------
# player projections
# ----------------------------------------------------------------------------
# projection = w * mean(last L games) + (1 - w) * mean(base window) * u
#   L        = the player's most recent games, up to 10
#   w        = n_L / (n_L + k)
#   base     = all the player's games in the reference season and the season before
#   u        = mean usage over L / mean usage over base, clipped to [0.5, 1.5]
#              (usage = minutes, touches, targets, plate appearances or TOI)

def player_spec(sport):
    if sport == "nba":
        return [{"role": "all", "filter": None, "usage": ["min"], "stats": ["pts", "reb", "ast"], "top": 3}]
    if sport == "nfl":
        return [{"role": "QB", "filter": ("position", ["QB"]), "usage": ["pass_att", "carries"],
                 "stats": ["pass_yds", "pass_td", "int", "rush_yds"], "top": 1},
                {"role": "RB", "filter": ("position", ["RB"]), "usage": ["carries", "targets"],
                 "stats": ["rush_yds", "rush_td", "rec", "rec_yds"], "top": 1},
                {"role": "WR/TE", "filter": ("position", ["WR", "TE"]), "usage": ["targets"],
                 "stats": ["rec", "rec_yds", "rec_td"], "top": 2}]
    if sport == "nhl":
        return [{"role": "skater", "filter": None, "usage": ["toi"], "stats": ["goals", "assists", "points"], "top": 3}]
    if sport == "epl":
        return [{"role": "outfield", "filter": ("position", ["DEF", "MID", "FWD"]), "usage": ["minutes"],
                 "stats": ["goals", "assists"], "top": 4, "rank": ["goals", "assists"]}]
    if sport == "mlb":
        return [{"role": "batter", "filter": ("role", ["batter"]), "usage": ["pa"], "stats": ["h", "hr", "rbi", "sb"], "top": 4},
                {"role": "pitcher", "filter": ("role", ["pitcher"]), "usage": ["ip_outs"], "stats": ["ip", "k_p", "er"],
                 "top": None, "min_starts": 3}]
    return []


def load_players(sport):
    p = pd.read_csv(DATA / f"{sport}_players.csv", dtype={"game_id": str, "player_id": str}, low_memory=False)
    p["date"] = pd.to_datetime(p["date"])
    if sport == "epl":
        # FPL renumbers player ids every season (id 381 = Salah in 2025-26, Koumas in 2026-27),
        # so players are tracked across seasons by name
        p["player_id"] = p["player"]
    if sport == "mlb":
        p["ip"] = p["ip_outs"] / 3.0
        if "gs" in p:  # pitchers: project per start only
            p = p[(p["role"] != "pitcher") | (p["gs"] == 1)]
    if "game_type" in p:
        p = p[p["game_type"].isin(["regular", "playoff"])]
    return p.sort_values(["date", "game_id"]).reset_index(drop=True)


def blend(hist, stats, usage, k):
    """hist: DataFrame of prior games (chronological) for one player within the
    base window; returns projection dict or None."""
    if len(hist) == 0:
        return None
    L = hist.tail(RECENT_N)
    n = len(L)
    w = n / (n + k)
    uL = L[usage].sum(axis=1).mean()
    uS = hist[usage].sum(axis=1).mean()
    u = 1.0 if uS <= 0 else min(max(uL / uS, 0.5), 1.5)
    return {s: w * L[s].mean() + (1 - w) * hist[s].mean() * u for s in stats}, n, w, u


def project_players(sport):
    c = CFG[sport]
    k = c["proj_k"]
    p = load_players(sport)
    ref = int(p["season"].max())
    base = p[p["season"].isin([ref, ref - 1])]
    latest_team = base.sort_values("date").groupby("player_id").tail(1).set_index("player_id")
    # each team's last RECENT_N games in the base window (every game the team has player rows for)
    tg = base[["team", "date", "game_id"]].drop_duplicates().sort_values(["date", "game_id"])
    team_last = {t: set(d["game_id"].tail(RECENT_N)) for t, d in tg.groupby("team")}
    # each team's own latest season: on a new season's opening night a team that hasn't played
    # yet still gets its players from last season instead of an empty list
    team_ref = base.groupby("team")["season"].max()
    team_ref_games = base[base["season"] == base["team"].map(team_ref)].groupby("team")["game_id"].nunique()
    out = {}
    for spec in player_spec(sport):
        sub = base
        if spec["filter"]:
            col, vals = spec["filter"]
            sub = sub[sub[col].isin(vals)]
        for pid, hist in sub.groupby("player_id"):
            lt = latest_team.loc[pid]
            team = lt["team"]
            if int(lt["season"]) != int(team_ref[team]):
                continue  # not active in his team's latest season

            res = blend(hist, spec["stats"], spec["usage"], k)
            if res is None:
                continue
            proj, n, w, u = res
            if spec.get("min_starts"):
                # starts this season; early in a season (< RECENT_N team games) the whole base window counts
                win = hist if team_ref_games.get(team, 0) < RECENT_N else hist[hist["season"] == team_ref[team]]
                if len(win) < spec["min_starts"]:
                    continue
            usage_recent = hist.tail(RECENT_N)[spec["usage"]].sum(axis=1).mean()
            # featured-player ranking: TOTAL usage in the team's last RECENT_N games, so a one-game
            # backup or a player who missed games ranks below the regular starter
            in_last = hist[(hist["team"] == team) & hist["game_id"].isin(team_last.get(team, set()))]
            usage_team = float(in_last[spec["usage"]].sum(axis=1).sum())
            rank = (float(hist[spec["rank"]].sum(axis=1).sum()) if spec.get("rank") else usage_team, usage_team)
            entry = {"id": str(pid), "player": str(lt["player"]),
                     "position": str(lt["position"]) if "position" in lt and pd.notna(lt["position"]) else spec["role"],
                     "role": spec["role"], "games_last": int(n), "w": round(w, 4), "usage_adj": round(u, 4),
                     "usage_recent": round(float(usage_recent), 3),
                     "usage_team_last": round(usage_team, 3),
                     "stats": {s: round(float(v), 3) for s, v in proj.items()},
                     "_rank": rank}
            out.setdefault(team, []).append(entry)
    # keep the top-usage players per role
    final = {}
    for team, lst in out.items():
        keep = []
        for spec in player_spec(sport):
            cand = sorted([e for e in lst if e["role"] == spec["role"]],
                          key=lambda e: (-e["_rank"][0], -e["_rank"][1], -e["usage_recent"], e["player"]))
            keep += cand if spec["top"] is None else cand[: spec["top"]]
        final[team] = [{k: v for k, v in e.items() if k != "_rank"} for e in keep]
    extra = {}
    if sport == "nhl":
        extra = goalie_projections(ref)
        for team, gl in extra.items():
            final.setdefault(team, []).extend(gl)
    return final, ref


def goalie_projections(ref):
    k = CFG["nhl"]["proj_k"]
    g = pd.read_csv(DATA / "nhl_goalie_starts.csv", dtype={"goalie_id": str})
    g = g[(g["started"] == 1) & g["season"].isin([ref, ref - 1]) & (g["shots_against"] > 0)].sort_values("date")
    out = {}
    last = g.groupby("goalie_id").tail(1).set_index("goalie_id")
    tg = g[["team", "date", "game_id"]].drop_duplicates().sort_values(["date", "game_id"])
    team_last = {t: set(d["game_id"].tail(RECENT_N)) for t, d in tg.groupby("team")}
    team_ref = g.groupby("team")["season"].max()
    team_ref_games = g[g["season"] == g["team"].map(team_ref)].groupby("team")["game_id"].nunique()
    for gid, hist in g.groupby("goalie_id"):
        lt = last.loc[gid]
        t_ref = int(team_ref[lt["team"]])
        # 3+ starts in the team's latest season (early in a season, over the whole base window)
        win = hist if team_ref_games.get(lt["team"], 0) < RECENT_N else hist[hist["season"] == t_ref]
        if int(lt["season"]) != t_ref or len(win) < 3:
            continue
        L = hist.tail(RECENT_N)
        n = len(L)
        w = n / (n + k)
        svL = L["saves"].sum() / L["shots_against"].sum()
        svS = hist["saves"].sum() / hist["shots_against"].sum()
        out.setdefault(lt["team"], []).append({
            "id": str(gid), "player": str(lt["goalie"]), "position": "G", "role": "goalie", "games_last": int(n),
            "w": round(w, 4), "usage_adj": 1.0, "usage_recent": float((hist["season"] == ref).sum()),
            "usage_team_last": float(((hist["team"] == lt["team"]) & hist["game_id"].isin(team_last.get(lt["team"], set()))).sum()),
            "stats": {"save_pct": round(float(w * svL + (1 - w) * svS), 4)}})
    for t in out:  # starts in the team's last RECENT_N games, then starts this season
        out[t] = sorted(out[t], key=lambda e: (-e["usage_team_last"], -e["usage_recent"], e["player"]))[:2]
    return out


def projection_backtest(sport):
    """Latest completed season in the player file: formula vs. season-to-date average,
    predicting each game from strictly earlier games (players with >= 5 prior games)."""
    k = CFG[sport]["proj_k"]
    p = load_players(sport)
    seasons = sorted(p["season"].unique())
    # evaluate on the latest season with a full slate (the in-progress season is too short)
    test = seasons[-1]
    if len(seasons) >= 2 and (p["season"] == seasons[-1]).sum() < 0.5 * (p["season"] == seasons[-2]).sum():
        test = seasons[-2]
    res = {}
    for spec in player_spec(sport):
        sub = p if not spec["filter"] else p[p[spec["filter"][0]].isin(spec["filter"][1])]
        sub = sub[sub["season"].isin([test, test - 1])]
        errs = {s: [[], []] for s in spec["stats"]}
        for pid, hist in sub.groupby("player_id"):
            hist = hist.reset_index(drop=True)
            idx = np.where(hist["season"] == test)[0]
            for i in idx:
                prior = hist.iloc[:i]
                if len(prior) < 5:
                    continue
                cur = prior[prior["season"] == test]
                naive_src = cur if len(cur) else prior
                r = blend(prior, spec["stats"], spec["usage"], k)
                if r is None:
                    continue
                proj = r[0]
                for s in spec["stats"]:
                    actual = hist.at[i, s]
                    if pd.isna(actual):
                        continue
                    errs[s][0].append(abs(proj[s] - actual))
                    errs[s][1].append(abs(naive_src[s].mean() - actual))
        res[spec["role"]] = {s: {"n": len(v[0]), "mae_formula": r4(np.mean(v[0])) if v[0] else None,
                                  "mae_season_to_date_avg": r4(np.mean(v[1])) if v[1] else None}
                             for s, v in errs.items()}
    return {"season": int(test), "method": "each player-game predicted from strictly earlier games; players with >= 5 prior games",
            "by_role": res}


# ----------------------------------------------------------------------------
# export helpers
# ----------------------------------------------------------------------------

def export_state(sport, st, next_season, R, names):
    teams = {}
    for t, ts in st["teams"].items():
        elo = ts["elo"]
        if ts["last_season"] != next_season:
            elo = elo * (1 - R) + 1500.0 * R  # the next game opens a new season
        d = {"name": names.get(t, t), "elo": round(elo, 3),
             "last_day": ts["last_day"],
             "last_date": (EPOCH.fromordinal(EPOCH.toordinal() + ts["last_day"])).isoformat() if ts["last_day"] is not None else None,
             "last_season": int(ts["last_season"]),
             "recent": [[float(x[0]), float(x[1]), float(x[2]), float(x[3])] for x in ts["recent"]]}
        if sport == "epl":
            d["att"], d["def"] = round(ts["att"], 5), round(ts["def"], 5)
        teams[t] = d
    return teams


def predict_from_json(sport, model, home, away, day, neutral, hkey=None, akey=None):
    """Python mirror of js/predict.js working ONLY from the exported JSON."""
    st = {"teams": model["teams"], "league": model["league"], "elo_constants": model["elo"],
          "starters": {}, "goalies": {}}
    if sport == "mlb":
        st["starters"] = {k: {"ra": v["ra"]} for k, v in model["starters"].items()}
    if sport == "nhl":
        st["goalies"] = {k: {"sv": v["sv"]} for k, v in model["goalies"].items()}
    x = featurize(sport, st, home, away, day, neutral, hkey, akey)
    return from_features(sport, model, x), x


def from_features(sport, model, x):
    m = model["model"]
    z = [(x[f] - mu) / sd for f, mu, sd in zip(m["features"], m["mean"], m["std"])]
    dot = lambda coef, b: sum(c * v for c, v in zip(coef, z)) + b
    out = {"margin": dot(m["margin"]["coef"], m["margin"]["intercept"]),
           "total": dot(m["total"]["coef"], m["total"]["intercept"])}
    if sport == "epl":
        logits = [dot(c, b) for c, b in zip(m["win"]["coef"], m["win"]["intercept"])]
        mx = max(logits)
        ex = [math.exp(v - mx) for v in logits]
        s = sum(ex)
        pr = {c: e / s for c, e in zip(m["win"]["classes"], ex)}
        out.update(pH=pr["H"], pD=pr["D"], pA=pr["A"])
    else:
        out["pH"] = 1 / (1 + math.exp(-dot(m["win"]["coef"], m["win"]["intercept"])))
    return out


# ----------------------------------------------------------------------------
# main
# ----------------------------------------------------------------------------

def market_era(g, completed, holdout_seasons):
    """If the holdout lacks market win probabilities, pick the last two completed
    seasons where >= 80% of games have them."""
    col = "odds_h" if g["sport_"].iloc[0] == "epl" else "p_mkt_home"
    cov = g.groupby("season")[col].apply(lambda s: s.notna().mean())
    hold_cov = cov.loc[holdout_seasons].mean()
    if hold_cov >= 0.5:
        return None
    good = [s for s in completed if s < min(holdout_seasons) and cov.get(s, 0) >= 0.8]
    return good[-2:] if len(good) >= 2 else None


def write_predictions(sport, fit, X, g, st, first_train, holdout, hold_start, in_prog, completed):
    """One row per game since the sport's first season: the exported model's pre-game prediction
    (features use only information available before the game), the result and the market.
    split: burn-in = Elo warm-up seasons, never used for training; train = in-sample (the model was fit
    on these seasons); holdout = out-of-sample backtest seasons; current = season in progress."""
    pr = fit.predict(X)
    season = g["season"]
    comp = season.isin(completed)
    split = np.select(
        [season < first_train, season.isin(holdout), season == (in_prog if in_prog is not None else -1),
         comp & (season >= first_train) & (season < hold_start)],
        ["burn-in", "holdout", "current", "train"], default="other")
    pe = st["pre_elo"]
    out = pd.DataFrame({
        "game_id": g["game_id"].values,
        "date": [d.isoformat() for d in g["date"]],
        "season": season.values,
        "type": np.where(g["game_type"] == "playoff", "P", "R"),
        "home": g["home"].values, "away": g["away"].values,
        "hs": g["hs"].values, "as": g["as_"].values,
        "neutral": g["neutral"].values,
        "p_home": np.round(pr["pH"], 4),
    })
    if sport == "epl":
        out["p_draw"] = np.round(pr["pD"], 4)
    out["pred_margin"] = np.round(pr["margin"], 2)
    out["pred_total"] = np.round(pr["total"], 2)
    out["elo_home_pre"] = np.round(pe[:, 0], 1)
    out["elo_away_pre"] = np.round(pe[:, 1], 1)
    out["home_line"] = g["home_line"].values
    out["total_line"] = g["total_line"].values
    if sport == "epl":
        out["odds_h"], out["odds_d"], out["odds_a"] = g["odds_h"].values, g["odds_d"].values, g["odds_a"].values
    else:
        out["mkt_p_home"] = np.round(g["p_mkt_home"].astype(float).values, 4)
        out["home_ml"], out["away_ml"] = g["home_ml"].values, g["away_ml"].values
    out["split"] = split
    assert (out["split"] != "other").all(), f"{sport}: unlabelled prediction rows"
    path = DATA / f"predictions_{sport}.csv"
    out.to_csv(path, index=False, lineterminator=chr(10))
    # the holdout rows must reproduce the backtest's log loss (probabilities are rounded to 4 dp in the file)
    h = out[out["split"] == "holdout"]
    m = (h["hs"] - h["as"]).to_numpy(float)
    if sport == "epl":
        P = np.column_stack([h["p_home"], h["p_draw"], 1 - h["p_home"] - h["p_draw"]])
        Y = np.column_stack([m > 0, m == 0, m < 0]).astype(float)
        ll = ll3(P, Y)
    else:
        k = m != 0
        ll = ll2(h["p_home"].to_numpy(float)[k], (m[k] > 0).astype(float))
    print(f"[{sport}] predictions: {len(out):,} games -> {path.name} ({path.stat().st_size / 1e6:.1f} MB); "
          f"holdout log loss from the file {ll:.5f}")
    return ll


def train(sport):
    c = CFG[sport]
    g = load_games(sport)
    g["sport_"] = sport
    completed, in_prog = season_status(sport, g)
    holdout = completed[-2:]
    hold_start = holdout[0]
    era = market_era(g, completed, holdout)
    tune_end = min(hold_start, era[0]) if era else hold_start
    print(f"[{sport}] seasons {completed[0]}-{completed[-1]} completed, in progress: {in_prog}; holdout {holdout}; market era {era}")
    elo_c = tune_elo(sport, g, tune_end)
    print(f"[{sport}] Elo constants {elo_c}")
    X, elo_exp, st = run_pipeline(sport, g, elo_c)
    first_train = c["first"] + BURN_IN_SEASONS
    comp = g["season"].isin(completed)
    train_mask = comp & (g["season"] >= first_train) & (g["season"] < hold_start)
    hold_mask = g["season"].isin(holdout)
    fit = Fitted(sport, X, g, train_mask)
    tm = (g.loc[train_mask, "hs"] - g.loc[train_mask, "as_"]).to_numpy()
    if sport == "epl":
        fit.class_freq = [float(np.mean(tm > 0)), float(np.mean(tm == 0)), float(np.mean(tm < 0))]
    else:
        fit.home_rate = float(np.mean(tm[tm != 0] > 0))
    hold_eval, hold_pr = evaluate(sport, fit, X, g, hold_mask, "holdout: last two completed seasons")
    era_eval = None
    if era:
        era_train = comp & (g["season"] >= first_train) & (g["season"] < era[0])
        fit_era = Fitted(sport, X, g, era_train)
        tme = (g.loc[era_train, "hs"] - g.loc[era_train, "as_"]).to_numpy()
        if sport == "epl":
            fit_era.class_freq = [float(np.mean(tme > 0)), float(np.mean(tme == 0)), float(np.mean(tme < 0))]
        else:
            fit_era.home_rate = float(np.mean(tme[tme != 0] > 0))
        era_eval, _ = evaluate(sport, fit_era, X, g, g["season"].isin(era),
                               f"market-era backtest: model trained on {first_train}-{era[0] - 1}, tested on {era[0]}-{era[-1]}")
        era_eval["train_seasons"] = f"{first_train}-{era[0] - 1}"
    series = per_season(sport, fit, X, elo_exp, g, comp & (g["season"] >= first_train), hold_start)

    # ---- export model json ----
    next_season = in_prog if in_prog is not None else completed[-1] + 1
    names = TEAM_NAMES.get(sport, {})
    # active = every team of the last completed season plus any team seen in the season in progress,
    # so on a new season's opening night teams that haven't played yet keep their (regressed) rating
    recent_seasons = g["season"] >= completed[-1]
    active = set(g.loc[recent_seasons, "home"]) | set(g.loc[recent_seasons, "away"])
    teams = export_state(sport, st, next_season, elo_c["season_regression"], names)
    teams = {t: v for t, v in teams.items() if t in active}
    players, ref_season = project_players(sport)
    model = {
        "sport": sport, "version": 1, "trained_at": g["date"].max().isoformat(),
        "spans": {"first_season": int(g["season"].min()), "train": f"{first_train}-{hold_start - 1}",
                  "holdout": f"{holdout[0]}-{holdout[-1]}", "in_progress_season": in_prog,
                  "state_through": g["date"].max().isoformat(), "next_season": int(next_season)},
        "elo": {**elo_c, "base": 1500, "mov_multiplier": "ln(|margin|+1) * 2.2 / (0.001 * winner_elo_edge + 2.2)",
                "win_expectancy": "1 / (1 + 10^(-elo_diff/400))"},
        "constants": {"recent_n": RECENT_N, "rest_cap": c["rest_cap"], "b2b": c["b2b"], "lg_n": c["lg_n"],
                      "sp_prior": SP_PRIOR, "sp_n": SP_N, "g_prior_shots": G_PRIOR_SHOTS, "g_n": G_N, "ew_alpha": EW_ALPHA},
        "edge_threshold": EDGE_THRESHOLD,
        "edge_rationale": "An edge is flagged only when the model's win probability exceeds the no-vig market probability "
                          "by more than 3 percentage points. The threshold was fixed before any holdout result was seen; "
                          "it is roughly one sportsbook margin, so smaller gaps are treated as noise.",
        "league": {"lg_total": round(st["league"]["lg_total"], 5), "lg_sv": round(st["league"]["lg_sv"], 6)},
        "model": fit.export(),
        "teams": teams,
        "players": players,
        "player_reference_season": ref_season,
        "player_formula": ("projection = w * mean(last n games, n <= 10) + (1 - w) * mean(base window) * u; "
                           f"w = n / (n + {c['proj_k']}); base window = the player's games in the reference season and "
                           "the season before; u = mean usage over the last n games / mean usage over the base window, "
                           "clipped to [0.5, 1.5]; usage = " + ", ".join(
                               f"{s['role']}: {'+'.join(s['usage'])}" for s in player_spec(sport))
                           + (". Goalie save % = w * saves/shots over the last n starts + (1 - w) * saves/shots over the base window."
                              if sport == "nhl" else "")
                           + ". Featured players per team: " + "; ".join(
                               f"{s['role']}: top {s['top'] or 'all'}"
                               + (f" ({'/'.join(s['filter'][1])})" if s["filter"] and s["filter"][0] == "position" else "")
                               + (f" by {'+'.join(s['rank'])} over the base window" if s.get("rank")
                                  else f" by total {'+'.join(s['usage'])} over the team's last {RECENT_N} games")
                               for s in player_spec(sport))
                           + (f"; goalies: top 2 by starts in the team's last {RECENT_N} games" if sport == "nhl" else "")
                           + (" (MLB pitchers: every pitcher with 3+ starts this season)" if sport == "mlb" else "")
                           + "."),
    }
    if sport == "mlb":
        recent_cut = day_num(date(int(next_season) - 1, 1, 1))
        model["starters"] = {k: {"name": v["name"], "ra": [int(x) for x in v["ra"]]}
                             for k, v in st["starters"].items() if v["last_day"] and v["last_day"] >= recent_cut}
    if sport == "nhl":
        recent_cut = day_num(date(int(next_season) - 1, 7, 1))
        model["goalies"] = {k: {"name": v["name"], "sv": v["sv"]}
                            for k, v in st["goalies"].items() if v["last_day"] and v["last_day"] >= recent_cut}
    path = ROOT / f"model_{sport}.json"
    path.write_text(json.dumps(model, separators=(",", ":"), default=jdefault))
    model = json.loads(path.read_text())  # parity uses exactly what the site loads

    # ---- parity samples ----
    rng = np.random.default_rng(7)
    hold_idx = np.where(hold_mask.to_numpy())[0]
    samp = rng.choice(hold_idx, size=min(20, len(hold_idx)), replace=False)
    parity = []
    for i in samp:
        x = {k: float(v) for k, v in X.iloc[i].items()}
        pj = from_features(sport, model, x)
        parity.append({"features": x, "expected": {k: round(v, 12) for k, v in pj.items()}})
    tlist = sorted(teams)
    state_samples = []
    day0 = day_num(g["date"].max()) + 3
    for j in range(10):
        h, a = tlist[(3 * j) % len(tlist)], tlist[(3 * j + 7) % len(tlist)]
        hk = ak = None
        if sport == "mlb" and model.get("starters"):
            ks = sorted(model["starters"])
            hk, ak = ks[(5 * j) % len(ks)], (None if j % 3 == 0 else ks[(5 * j + 11) % len(ks)])
        if sport == "nhl" and model.get("goalies"):
            ks = sorted(model["goalies"])
            hk, ak = ks[(5 * j) % len(ks)], (None if j % 3 == 0 else ks[(5 * j + 11) % len(ks)])
        dstr = EPOCH.fromordinal(EPOCH.toordinal() + day0 + j).isoformat()
        pj, x = predict_from_json(sport, model, h, a, day0 + j, j == 4, hk, ak)
        state_samples.append({"home": h, "away": a, "date": dstr, "neutral": j == 4,
                              "homeStarter": hk, "awayStarter": ak,
                              "expected": {k: round(v, 12) for k, v in pj.items()}})
    # sanity: JSON-path predictions match sklearn on the parity rows (rounding only)
    skl = fit.predict(X.iloc[samp])
    worst = max(abs(skl["pH"][n] - parity[n]["expected"]["pH"]) for n in range(len(samp)))

    backtest = {
        "sport": sport, "generated_at": g["date"].max().isoformat(),  # latest game date: reruns on the same data give identical files
        "edge_threshold": EDGE_THRESHOLD,
        "train_seasons": f"{first_train}-{hold_start - 1}", "train_games": fit.n_train,
        "holdout": hold_eval,
        "market_era": era_eval,
        "per_season": series,
        "elo": elo_c,
        "player_projection_check": projection_backtest(sport),
        "parity_samples": parity,
        "state_samples": state_samples,
        "json_vs_sklearn_max_abs_diff_pH": float(worst),
        "notes": [
            "Holdout seasons were never used to choose Elo constants, features or coefficients.",
            f"Elo constants were chosen on seasons {elo_c['tuned_on']}.",
            f"The first {BURN_IN_SEASONS} seasons are Elo burn-in and are not used for training.",
            "Win probability evaluation drops tied games (NFL ties; NHL ties before 2005-06)." if sport != "epl" else
            "EPL is evaluated as a three-way home/draw/away forecast.",
            "Market probabilities are no-vig: each side's implied probability divided by the sum of both (or all three) sides.",
            "ROI at -110 is shown only for NFL/NBA spreads and totals, where -110 is the standard price; run lines, puck lines "
            "and Asian handicaps carry varying prices that are not in the data, so only hit rates are reported for them.",
        ],
    }
    (ROOT / f"backtest_{sport}.json").write_text(json.dumps(backtest, indent=1, default=jdefault))
    ll_file = write_predictions(sport, fit, X, g, st, first_train, holdout, hold_start, in_prog, completed)
    assert r4(ll_file) == hold_eval["win_model"]["log_loss"],         f"{sport}: predictions file holdout log loss {ll_file} != backtest {hold_eval['win_model']['log_loss']}"
    summarize(sport, backtest, path)
    return backtest


def summarize(sport, b, path):
    h = b["holdout"]
    print(f"\n==== {sport.upper()} holdout {h['seasons']} ({h['games']} games) ====")
    print(f" model log-loss {h['win_model']['log_loss']}  brier {h['win_model']['brier']}  acc {h['win_model']['accuracy']}")
    print(f" baseline log-loss {h['baseline']['log_loss']}")
    if "market" in h:
        m = h["market"]
        print(f" vs market on {m['games']} games: model {m['log_loss_model_same_games']} market {m['log_loss_market']}")
    if "line" in h:
        print(f" margin MAE model {h['line']['margin_mae_model']} line {h['line']['margin_mae_market_line']}  side {h['line']['model_side_vs_line']}")
    if "totals" in h:
        print(f" total MAE model {h['totals']['total_mae_model']} line {h['totals']['total_mae_market_line']}  side {h['totals']['model_side_vs_total']}")
    for k in ("edge_bets_moneyline", "edge_bets_1x2"):
        if k in h:
            print(f" {k}: {h[k]}")
    if b["market_era"]:
        e = b["market_era"]
        print(f" MARKET ERA {e['seasons']}: {e.get('market')}")
        for k in ("edge_bets_moneyline", "edge_bets_1x2"):
            if k in e:
                print(f"   {k}: {e[k]}")
    print(f" json-vs-sklearn max diff {b['json_vs_sklearn_max_abs_diff_pH']:.2e}; model file {path.stat().st_size / 1e6:.2f} MB")
    print(f" projections: {json.dumps(b['player_projection_check']['by_role'])[:400]}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sport", choices=list(CFG))
    ap.add_argument("--all", action="store_true")
    a = ap.parse_args()
    sports = list(CFG) if a.all else [a.sport]
    for s in sports:
        if s is None:
            ap.error("give --sport or --all")
        train(s)


if __name__ == "__main__":
    main()
