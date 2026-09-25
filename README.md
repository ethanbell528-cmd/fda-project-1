# The Closing Line

**Can a simple model beat Vegas?** A two-page data website that covers NFL, NBA, MLB, NHL and English Premier League games from 1990 to today. It compares a statistical model's predictions with the betting market, both historically and on today's games.

Built by **Ethan Bell** for Financial Data Analytics (Data Website Project).

- Live site: https://ethanbell528-cmd.github.io/fda-project-1/
- Report: `index.html`. Dashboard: `dashboard.html`.

> Educational project, not betting advice. Odds are displayed for comparison only. The site never places bets, has no sportsbook links, and only reads public data with HTTP GET.

## What's on the site

**Report (`index.html`).** It opens with a scroll-driven 3D intro set in a night game. A generic purple #8 dual-threat quarterback takes the snap, drops back three steps and throws a spiral straight at the viewer as they scroll. The stadium is a two-tier bowl with purple seats, a lit suite band, ribbon boards, end-zone video boards, rooftop light rows and about 21,000 fans. All text in the stadium is generic, with no real team, player, sponsor or stadium names. A "Skip intro" link jumps past it. Below it, a scrolling report covers the summary, six headline numbers and ten findings, each with a chart and its data table. It ends with a methodology section listing every source and formula.

**Games & 3D Replays (`replays.html`).** Pick a sport and any date back to 1990 (EPL: August 1993) to see every game that day. Each card shows the model's pre-game prediction (win probability, spread and total; home/draw/away for EPL), the final score, the betting market when our sources have it, whether the model picked the winner, the result against the line and total, and whether the season was in-sample or out-of-sample for the model. Buttons jump to the previous or next game day, a random game, or the season's biggest upset. Clicking a game opens the full prediction and a 3D view: the rotatable play-by-play replay when ESPN has it, otherwise the final result on the correct surface (with the venue when ESPN names it, and the inning-by-inning line score for MLB). Below it, the latest finished games open straight into 3D. Every live or finished game card on the dashboard also has a "Watch 3D replay" button.

**Dashboard (`dashboard.html`).**
- **Sport tabs** for NFL, NBA, MLB, NHL and EPL load that sport's data file on demand.
- **Filters** cover season range, team, opponent, home/away, game type and result, with a reset button.
- **Six summary tiles and five charts** recalculate with the filters. A measure switch and a breakdown switch change what the charts show. A table lists the numbers behind the current view.
- **Games today: model vs. market.** Each game is a compact card with the score, the model's pick and the market odds. Click a card to open the full game in a large pop-up. It shows model win % against the market's no-vig odds, moneylines and fair odds, the model and market spread, and the total. Live games show in-game odds, labeled "(live)". The panel refreshes every 60 seconds.
- **3D replays.** Every live or finished game has a "Load 3D replay" button in its pop-up, for all five sports. It rebuilds the game on a 3D court, rink, field or pitch from ESPN's play-by-play locations: NBA shot spots with arcs to the rim, NHL shot and goal spots, MLB batted-ball arcs plus a strike-zone inset, NFL drives play by play, and EPL shots to goal. It has play/pause, a timeline scrubber, speed and period filters, a running scoreboard, rotate and zoom, and a text list of every play. Every play is shown in 3D and labeled as one of three kinds. Real positions are where ESPN recorded the play. Fixed rule spots include free throws on the free-throw line, strikeouts and walks at home plate, and penalties on the penalty spot. Everything else is a bead on a time-order rail along the near side, which is ordered by game time and is not a field position. Games with no recorded positions also get a scoring-flow band above the surface. The replay counts each kind, and the counts add up to all plays. It is not video or player tracking.
- **Real venues in the replays.** Each replay is drawn in the stadium or arena where that game was played, from `data/venues.json`. The venue line under the replay gives the name, city, roof, surface and capacity, with a link to its source. Ballparks use their published fence distances, such as Fenway's 310 ft left field and 302 ft right field, and their published wall heights where a source gives them, such as the 37 ft Green Monster and Houston's 19 ft left-field wall. Other wall segments are drawn at a standard 8 ft. EPL pitches use each ground's published size, such as Craven Cottage at 100 × 65 m, and ESPN's positions are scaled to it. Roofs are drawn by type: fixed domes and translucent roofs as see-through shells, and retractable roofs as open frames. Stands are schematic, with rows and tiers sized to the published capacity, because stand-by-stand layouts are not published consistently. A game at a venue not in the data gets a generic bowl, and the replay says so. As a check across 120 recent MLB games, 99.2% of home runs land at or beyond the drawn wall, and 89.2% of fly and line-drive outs land inside it.
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
| MLB games 1990–2025, starting pitchers, player games, inning line scores | Retrosheet: https://www.retrosheet.org (notice below) |
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
| Venue list for the 3D replays | ESPN public scoreboards (the venue id, name, city and indoor flag of every 2024–26 game in the five leagues) |
| Venue attributes (capacity, surface, roof, MLB fence distances, EPL pitch size) | Each venue's Wikipedia article infobox, pinned to one revision per venue (the revision link is stored in `data/venues.json`) |
| MLB wall heights | The sentence quoted per park in `scripts/venues_input.json`: Wikipedia articles, plus CBS Sports for Houston's left-field wall (https://www.cbssports.com/mlb/news/lets-get-to-know-houstons-minute-maid-park-the-train-and-that-odd-blue-house) |
| Live player prop lines | ESPN public odds feed (sportsbook as listed by ESPN, e.g. DraftKings): `https://sports.core.api.espn.com/v2/sports/<sport>/leagues/<league>/events/<id>/competitions/<id>/odds/<provider>/propBets` |

