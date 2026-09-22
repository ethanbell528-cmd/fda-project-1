"""Step 2 of the pipeline: turn data/raw/<sport>/ into the committed CSVs.

Outputs per sport:
  data/<sport>.csv                one row per team per game (panel, see config.PANEL_COLUMNS)
  data/<sport>_players.csv        player-game rows, recent seasons (feeds projections)
  data/<sport>_player_seasons.csv player-season totals over the full honest span
  data/<sport>_<extra>.csv        optional sport-specific files (e.g. mlb_starters.csv)
  data/coverage.json              verification numbers + honest-span notes per sport

Then prints the course verification checks (rows >= 50,000, columns >= 8,
periods >= 5, groups >= 10) and exits non-zero if any fails.

Usage:  python scripts/clean_data.py            # all sports
        python scripts/clean_data.py nfl        # one sport (coverage.json is merged)
"""
import importlib
import json
import sys

from common import check_panel
from config import DATA, RAW, SPORTS


def main(argv):
    sports = argv or list(SPORTS)
    cov_path = DATA / "coverage.json"
    coverage = json.loads(cov_path.read_text()) if cov_path.exists() else {}
    for s in sports:
        mod = importlib.import_module(f"sports.{s}")
        print(f"== {s.upper()}: cleaning")
        out = mod.clean(RAW / s)
        panel = out["games"]
        stats = check_panel(panel, s)
        panel.to_csv(DATA / f"{s}.csv", index=False)
        out["players"].to_csv(DATA / f"{s}_players.csv", index=False)
        out["player_seasons"].to_csv(DATA / f"{s}_player_seasons.csv", index=False)
        for name, df in out.get("extras", {}).items():  # e.g. mlb_starters.csv
            df.to_csv(DATA / f"{s}_{name}.csv", index=False)
        stats["player_game_rows"] = len(out["players"])
        stats["player_season_rows"] = len(out["player_seasons"])
        stats["notes"] = out.get("notes", [])
        stats["spans"] = out.get("spans", {})
        coverage[s] = stats
    coverage = {k: coverage[k] for k in SPORTS if k in coverage}
    cov_path.write_text(json.dumps(coverage, indent=2))

    print("\nVERIFICATION (course data requirements)")
    hdr = f"{'sport':<5} {'rows':>8} {'cols':>5} {'seasons':>8} {'span':>11} {'teams':>6} {'line rows':>10}"
    print(hdr)
    print("-" * len(hdr))
    ok = True
    for s, st in coverage.items():
        span = f"{st['first_season']}-{st['last_season']}"
        print(f"{s:<5} {st['rows']:>8,} {st['columns']:>5} {st['seasons']:>8} {span:>11} {st['teams']:>6} {st['rows_with_line']:>10,}")
        ok &= st["columns"] >= 8 and st["seasons"] >= 5 and st["teams"] >= 10
    total = sum(st["rows"] for st in coverage.values())
    print("-" * len(hdr))
    print(f"combined team-game rows: {total:,}")
    checks = {
        "rows >= 50,000 (combined)": total >= 50_000,
        "columns >= 8 (every sport)": all(st["columns"] >= 8 for st in coverage.values()),
        "time periods >= 5 (every sport)": all(st["seasons"] >= 5 for st in coverage.values()),
        "group values >= 10 (every sport)": all(st["teams"] >= 10 for st in coverage.values()),
    }
    for k, v in checks.items():
        print(f"  [{'PASS' if v else 'FAIL'}] {k}")
    if not (ok and all(checks.values())):
        sys.exit(1)


if __name__ == "__main__":
    main(sys.argv[1:])
