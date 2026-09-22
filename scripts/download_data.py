"""Step 1 of the pipeline: download every raw source into data/raw/<sport>/.

Usage:  python scripts/download_data.py            # all sports
        python scripts/download_data.py nba nhl    # selected sports

Files that already exist are kept (delete data/raw to force a fresh pull).
Every URL used lives in the sport module under scripts/sports/.
"""
import importlib
import sys

from config import RAW, SPORTS


def main(argv):
    sports = argv or list(SPORTS)
    for s in sports:
        mod = importlib.import_module(f"sports.{s}")
        print(f"== {s.upper()}: downloading into {RAW / s}")
        mod.download(RAW / s)
    print("download complete")


if __name__ == "__main__":
    main(sys.argv[1:])