*The information used here was obtained free of charge from and is copyrighted by Retrosheet. Interested parties may contact Retrosheet at www.retrosheet.org.*

## Reproduce everything

```bash
python -m venv .venv && .venv/Scripts/activate   # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt                  # Python 3.12
python scripts/download_data.py                  # raw sources into data/raw/ (about 1 GB, gitignored)
python scripts/clean_data.py                     # data/<sport>*.csv + data/coverage.json + checks
python scripts/train_model.py --all              # model_<sport>.json + backtest_<sport>.json + data/predictions_<sport>.csv
node   scripts/check_predict_parity.js           # JS predictions equal Python predictions
python scripts/build_report_data.py              # data/report/*.json used by the report page
python scripts/build_venues.py                   # data/venues.json for the 3D replays (pinned Wikipedia revisions)
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
| `replays.html` | Games & 3D Replays page: every game since 1990 by date with the model's pre-game pick, plus the latest finished games in 3D |
| `js/history.js` | Historical game browser: loads `data/predictions_<sport>.csv`, lists a date's games, matches each to ESPN for the 3D view |
| `js/intro3d.js` | Report-page intro: three.js stadium scene where a purple #8 quarterback (the CC0 base-mesh body playing real CMU motion capture: a backpedal, then a pass) throws a spiral at the viewer, scrubbed by scroll, with N8AO contact shading and depth of field on desktop; removed automatically if 3D can't load |
| `assets/male_base_mesh.glb` | CC0 rigged human base mesh used for the intro's players (see Credits) |
| `assets/motion/qb_mocap.json` | The intro quarterback's motion: two CMU motion-capture clips baked to joint positions and rotations by `scripts/bake_mocap.py` |
| `scripts/bake_mocap.py` | Blender script that downloads the two CMU BVH clips and writes `assets/motion/qb_mocap.json` |
| `assets/env/moonless_golf_1k.hdr` | Night HDRI from the three.js GitHub examples: image-based lighting for the intro stadium, loaded lazily with a built-in fallback (see Credits) |
| `js/featured3d.js` | Finds each sport's recent finished games on ESPN and opens one in the 3D viewer on the replays page |
| `dashboard.html` | Dashboard: sport tabs, filters, measure/breakdown switches, charts, table, reset, live games panel, player projections |
| `css/style.css` | Shared fonts, colors (light and dark), layout for both pages |
| `js/site.js` | Shared helpers: theme toggle, sport metadata, number formatting, CSV/JSON loading, Chart.js defaults, the game and player pop-ups |
| `js/report.js` | Renders the report's text numbers, tiles and charts from `data/report/*.json` |
| `js/dashboard.js` | Loads one sport's CSV, applies filters, computes the tiles, charts and table in the browser |
| `js/live.js` | Live panel: ESPN scoreboard and core odds feed (pre-game and live odds), optional Odds API, team-code mapping, compact game cards, game pop-up, player props matched to ESPN rosters |
| `scripts/build_venues.py` | Builds `data/venues.json` from `scripts/venues_input.json`: fetches each venue's pinned Wikipedia revision and parses capacity, surface, roof, fence distances and pitch size; unknown values stay null |
| `scripts/venues_input.json` | Every venue ESPN used for a 2024–26 game (ESPN venue ids), its pinned Wikipedia revision, and hand-curated MLB wall heights with the quoted source sentence |
| `data/venues.json` | Venue attributes used by the 3D replays, each with its source link, revision and verification date |
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
| `data/mlb_linescores.csv` | Runs per inning (visitor and home) for every Retrosheet-era MLB game, from game-log fields 20–21 |
| `data/predictions_<sport>.csv` | The model's pre-game prediction for every game since the sport's first season (win probability, draw probability for EPL, predicted margin and total, pre-game Elo), with the final score, the market and a `split` label: `burn-in`, `train` (in-sample), `holdout` (out-of-sample backtest) or `current` |
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

## Credits

- **Human body model:** "Male Base Mesh" by [orange-juice-games](https://orange-juice-games.itch.io/male-base-mesh), dedicated to the public domain under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). Downloaded from [github.com/BoQsc/Godot-3D-Male-Base-Mesh](https://github.com/BoQsc/Godot-3D-Male-Base-Mesh) (`Original/male_base_mesh.glb`). The uniform, pads, helmet, numbers and motion are added in code.
- **3D library:** [three.js](https://threejs.org) r169 (MIT), loaded from jsDelivr.
- **Motion capture:** CMU Graphics Lab Motion Capture Database, subject 76 trial 11 (quick large steps backwards) and subject 79 trial 91 ("football"), BVH conversions from [github.com/una-dinosauria/cmu-mocap](https://github.com/una-dinosauria/cmu-mocap), baked by `scripts/bake_mocap.py` and retargeted onto the intro's player in the browser. The data used in this project was obtained from mocap.cs.cmu.edu. The database was created with funding from NSF EIA-0196217.
- **Ambient occlusion:** [N8AO](https://github.com/N8python/n8ao) 2.0.1 (ISC) with [postprocessing](https://github.com/pmndrs/postprocessing) 6.36.4 (Zlib), loaded from jsDelivr on desktop only.
- **Intro night lighting:** `moonless_golf_1k.hdr` from the [three.js examples](https://github.com/mrdoob/three.js/tree/dev/examples/textures/equirectangular) (three.js is MIT licensed); image-based lighting for the night-game intro, with a procedural fallback.
