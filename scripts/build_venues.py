"""Build data/venues.json: factual venue attributes for the 3D replays.

Input: scripts/venues_input.json - every venue ESPN used for a 2024-25/2025-26/2026 game in
the five leagues (ESPN venue ids, gathered from ESPN's public scoreboards), each pinned to one
Wikipedia article revision, plus hand-curated outfield wall heights with the sentence they
come from.

For each venue this script fetches that exact Wikipedia revision (so reruns are reproducible)
and reads the infobox: capacity (the sport's own figure when several are listed, and the
current one when a history is listed), playing surface, roof, MLB fence distances (and fence
heights when the infobox lists them) and EPL pitch dimensions. Anything the source does not
state is written as null - nothing is estimated. The replay then draws the venue from these
numbers and says which parts are schematic.

Usage:  python scripts/build_venues.py
"""
from __future__ import annotations

import datetime as dt
import html
import json
import re
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
IN = ROOT / "scripts" / "venues_input.json"
OUT = ROOT / "data" / "venues.json"
API = "https://en.wikipedia.org/w/api.php"
UA = {"User-Agent": "fda-project-1 venue data (educational; github.com/ethanbell528-cmd/fda-project-1)"}


# ---------------- Wikipedia fetch (pinned revisions, polite batching) ----------------
def api(params):
    params = dict(params, format="json", formatversion=2, maxlag=5)
    for _ in range(12):
        r = requests.get(API, params=params, headers=UA, timeout=90)
        if r.status_code == 200 and r.headers.get("content-type", "").startswith("application/json"):
            return r.json()
        time.sleep(int(r.headers.get("retry-after") or 10) + 3)
    raise RuntimeError("Wikipedia API unavailable")


def fetch_revisions(revids):
    out = {}
    for i in range(0, len(revids), 20):
        chunk = revids[i:i + 20]
        q = api({"action": "query", "prop": "revisions", "rvprop": "content|ids", "rvslots": "main", "revids": "|".join(map(str, chunk))})["query"]
        for p in q["pages"]:
            for rev in p.get("revisions", []):
                out[rev["revid"]] = {"title": p["title"], "text": rev["slots"]["main"]["content"]}
        time.sleep(2)
    return out


# ---------------- wikitext helpers ----------------
def infobox(txt):
    m = re.search(r"\{\{\s*Infobox[ _](?:stadium|venue|arena|sports venue|building)", txt, re.I)
    if not m:
        return None
    i, depth = m.start(), 0
    while i < len(txt):
        if txt.startswith("{{", i):
            depth += 1; i += 2; continue
        if txt.startswith("}}", i):
            depth -= 1; i += 2
            if depth == 0:
                return txt[m.start():i]
            continue
        i += 1
    return txt[m.start():]


def params(box):
    body, parts, depth, cur, j = box[2:-2], [], 0, "", 0
    while j < len(body):
        two = body[j:j + 2]
        if two in ("{{", "[["):
            depth += 1; cur += two; j += 2; continue
        if two in ("}}", "]]"):
            depth -= 1; cur += two; j += 2; continue
        if body[j] == "|" and depth == 0:
            parts.append(cur); cur = ""; j += 1; continue
        cur += body[j]; j += 1
    parts.append(cur)
    out = {}
    for p in parts[1:]:
        if "=" in p:
            k, v = p.split("=", 1)
            out[k.strip().lower().replace(" ", "_")] = v.strip()
    return out


def _convert(m):
    a = [x.strip() for x in m.group(1).split("|")]
    if len(a) >= 4 and a[1] in ("x", "×", "by"):
        return f"{a[0]} × {a[2]} {a[3]}"
    if len(a) >= 4 and a[1] == "ft" and a[3] == "in":
        return f"{a[0]} ft {a[2]} in"
    return f"{a[0]} {a[1]}" if len(a) >= 2 else (a[0] if a else "")


