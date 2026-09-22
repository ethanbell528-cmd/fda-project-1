# The Closing Line

**Can a simple model beat Vegas?** A two-page data website that covers NFL, NBA, MLB, NHL and English Premier League games from 1990 to today. It compares a statistical model's predictions with the betting market, both historically and on today's games.

Built by **Ethan Bell** for Financial Data Analytics (Data Website Project).

- Live site: https://ethanbell528-cmd.github.io/fda-project-1/
- Report: `index.html`. Dashboard: `dashboard.html`.

> Educational project, not betting advice. Odds are displayed for comparison only. The site never places bets, has no sportsbook links, and only reads public data with HTTP GET.

## The data set

One row is **one team in one game**. Every game appears twice, once from each side. The panel has 24 columns: date, season, sport, team, opponent, home/away, score for/against, result, margin, total, how the game was decided, the line, total line, moneyline or 1X2 odds, no-vig implied win probability, and the result against the line and the total.

| Sport | Team-game rows | Scores | Spread / handicap | Total line | Moneyline / 1X2 | Player-game rows | Player seasons |
|---|---|---|---|---|---|---|---|
| NFL | 18,974 | 1990–2026 | 1990–2026 | 1990–2026 | 2006–2026 | 2024–2026 | 1999–2026 |
| NBA | 90,370 | 1990-91–2025-26 | 2007-08–2025-26 | 2007-08–2025-26 | 2007-08–2021-22 | 2024-25–2025-26 | 2001-02–2025-26 |
| MLB | 173,476 | 1990–2026 | run line 2014–2021 | 2010–2021 | 2010–2021 | 2024–2026 | 1990–2026 |
| NHL | 86,380 | 1990-91–2025-26 | puck line 2014-15–2022-23 | 2007-08–2022-23 | 2007-08–2022-23 | 2024-25–2025-26 | 1990-91–2025-26 |
| EPL | 25,508 | 1993-94–2026-27 | Asian handicap 2005-06– | 2.5 goals, 2002-03– | 1X2 2000-01– (closing 2019-20–) | 2024-25–2026-27 | 2016-17–2026-27 |
| **Total** | **394,708** | | | | | | |

Where a field starts later, the cell is left blank and shown as "n/a". Nothing is filled in or estimated. The main gaps are the MLB odds after 2021, the NHL odds after 2022-23, NBA player games before 2001-02 and NFL player stats before 1999. No free archive covers them.

Course requirements, printed by `scripts/clean_data.py`: rows ≥ 50,000 (394,708 combined), columns ≥ 8 (24), time periods ≥ 5 (34–37 seasons per sport), groups ≥ 10 (30–51 teams per sport). All pass.

## Data sources

| Data | Source |
|---|---|
| NFL games 1990–1998 with spread and total | spreadspoke "NFL scores and betting data" (Kaggle), GitHub mirror: https://github.com/RussellHerzog/nfl_game_outcomes |
| NFL games 1999+, lines, weekly player stats | nflverse (CC-BY-4.0): https://github.com/nflverse/nflverse-data/releases |
| NBA games 1990-91 to 2000-01 | FiveThirtyEight NBA Elo data (CC-BY-4.0): https://github.com/fivethirtyeight/data/tree/master/nba-elo |
| NBA games, box scores 2001-02+, closing lines 2022-23+ | hoopR / SportsDataverse, ESPN data (CC-BY-4.0): https://github.com/sportsdataverse/hoopR-nba-data |
| NBA odds 2007-08 to 2021-22 | SportsbookReviewsOnline archive files, mirror: https://github.com/DillonKoch/Sports_Betting |
| MLB games 1990–2025, starting pitchers, player games | Retrosheet: https://www.retrosheet.org (notice below) |
| MLB 2026 games and box scores | MLB Stats API: https://statsapi.mlb.com/api/v1/schedule |
| MLB player id crosswalk | Chadwick Bureau register: https://github.com/chadwickbureau/register |
| MLB odds 2010–2021 | SportsbookReviewsOnline: https://www.sportsbookreviewsonline.com |
| NHL games, skater and goalie logs | NHL Stats API: https://api.nhle.com/stats/rest/en/game |
| NHL odds 2007-08 to 2022-23 | SportsbookReviewsOnline via the Internet Archive: https://web.archive.org/web/2023/https://www.sportsbookreviewsonline.com/ |
| EPL results and odds | Football-Data.co.uk: https://www.football-data.co.uk/englandm.php |
| EPL player goals and assists | vaastav Fantasy Premier League archive: https://github.com/vaastav/Fantasy-Premier-League |
| Live scores and fallback odds | ESPN public scoreboard: `https://site.api.espn.com/apis/site/v2/sports/<sport>/<league>/scoreboard` |
| Live odds, optional | The Odds API: https://the-odds-api.com |

