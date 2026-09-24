# The Closing Line

**Can a simple model beat Vegas?** A two-page data website that covers NFL, NBA, MLB, NHL and English Premier League games from 1990 to today. It compares a statistical model's predictions with the betting market, both historically and on today's games.

Built by **Ethan Bell** for Financial Data Analytics (Data Website Project).

- Live site: https://ethanbell528-cmd.github.io/fda-project-1/
- Report: `index.html`. Dashboard: `dashboard.html`.

> Educational project, not betting advice. Odds are displayed for comparison only. The site never places bets, has no sportsbook links, and only reads public data with HTTP GET.

## What's on the site

**Report (`index.html`).** It opens with a scroll-driven 3D intro set in a night game. A generic purple #8 dual-threat quarterback takes the snap, drops back three steps and throws a spiral straight at the viewer as they scroll. The stadium is a two-tier bowl with purple seats, a lit suite band, ribbon boards, end-zone video boards, rooftop light rows and about 21,000 fans. All text in the stadium is generic, with no real team, player, sponsor or stadium names. A "Skip intro" link jumps past it. Below it, a scrolling report covers the summary, six headline numbers and ten findings, each with a chart and its data table. It ends with a methodology section listing every source and formula.

**3D Replays (`replays.html`).** Pick a sport and one of its recent finished games to watch a rotatable 3D replay rebuilt from ESPN's play-by-play. Every live or finished game card on the dashboard also has a "Watch 3D replay" button.

**Dashboard (`dashboard.html`).**
- **Sport tabs** for NFL, NBA, MLB, NHL and EPL load that sport's data file on demand.
- **Filters** cover season range, team, opponent, home/away, game type and result, with a reset button.
- **Six summary tiles and five charts** recalculate with the filters. A measure switch and a breakdown switch change what the charts show. A table lists the numbers behind the current view.
- **Games today: model vs. market.** Each game is a compact card with the score, the model's pick and the market odds. Click a card to open the full game in a large pop-up. It shows model win % against the market's no-vig odds, moneylines and fair odds, the model and market spread, and the total. Live games show in-game odds, labeled "(live)". The panel refreshes every 60 seconds.
- **3D replays.** Every live or finished game has a "Load 3D replay" button in its pop-up, for all five sports. It rebuilds the game on a 3D court, rink, field or pitch from ESPN's play-by-play locations: NBA shot spots with arcs to the rim, NHL shot and goal spots, MLB batted-ball arcs plus a strike-zone inset, NFL drives play by play, and EPL shots to goal. It has play/pause, a timeline scrubber, speed and period filters, a running scoreboard, rotate and zoom, and a text list of every play. Every play is shown in 3D and labeled as one of three kinds. Real positions are where ESPN recorded the play. Fixed rule spots include free throws on the free-throw line, strikeouts and walks at home plate, and penalties on the penalty spot. Everything else is a bead on a time-order rail along the near side, which is ordered by game time and is not a field position. Games with no recorded positions also get a scoring-flow band above the surface. The replay counts each kind, and the counts add up to all plays. It is not video or player tracking.
- **Games on any date.** A date picker loads any day's scoreboard, so past games can be replayed. Only today's board refreshes automatically.
- **Player pop-ups.** Inside a game, click any featured player to see that player's model projection next to the sportsbook prop. It shows the line, the over and under odds, the market's no-vig chance of the over, and the model's view. Once the game starts, it adds the actual stat.
- **Player projections table.** It lists every featured player's projected per-game stats, filterable by team, role and name. Click a name for the inputs behind the projection.

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
| 3D replays (play-by-play locations) | ESPN public game summary: `https://site.api.espn.com/apis/site/v2/sports/<sport>/<league>/summary?event=<id>` |
| Live player prop lines | ESPN public odds feed (sportsbook as listed by ESPN, e.g. DraftKings): `https://sports.core.api.espn.com/v2/sports/<sport>/leagues/<league>/events/<id>/competitions/<id>/odds/<provider>/propBets` |

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

Deleting `data/` and every `model_*.json` and rerunning these steps rebuilds the same site. The only exception is the seasons in progress, which grow as new games are played. The raw sources are only downloaded when missing. To pull the newest games, run `python scripts/refresh_current.py` before the other steps.

## Hourly refresh

A GitHub Actions workflow, `.github/workflows/refresh.yml`, keeps the site current. It runs every hour on the hour, but GitHub may start scheduled runs several minutes late when its servers are busy. Each run re-downloads only the current seasons' files and rebuilds the CSVs. If new games came in, it also retrains every model, checks that the JavaScript predictions still match Python, rebuilds the report summaries and commits the result to `main`, and GitHub Pages redeploys. That moves the current Elo ratings, rest days, recent form and player projections forward. An hour with no new games skips the retraining and commits nothing.