def clean(v):
    v = re.sub(r"<ref[^>]*/>", "", v)
    v = re.sub(r"<ref[^>]*>.*?</ref>", "", v, flags=re.S)
    v = re.sub(r"<!--.*?-->", "", v, flags=re.S)
    v = re.sub(r"<br\s*/?>", "\n", v, flags=re.I)
    v = re.sub(r"\{\{\s*(?:nbsp|nnbsp)\s*\}\}", " ", v, flags=re.I)
    for _ in range(4):
        v = re.sub(r"\{\{\s*(?:convert|cvt)\s*\|([^{}]*)\}\}", _convert, v, flags=re.I)
        v = re.sub(r"\{\{\s*(?:nowrap|nobr|small|big|abbr)\s*\|([^{}|]*)(?:\|[^{}]*)?\}\}", r"\1", v, flags=re.I)
        v = re.sub(r"\{\{\s*(?:plainlist|plain list|unbulleted list|ubli|ubl|flatlist|hlist|collapsible list)\s*\|(.*?)\}\}",
                   lambda m: m.group(1).replace("|", "\n"), v, flags=re.I | re.S)
        v = re.sub(r"\{\{\s*(?:efn|refn|sfn|citation needed|cn|as of|when|formatnum:?)[^{}]*\}\}", "", v, flags=re.I)
    v = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]*)\]\]", r"\1", v)
    v = re.sub(r"\[https?://\S+\s([^\]]*)\]", r"\1", v)
    v = re.sub(r"<[^>]+>", "", v)
    v = html.unescape(re.sub(r"'''?", "", v)).replace("\xa0", " ")
    lines = [re.sub(r"[ \t]+", " ", x).strip(" *") for x in v.split("\n")]
    # a line that is only a date range belongs to the value above it: "FieldTurf CORE" / "(2023–present)"
    out = []
    for ln in lines:
        if not ln:
            continue
        if out and re.fullmatch(r"\(?\s*(?:since\s+)?\d{4}\s*(?:[–—-]\s*(?:\d{4}|present))?\s*\)?", ln, re.I):
            out[-1] += " " + ln
        else:
            out.append(ln)
    return "\n".join(out)


NUM = r"(\d{1,3}(?:,\d{3})+|\d{4,6})"
SPORT_LABELS = {"nba": ["basketball"], "nhl": ["ice hockey", "hockey"], "nfl": ["nfl", "american football", "football"],
                "mlb": ["baseball"], "epl": ["football", "soccer", "association football"]}


def capacity(raw, sport):
    label, items = None, []
    for ln in clean(raw).split("\n"):
        m = re.match(r"^([A-Za-z][A-Za-z .()/'-]*?):\s*(.*)$", ln)
        if m and not re.search(r"\d", m.group(1)):
            label, ln = m.group(1).strip().lower(), m.group(2)
        low = ln.lower()
        if re.search(r"concert|world cup|olympic|boxing|wrestl|record", (label or "") + " " + low):
            continue  # capacities for other kinds of events
        for rng in re.finditer(NUM + r"\s*[–—-]\s*" + NUM, ln):  # "8,812–15,225" -> the full-venue figure
            ln = ln.replace(rng.group(0), rng.group(2))
        for n in re.finditer(NUM, ln):
            head = ln[max(0, n.start() - 32):n.start()].lower()
            if re.search(r"(expandable|expanded|standing|up to|over|with)\s*(to\s*)?(over\s*)?$", head):
                continue  # "73,208 (expandable to 76,468)": keep the base figure, skip the expanded one
            items.append((label, int(n.group(1).replace(",", "")), bool(re.search(r"present|since|current", ln, re.I)), ln))
    if not items:
        return None
    want = SPORT_LABELS[sport]
    lab = [x for x in items if x[0] and any(x[0] == w or x[0].startswith(w) for w in want)]
    pool = lab or [x for x in items if not x[0] or x[0] in ("capacity", "seating", "seated")] or items
    cur = [x for x in pool if x[2]]
    return (cur or pool)[0][1]


