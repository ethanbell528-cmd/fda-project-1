"""Shared configuration for every sport.

Adding a sport = a new entry in SPORTS + a scripts/sports/<sport>.py module
(download() and clean()) + a model block in train_model.py. No other code changes.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
DATA = ROOT / "data"

# Panel columns every data/<sport>.csv must have, in this order.
# One row = one team in one game (each game appears twice, once per side).
PANEL_COLUMNS = [
    "game_id",       # source game id, identical on both rows of a game
    "date",          # YYYY-MM-DD local game date
    "season",        # int: year the season STARTED (NBA 2024-25 -> 2024); NFL/MLB = season year
    "season_label",  # display label: "2024-25" or "2024"
    "sport",         # nfl | nba | mlb | nhl | epl
    "game_type",     # regular | playoff
    "team",          # franchise abbreviation (current franchise code, relocations mapped)
    "opponent",      # same coding as team
    "home_away",     # H | A | N (neutral site)
    "score_for",     # points / runs / goals scored by team
    "score_against",
    "result",        # W | L | T (NFL ties) | D (EPL draws)
    "margin",        # score_for - score_against
    "total",         # score_for + score_against
    "decided_in",    # REG | OT | SO (NHL shootout) | XI (MLB extra innings); blank if unknown
    "line",          # team handicap (spread / run line / puck line / Asian handicap); negative = team favored
    "total_line",    # game over/under line
    "moneyline",     # American odds for team to win (US sports)
    "odds_win",      # EPL decimal odds for team win (1X2); blank for US sports
    "odds_draw",     # EPL decimal odds for the draw; blank for US sports
    "implied_win",   # no-vig implied probability of team winning (2-way ML or 3-way 1X2)
    "line_result",   # cover | miss | push vs `line`; blank if no line
    "ou_result",     # over | under | push vs `total_line`; blank if no total line
    "favorite",      # 1 favored, 0 underdog (by line, else by implied_win); blank if no market data / pick'em
]

SPORTS = {
    "nfl": {"name": "NFL", "first_season": 1990, "season_style": "year"},
    "nba": {"name": "NBA", "first_season": 1990, "season_style": "split"},
    "mlb": {"name": "MLB", "first_season": 1990, "season_style": "year"},
    "nhl": {"name": "NHL", "first_season": 1990, "season_style": "split"},
    "epl": {"name": "EPL", "first_season": 1993, "season_style": "split"},
}


def season_label(season: int, style: str) -> str:
    return f"{season}-{str(season + 1)[-2:]}" if style == "split" else str(season)