- **Runs never overlap.** A new run waits for the previous one to finish.
- **Season ranges come from the date.** When a new season starts, its files are fetched automatically. A file that isn't published yet is skipped with a note.
- **MLB switches sources automatically.** Seasons Retrosheet hasn't published yet come from the MLB Stats API. A newer Retrosheet archive is picked up once it appears.
- **Downloads are cached between runs.** The historical raw data, about 1 GB, is kept in the Actions cache. MLB box scores are cached per game and never downloaded twice. A new cache copy is saved only when new data arrived.
- **Run it by hand** from the repository's Actions tab. Choose "Hourly data refresh", then "Run workflow".

## Live odds

The site needs no key. Without one it reads ESPN's public feeds, all with HTTP GET only:
- **Pre-game odds** come from ESPN's scoreboard, labeled "odds via ESPN".
- **Live in-game odds** come from ESPN's core odds feed ("DraftKings - Live Odds"), because the scoreboard drops odds once a game starts. They are labeled "(live)".
- **Player prop lines and prices** come from the same core feed. ESPN lists each over/under pair with the over first, which was checked against 0.5 RBI, runs and walks lines, where the one-or-more side is always the longer price.
- When no line is posted, the site shows "n/a" or "no odds posted yet".

To use The Odds API free tier locally, copy `config.example.js` to `config.js` and paste your key. `config.js` is gitignored and never committed, so the published site always uses the ESPN feeds. Responses are cached in memory for 60 seconds across sports to protect the free quota.

## Files

| File | What it does |
|---|---|
| `index.html` | Report page: summary, headline numbers, findings with charts, methodology |
| `replays.html` | 3D Replays page: sport tabs, recent finished games, large 3D replay viewer |
| `js/intro3d.js` | Report-page intro: three.js night-game scene (jointed quarterback with two-bone IK throwing motion, procedural football, instanced crowd, bloom and tone mapping), scrubbed by scroll. Every model and texture is generated in code, with no external assets. It uses a lighter mode on narrow screens and removes itself if 3D can't load |
| `js/featured3d.js` | Finds each sport's recent finished games on ESPN and opens one in the 3D viewer on the replays page |
| `dashboard.html` | Dashboard: sport tabs, filters, measure/breakdown switches, charts, table, reset, live games panel, player projections |
| `css/style.css` | Shared fonts, colors (light and dark), layout for both pages |
| `js/site.js` | Shared helpers: theme toggle, sport metadata, number formatting, CSV/JSON loading, Chart.js defaults, the game and player pop-ups |
| `js/report.js` | Renders the report's text numbers, tiles and charts from `data/report/*.json` |
| `js/dashboard.js` | Loads one sport's CSV, applies filters, computes the tiles, charts and table in the browser |
| `js/live.js` | Live panel: ESPN scoreboard and core odds feed (pre-game and live odds), optional Odds API, team-code mapping, compact game cards, game pop-up, player props matched to ESPN rosters |
| `js/replay3d.js` | 3D game replays: fetches ESPN's play-by-play summary, maps each sport's coordinates onto a three.js court, rink, field or pitch (three.js loaded from jsDelivr only when a replay opens), with timeline controls and an accessible play list |
| `js/projections.js` | Player projections table on the dashboard, with a pop-up per player |
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
| `scripts/sports/<sport>.py` | One module per sport: `download()`, `clean()` and `current_files()`, with every source URL |
| `scripts/download_data.py` | Step 1: downloads raw data for all or selected sports |
| `scripts/clean_data.py` | Step 2: writes the CSVs and prints the course verification checks |
| `scripts/train_model.py` | Step 3: Elo and models per sport, holdout backtests, JSON export |
| `scripts/check_predict_parity.js` | Checks that `js/predict.js` reproduces the Python predictions |
| `scripts/build_report_data.py` | Step 4: builds the report summaries in `data/report/` |
| `scripts/refresh_current.py` | Re-downloads only the current seasons' raw files (each sport's `current_files()`) before a rebuild |
| `.github/workflows/refresh.yml` | Hourly GitHub Actions job: refresh, clean, then (only if data changed) train, parity check, report build, commit |
| `requirements.txt` | Pinned Python dependencies |
| `.gitignore` | Keeps raw downloads, the virtual environment and `config.js` out of the repo |

## Adding a sport

Add an entry to `SPORTS` in `scripts/config.py`. Write `scripts/sports/<sport>.py` with `download()`, `clean()` returning the panel via `common.to_panel`, and `current_files()` listing the raw files the hourly refresh re-downloads. Add its model block to `train_model.py`, then give it a tab entry in `js/site.js`. No existing code needs to change.