def surface(raw):
    lines = clean(raw).split("\n")
    cur = [l for l in lines if re.search(r"present|since", l, re.I)] or lines[:1]
    s = " ".join(cur).lower()
    if re.search(r"grassmaster|desso|hybrid|sisgrass|xtragrass|mixto|fibresand|playmaster", s):
        return "hybrid grass"
    if re.search(r"turf|artificial|synthetic|astro|matrix|ubu|shaw sports|momentum|hellas|sportexe|b1k", s) and not re.search(r"bermuda|bluegrass|kentucky|paspalum|ryegrass|natural grass|bullseye", s):
        return "artificial turf"
    if re.search(r"grass|bermuda|bluegrass|paspalum|rye|natural|zoysia|fescue|cynodon|poa ", s):
        return "grass"
    return None


def roof(p, text):
    s = (clean(p.get("roof", "")) + " " + clean(p.get("type", ""))).lower()
    if "retractable" in s:
        return "partially retractable" if "partial" in s else "retractable"
    if re.search(r"skylight|translucent|etfe|canopy", s):
        return "fixed translucent roof"
    if re.search(r"dome|fixed", s):
        return "fixed dome"
    if re.search(r"\bopen\b|none|open-air", s):
        return "open"
    return None  # not stated in the infobox: the replay falls back to ESPN's indoor flag


def _label(s):
    s = s.lower().replace("centre", "center")
    if re.search(r"left[- ]?(field[- ]?)?(center|power alley|alley)|\blcf\b|left of cf", s): return "lcf"
    if re.search(r"right[- ]?(field[- ]?)?(center|power alley|alley)|\brcf\b", s): return "rcf"
    if re.search(r"center field|\bcf\b|straightaway", s): return "cf"  # "Center Field left corner" is center field
    if re.search(r"\bleft\b|\blf\b", s): return "lf"
    if re.search(r"\bright\b|\brf\b", s): return "rf"
    if re.search(r"\bcenter\b|\bcf\b", s): return "cf"
    if "backstop" in s: return "backstop"
    return None


def fences(raw):
    """MLB fence distances (ft) and, when listed, fence heights (ft) from the infobox dimensions."""
    t = clean(raw)
    if "baseball:" in t.lower():
        t = t[t.lower().index("baseball:") + 9:]
        t = re.split(r"\n\s*(?:soccer|football|cricket|rugby)[^\n]*:", t, flags=re.I)[0]
    dist, walls, section, label = {}, {}, "dist", None
    for ln in [l for l in t.split("\n") if l.strip()]:
        l = ln.lower()
        if re.search(r"(fence|wall) heights?", l):
            section, label = "wall", None
            l = re.sub(r".*(fence|wall) heights?\s*:?", "", l)
            if not l.strip():
                continue
        head = l.split(":")[0] if ":" in l else re.split(r"[–—-]\s*\d|\d", l)[0]
        k = _label(re.sub(r"\(.*?\)", "", head))
        if k:
            label = k
        m = re.search(r"(\d{1,3}(?:\.\d+)?)\s*(?:ft|feet|foot|')", l)
        if not m or not label:
            continue
        v = float(m.group(1))
        if section == "dist" and not (250 <= v <= 500): continue
        if section == "wall" and not (2 <= v <= 60): continue
        (dist if section == "dist" else walls).setdefault(label, []).append((v, l))
    out = {}
    for k, vals in dist.items():
        if k == "backstop": continue
        std = [x for x in vals if not re.search(r"deep|power alley|straightaway|angle", x[1])] or vals
        if k in ("lf", "rf"):
            std = [x for x in std if re.search(r"line|foul", x[1])] or std
        cur = [x for x in std if re.search(r"present|since", x[1])]
        out[k] = int(round((cur or std)[0][0]))
    return out, {k: v[0][0] for k, v in walls.items() if k != "backstop"}


def pitch(raw):
    t = clean(raw).replace("×", "x")
    m = re.search(r"(\d{2,3}(?:\.\d+)?)\s*(?:m|metres|meters)?\s*x\s*(\d{2,3}(?:\.\d+)?)\s*(m|metres|meters|yd|yards)", t, re.I)
    if not m:
        return None
    a, b = float(m.group(1)), float(m.group(2))
    if m.group(3).lower().startswith("y"):
        a, b = a * 0.9144, b * 0.9144
    L, W = max(a, b), min(a, b)
    if not (90 <= L <= 120 and 45 <= W <= 90):  # Laws of the Game limits; anything else is not a football pitch figure
        return None
    return {"length_m": round(L, 1), "width_m": round(W, 1)}