*The information used here was obtained free of charge from and is copyrighted by Retrosheet. Interested parties may contact Retrosheet at www.retrosheet.org.*

## Reproduce everything

```bash
python -m venv .venv && .venv/Scripts/activate   # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt                  # Python 3.12
python scripts/download_data.py                  # raw sources into data/raw/ (about 1 GB, gitignored)
python scripts/clean_data.py                     # data/<sport>*.csv + data/coverage.json + checks
python scripts/train_model.py --all              # model_<sport>.json + backtest_<sport>.json
node   scripts/check_predict_parity.js           # JS predictions equal Python predictions
python scripts/build_report_data.py              # data/report/*.json used by the report page
python -m http.server 8000                       # open http://localhost:8000
```

Deleting `data/` and every `model_*.json` and rerunning these steps rebuilds the same site. The only exception is the in-progress 2026 seasons, which grow as new games are played. The raw sources are only downloaded when missing, so delete `data/raw/<sport>` to pull fresh games.

## Live odds key

The site works without a key. It then uses the odds in ESPN's public scoreboard, labeled "odds via ESPN", and shows "n/a" when no line is posted. To use The Odds API free tier locally, copy `config.example.js` to `config.js` and paste your key. `config.js` is gitignored and never committed, so the published site always uses the ESPN fallback. Requests are GET only, and responses are cached in memory for 60 seconds across sports to protect the free quota.

## Files

| File | What it does |
|---|---|
| `index.html` | Report page: summary, headline numbers, findings with charts, methodology |
| `dashboard.html` | Dashboard: sport tabs, filters, measure/breakdown switches, charts, table, reset, live games panel |
| `css/style.css` | Shared fonts, colors (light and dark), layout for both pages |
| `js/site.js` | Shared helpers: theme toggle, sport metadata, number formatting, CSV/JSON loading, Chart.js defaults |
| `js/report.js` | Renders the report's text numbers, tiles and charts from `data/report/*.json` |
| `js/dashboard.js` | Loads one sport's CSV, applies filters, computes the tiles, charts and table in the browser |
| `js/live.js` | Live panel: ESPN scoreboard, optional Odds API, team-code mapping, model vs. market cards |
| `js/predict.js` | In-browser model inference per sport, plus Elo and odds math utilities |
| `config.example.js` | Template for the optional Odds API key (copy to `config.js`) |
| `model_<sport>.json` | Exported model per sport: Elo constants and current ratings, scaling, coefficients, player projections, edge threshold |
| `backtest_<sport>.json` | Holdout results per sport: log-loss, Brier, MAE vs. lines, against-the-line records, calibration, parity samples |
| `data/<sport>.csv` | The panel: one row per team per game (nfl, nba, mlb, nhl, epl) |
| `data/<sport>_players.csv` | Player-game stats for recent seasons (feeds the projections) |
| `data/<sport>_player_seasons.csv` | Player-season totals over each sport's full span |
| `data/mlb_starters.csv` | Starting pitcher for every MLB team-game |
| `data/nhl_goalie_starts.csv` | Every NHL goalie appearance with start flag, shots and saves |
| `data/coverage.json` | Verification numbers, honest spans and rows-dropped notes per sport |
| `data/report/*.json` | Small precomputed summaries the report page reads (it never loads raw CSVs) |
| `scripts/config.py` | Panel column definitions and sport list (adding a sport starts here) |
| `scripts/common.py` | Download helpers, odds math, game-to-team-row expansion, integrity checks |
| `scripts/sports/<sport>.py` | One module per sport: `download()` and `clean()` with every source URL |
| `scripts/download_data.py` | Step 1: downloads raw data for all or selected sports |
| `scripts/clean_data.py` | Step 2: writes the CSVs and prints the course verification checks |
| `scripts/train_model.py` | Step 3: Elo and models per sport, holdout backtests, JSON export |
| `scripts/check_predict_parity.js` | Checks that `js/predict.js` reproduces the Python predictions |
| `scripts/build_report_data.py` | Step 4: builds the report summaries in `data/report/` |
| `requirements.txt` | Pinned Python dependencies |
| `.gitignore` | Keeps raw downloads, the virtual environment and `config.js` out of the repo |

## Adding a sport

Add an entry to `SPORTS` in `scripts/config.py`. Write `scripts/sports/<sport>.py` with `download()` and `clean()` returning the panel via `common.to_panel`. Add its model block to `train_model.py`, then give it a tab entry in `js/site.js`. No existing code needs to change.
