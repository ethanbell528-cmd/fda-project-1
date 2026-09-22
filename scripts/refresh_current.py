"""Refresh step (run hourly by GitHub Actions): re-download only the raw files that change while a season is played.

Each sport module lists those files in current_files(raw_dir): the in-progress season's
schedule/results, box scores, odds and player files. This script deletes them and calls
the module's download(), which fetches them again (plus anything else still missing, such
as the first files of a season that has just started). Historical files are never touched.

Usage:  python scripts/refresh_current.py            # all sports
        python scripts/refresh_current.py nba epl    # selected sports
"""
import importlib
import sys
import time

from config import RAW, SPORTS


def main(argv):
    sports = argv or list(SPORTS)
    for s in sports:
        mod = importlib.import_module(f"sports.{s}")
        raw = RAW / s
        t0 = time.time()
        stale = [f for f in mod.current_files(raw) if f.exists()]
        backups = {}
        for f in stale:  # set aside (not deleted) so a failed download can't leave a hole
            b = f.with_name(f.name + ".bak")
            f.replace(b)
            backups[f] = b
        print(f"== {s.upper()}: set aside {len(stale)} current-season raw file(s); downloading")
        try:
            mod.download(raw)
        except Exception as e:  # keep the previous copy and carry on with the other sports
            print(f"   {s.upper()} download failed ({type(e).__name__}: {e}); keeping yesterday's files")
        for f, b in backups.items():
            if f.exists():
                b.unlink()
            else:
                b.replace(f)
        print(f"   {s.upper()} refreshed in {time.time() - t0:.0f}s")
    print("refresh complete")


if __name__ == "__main__":
    main(sys.argv[1:])