def main():
    items = json.loads(IN.read_text(encoding="utf-8"))
    revs = fetch_revisions(sorted({i["wiki_revid"] for i in items if i.get("wiki_revid")}))
    today = dt.date.today().isoformat()
    arenas_by_name = {}
    for i in items:
        if i["sport"] in ("nba", "nhl") and i.get("wiki_title"):
            arenas_by_name.setdefault(i["wiki_title"], set()).add(i["sport"])
    venues = []
    for i in items:
        v = {"sport": i["sport"], "espn_ids": i["espn_ids"], "name": i["name"], "city": i.get("city"), "state": i.get("state"),
             "country": i.get("country"), "espn_indoor": i.get("espn_indoor"), "home_teams": i.get("home_teams", []), "neutral_site_only": i.get("espn_neutral_only", False),
             "capacity": None, "surface": None, "roof": None, "fence_ft": None, "wall_height_ft": None, "pitch": None,
             "tiers": None, "bowl": None, "shared_arena": None, "source": None, "source_revision": None, "verified": today}
        r = revs.get(i.get("wiki_revid"))
        if r:
            v["source"] = "https://en.wikipedia.org/wiki/" + r["title"].replace(" ", "_")
            v["source_revision"] = f"https://en.wikipedia.org/w/index.php?oldid={i['wiki_revid']}"
            box = infobox(r["text"])
            p = params(box) if box else {}
            v["capacity"] = capacity(p.get("capacity") or p.get("seating_capacity") or "", i["sport"])
            v["surface"] = surface(p.get("surface", "")) if i["sport"] not in ("nba", "nhl") else None
            v["roof"] = roof(p, r["text"]) if i["sport"] not in ("nba", "nhl") else "indoor arena"
            dims = p.get("dimensions") or p.get("field_size") or p.get("fieldsize") or ""
            if i["sport"] == "mlb":
                f, w = fences(dims)
                v["fence_ft"] = f or None
                v["wall_height_ft"] = w or None
            if i["sport"] == "epl":
                v["pitch"] = pitch(dims)
            if i["sport"] in ("nba", "nhl"):
                v["shared_arena"] = len(arenas_by_name.get(i["wiki_title"], ())) > 1
        wm = i.get("walls_manual")
        if wm:  # hand-curated heights, each with its source sentence
            v["wall_height_ft"] = dict(v["wall_height_ft"] or {}, **wm["heights_ft"])
            v["wall_height_source"] = wm["source"]
            v["wall_height_quote"] = wm["quote"]
        venues.append(v)
    doc = {
        "description": "Venue attributes for the 3D replays. Numbers come from the cited Wikipedia revision (infobox) or, for wall heights, "
                       "the quoted sentence; null means the source does not state it. Tiers, bowl shape and EPL stand heights are not "
                       "published consistently, so they are null and the replay draws a schematic bowl scaled by capacity.",
        "built": today,
        "venues": venues,
    }
    OUT.write_text(json.dumps(doc, indent=1, ensure_ascii=False), encoding="utf-8")
    from collections import Counter
    print("venues:", Counter(v["sport"] for v in venues))
    for s in ("nfl", "nba", "mlb", "nhl", "epl"):
        vs = [v for v in venues if v["sport"] == s]
        print(f"  {s}: {len(vs)} venues; capacity {sum(1 for v in vs if v['capacity'])}, surface {sum(1 for v in vs if v['surface'])}, "
              f"roof {sum(1 for v in vs if v['roof'])}, fences {sum(1 for v in vs if v['fence_ft'])}, walls {sum(1 for v in vs if v['wall_height_ft'])}, "
              f"pitch {sum(1 for v in vs if v['pitch'])}, no source {sum(1 for v in vs if not v['source'])}")


if __name__ == "__main__":
    main()
