/* "Any game since 1990": browse every game in the data by date, with the model's pre-game
   prediction next to the result and the betting market, and open any game in 3D.

   Data: data/predictions_<sport>.csv (written by scripts/train_model.py), one row per game with
   the pre-game win probability, predicted margin and total, pre-game Elo, the market line/total/
   moneyline (or 1X2 odds) where the source has them, the final score and a split label:
     burn-in  = Elo warm-up seasons, never used for training
     train    = in-sample: the model's coefficients were fit on this season
     holdout  = out-of-sample backtest season
     current  = season in progress (also out-of-sample)
   3D: the game is looked up on ESPN's public scoreboard for that date (matched on the final score;
   NBA ids from 2001-02 are ESPN ids). With play-by-play it opens the full Replay3D view; otherwise
   Replay3D.openFinal shows the surface, the venue when ESPN names it, and the final score (plus the
   Retrosheet inning line score for MLB). Nothing is invented. */
(function () {
  "use strict";
  const S = window.Site;
  const $ = (id) => document.getElementById(id);
  const ESPN = "https://site.api.espn.com/apis/site/v2/sports/";
  const LEAGUE = { nfl: "football/nfl", nba: "basketball/nba", mlb: "baseball/mlb", nhl: "hockey/nhl", epl: "soccer/eng.1" };
  const SPLIT = {
    "burn-in": ["Elo warm-up season", "The model's ratings were still warming up; these seasons were not used to fit the model."],
    train: ["In-sample", "In-sample: the model was trained on this season, so this is not a true test."],
    holdout: ["Out-of-sample", "Out-of-sample: the model never saw this season while it was built (backtest season)."],
    current: ["Current season", "Current season: out-of-sample, predicted with today's model before each game."],
  };
  const cache = {}, lineCache = {};
  let sport = null, rows = null, byDate = null, dates = [], token = 0;
  let pendingOpen = null;

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  const f = S.fmt;
  const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
  const signed = (v) => (v == null ? "n/a" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(1).replace(/\.0$/, ""));
  const lineTxt = (v) => (v == null ? "n/a" : v === 0 ? "PK" : (v > 0 ? "+" : "−") + String(Math.abs(v)));
  function fmtDate(d) {
    const [y, m, dd] = d.split("-").map(Number);
    return new Date(y, m - 1, dd).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  }

  function load(sp) {
    if (!cache[sp]) {
      cache[sp] = new Promise((resolve, reject) => {
        if (!window.Papa) return reject(new Error("CSV parser failed to load (CDN blocked?)"));
        window.Papa.parse("data/predictions_" + sp + ".csv", {
          download: true, header: true, skipEmptyLines: true,
          dynamicTyping: (c) => !["game_id", "date", "home", "away", "type", "split"].includes(c),
          complete: (res) => resolve(res.data),
          error: (e) => reject(e),
        });
      });
      cache[sp].catch(() => { delete cache[sp]; });
    }
    return cache[sp];
  }
  function loadLines() {
    if (!lineCache.p) {
      lineCache.p = new Promise((resolve) => {
        if (!window.Papa) return resolve({});
        window.Papa.parse("data/mlb_linescores.csv", {
          download: true, header: true, skipEmptyLines: true, dynamicTyping: false,
          complete: (res) => { const m = {}; res.data.forEach((r) => { m[r.game_id] = r; }); resolve(m); },
          error: () => resolve({}),
        });
      });
    }
    return lineCache.p;
  }

  // ---------- per-game numbers ----------
  function model(r) {
    const m = r.hs - r.as;
    if (sport === "epl") {
      const pH = r.p_home, pD = r.p_draw, pA = 1 - pH - pD;
      const pick = pH >= pD && pH >= pA ? "H" : pA >= pD ? "A" : "D";
      const act = m > 0 ? "H" : m < 0 ? "A" : "D";
      return { pH, pD, pA, pick, right: pick === act, pActual: act === "H" ? pH : act === "A" ? pA : pD };
    }
    const pick = r.p_home >= 0.5 ? "H" : "A";
    return { pH: r.p_home, pA: 1 - r.p_home, pick, tie: m === 0, right: m !== 0 && (m > 0) === (pick === "H"), pActual: m > 0 ? r.p_home : m < 0 ? 1 - r.p_home : null };
  }
  function market(r) {
    const hl = num(r.home_line), tl = num(r.total_line);
    if (sport === "epl") {
      const o = [num(r.odds_h), num(r.odds_d), num(r.odds_a)];
      const has1x2 = o.every((x) => x != null);
      let q = null;
      if (has1x2) { const inv = o.map((x) => 1 / x), s = inv[0] + inv[1] + inv[2]; q = inv.map((x) => x / s); }
      return { any: has1x2 || hl != null, odds: has1x2 ? o : null, q, hl, tl };
    }
    const hm = num(r.home_ml), am = num(r.away_ml), q = num(r.mkt_p_home);
    return { any: hl != null || tl != null || hm != null, hl, tl, hm, am, q };
  }
  function vsLine(r, mk) {
    const out = [];
    const m = r.hs - r.as, t = r.hs + r.as;
    if (mk.hl != null) {
      const x = m + mk.hl;
      out.push(x > 0 ? r.home + " covered " + lineTxt(mk.hl) : x < 0 ? r.away + " covered " + lineTxt(-mk.hl) : "Push on " + lineTxt(mk.hl));
    }
    if (mk.tl != null) out.push(t > mk.tl ? "Over " + mk.tl : t < mk.tl ? "Under " + mk.tl : "Push on total " + mk.tl);
    return out;
  }

  // ---------- list ----------
  function card(r) {
    const mo = model(r), mk = market(r);
    const c = el("article", "game game-compact hist-card");
    c.tabIndex = 0;
    c.setAttribute("role", "button");
    c.setAttribute("aria-haspopup", "dialog");
    c.setAttribute("aria-label", r.away + " at " + r.home + ", " + r.date + ": open this game");
    const sp = SPLIT[r.split] || [r.split, ""];
    c.appendChild(el("div", "status", "Final" + (r.type === "P" ? " · Playoffs" : "") + (r.neutral ? " · Neutral site" : "")));
    const teams = el("div", "teams");
    teams.append(el("span", null, r.away), el("span", "num", String(r.as)), el("span", null, r.home + " (home)"), el("span", "num", String(r.hs)));
    c.appendChild(teams);
    let ml;
    if (sport === "epl") ml = "Model: " + r.home + " " + f.pct(mo.pH, 0) + " · draw " + f.pct(mo.pD, 0) + " · " + r.away + " " + f.pct(mo.pA, 0) + " · " + num(r.pred_total).toFixed(1) + " goals";
    else ml = "Model: " + (mo.pick === "H" ? r.home + " " + f.pct(mo.pH, 0) : r.away + " " + f.pct(mo.pA, 0)) + " · " + r.home + " " + signed(-num(r.pred_margin)) + " · total " + num(r.pred_total).toFixed(1);
    c.appendChild(el("div", "small", ml));
    let mt;
    if (!mk.any) mt = "No market data for this " + (sport === "epl" ? "match" : "game") + " in our sources";
    else if (sport === "epl") mt = "Market: " + (mk.odds ? r.home + " " + mk.odds[0].toFixed(2) + " · draw " + mk.odds[1].toFixed(2) + " · " + r.away + " " + mk.odds[2].toFixed(2) : "no 1X2 odds") + (mk.hl != null ? " · AH " + r.home + " " + lineTxt(mk.hl) : "");
    else mt = "Market: " + [mk.hl != null ? r.home + " " + lineTxt(mk.hl) : null, mk.tl != null ? "O/U " + mk.tl : null, mk.hm != null ? "ML " + f.american(mk.am) + " / " + f.american(mk.hm) : null].filter(Boolean).join(" · ");
    c.appendChild(el("div", "small muted", mt));
    const chips = el("div", "hist-chips");
    const res = mo.tie ? "Tie: no pick to grade" : mo.right ? "✓ Model right" : "✗ Model wrong";
    chips.appendChild(el("span", "pill " + (mo.tie ? "" : mo.right ? "hist-right" : "hist-wrong"), res));
    vsLine(r, mk).forEach((t) => chips.appendChild(el("span", "pill", t)));
    const spl = el("span", "pill hist-split", sp[0]);
    spl.title = sp[1];
    chips.appendChild(spl);
    c.appendChild(chips);
    c.appendChild(el("div", "open-hint", "Click for the full prediction and the 3D view"));
    const open = () => openGame(r);
    c.addEventListener("click", open);
    c.addEventListener("keydown", (e) => { if (e.target === c && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); open(); } });
    return c;
  }

  function render() {
    const box = $("h-games"), note = $("h-note");
    if (!rows) return;
    const d = $("h-date").value, team = $("h-team").value;
    let list = (byDate.get(d) || []);
    if (team) list = list.filter((r) => r.homeCode === team || r.awayCode === team);
    box.textContent = "";
    if (!list.length) {
      note.textContent = "No " + S.SPORTS[sport].name + " games on " + (d ? fmtDate(d) : "that date") + (team ? " for " + team : "") + ". Use the arrows to jump to the nearest game day.";
      return;
    }
    const right = list.filter((r) => { const m = model(r); return !m.tie && m.right; }).length, graded = list.filter((r) => !model(r).tie).length;
    note.textContent = list.length + " game" + (list.length === 1 ? "" : "s") + " on " + fmtDate(d) + (team ? " for " + team : "") + " · model picked " + right + " of " + graded + " winners" + (sport === "epl" ? " (home/draw/away)" : "") + ".";
    list.forEach((r) => box.appendChild(card(r)));
  }

  function nearestDay(dir) {
    const d = $("h-date").value, team = $("h-team").value;
    const pool = team ? dates.filter((x) => byDate.get(x).some((r) => r.homeCode === team || r.awayCode === team)) : dates;
    if (!pool.length) return;
    let i = pool.findIndex((x) => x > d);
    if (dir < 0) { i = pool.findIndex((x) => x >= d); i = (i === -1 ? pool.length : i) - 1; }
    if (i < 0 || i >= pool.length) return;
    $("h-date").value = pool[i];
    render();
  }


  // The panel files use today's franchise codes so a franchise's history stays together.
  // For display, old games show the team as it was called that season (1996 Finals = SEA, not OKC).
  // [lastSeason, name]: the first entry whose lastSeason >= the game's season wins.
  const ERA = {
    nba: { OKC: [[2007, "SEA"]], MEM: [[2000, "VAN"]], BKN: [[2011, "NJN"]], NOP: [[2001, "NOP"], [2004, "NOH"], [2006, "NOK"], [2012, "NOH"]], CHA: [[2001, "CHH"]], WAS: [[1996, "WSB"]] },
    nfl: { TEN: [[1996, "HOU"]], LV: [[1994, "LA Raiders"], [2019, "OAK"]], LA: [[1994, "LA Rams"], [2015, "STL"]], LAC: [[2016, "SD"]], ARI: [[1993, "PHO"]] },
    nhl: { COL: [[1994, "QUE"]], CAR: [[1996, "HFD"]], DAL: [[1992, "MNS"]], WPG: [[2010, "ATL"]], ARI: [[1995, "WIN"], [2013, "PHX"]] },
    mlb: { WSH: [[2004, "MON"]], MIA: [[2011, "FLA"]], LAA: [[1996, "CAL"], [2004, "ANA"]], ATH: [[2024, "OAK"]] },
    epl: {},
  };
  function eraName(sp, code, season) {
    const list = (ERA[sp] || {})[code];
    if (!list) return code;
    for (const [last, name] of list) if (season <= last) return name;
    return code;
  }

  async function show(sp) {
    sport = sp;
    const my = ++token;
    const box = $("h-games"), note = $("h-note");
    if (!box) return;
    box.textContent = "";
    note.textContent = "Loading every " + S.SPORTS[sp].name + " game since " + (sp === "epl" ? "1993-94" : "1990") + "…";
    box.classList.add("loading");
    let data;
    try { data = await load(sp); } catch (e) {
      if (my !== token) return;
      box.classList.remove("loading");
      note.textContent = "Could not load the " + S.SPORTS[sp].name + " prediction file (" + (e && e.message ? e.message : "network error") + ").";
      return;
    }
    if (my !== token) return;
    box.classList.remove("loading");
    rows = data;
    for (const r of rows) {
      if (r.homeCode === undefined) {
        r.homeCode = r.home; r.awayCode = r.away;
        r.home = eraName(sp, r.homeCode, Number(r.season)); r.away = eraName(sp, r.awayCode, Number(r.season));
      }
    }
    byDate = new Map();
    for (const r of rows) { if (!byDate.has(r.date)) byDate.set(r.date, []); byDate.get(r.date).push(r); }
    dates = [...byDate.keys()].sort();
    const din = $("h-date");
    din.min = dates[0];
    din.max = new Date().toISOString().slice(0, 10);
    if (!din.value || din.value < dates[0] || din.value > dates[dates.length - 1]) din.value = dates[dates.length - 1];
    const teams = [...new Set(rows.flatMap((r) => [r.homeCode, r.awayCode]))].sort();
    const ts = $("h-team"), prev = ts.value;
    ts.textContent = "";
    [["", "All teams"]].concat(teams.map((t) => [t, t])).forEach(([v, t]) => { const o = el("option", null, t); o.value = v; ts.appendChild(o); });
    ts.value = teams.includes(prev) ? prev : "";
    $("h-span").textContent = "Games from " + fmtDate(dates[0]) + " to " + fmtDate(dates[dates.length - 1]) + " · " + rows.length.toLocaleString("en-US") + " games.";
    render();
    if (pendingOpen) { const r = rows.find((x) => x.game_id === pendingOpen); pendingOpen = null; if (r) { din.value = r.date; render(); openGame(r); } }
  }

  function jump(kind) {
    if (!rows || !rows.length) return;
    let r = null;
    if (kind === "random") r = rows[Math.floor(Math.random() * rows.length)];
    if (kind === "upset") {
      const season = (byDate.get($("h-date").value) || [])[0];
      const s = season ? season.season : rows[rows.length - 1].season;
      let best = null;
      for (const x of rows) {
        if (x.season !== s) continue;
        const m = model(x);
        if (m.pActual == null) continue;
        if (!best || m.pActual < best.p) best = { r: x, p: m.pActual };
      }
      r = best && best.r;
    }
    if (!r) return;
    $("h-team").value = "";
    $("h-date").value = r.date;
    render();
    openGame(r);
  }

  // ---------- game pop-up ----------
  async function espnMatch(r) {
    if (sport === "nba" && /^\d+$/.test(r.game_id) && r.season >= 2001) return { id: r.game_id, venue: null };
    const tryDate = async (iso, needAbbr) => {
      const res = await fetch(ESPN + LEAGUE[sport] + "/scoreboard?dates=" + iso.replace(/-/g, ""), { cache: "force-cache" });
      if (!res.ok) return null;
      const d = await res.json();
      const hits = [];
      for (const ev of d.events || []) {
        const comp = (ev.competitions || [])[0];
        if (!comp) continue;
        const h = (comp.competitors || []).find((c) => c.homeAway === "home"), a = (comp.competitors || []).find((c) => c.homeAway === "away");
        if (!h || !a) continue;
        const hs = Number(h.score), as_ = Number(a.score);
        const same = hs === r.hs && as_ === r.as, swapped = r.neutral && hs === r.as && as_ === r.hs;
        if (!same && !swapped) continue;
        const ab = [(h.team && h.team.abbreviation) || "", (a.team && a.team.abbreviation) || ""].map((x) => x.toUpperCase());
        const abbrOk = [r.home, r.away, r.homeCode, r.awayCode].some((c) => ab.includes(String(c).toUpperCase()));
        if (needAbbr && !abbrOk) continue;
        const v = comp.venue || {};
        hits.push({ id: ev.id, abbrOk, venue: v.fullName ? { id: v.id != null ? String(v.id) : null, fullName: v.fullName, city: v.address && v.address.city, state: v.address && v.address.state, indoor: v.indoor, grass: v.grass } : null });
      }
      if (!hits.length) return null;
      return hits.find((x) => x.abbrOk) || (hits.length === 1 ? hits[0] : null);
    };
    let m = await tryDate(r.date, false);
    if (m) return m;
    // late games can sit on the next (or previous) ESPN date; require a team match there
    const [y, mo, dd] = r.date.split("-").map(Number);
    for (const k of [1, -1]) {
      const d2 = new Date(Date.UTC(y, mo - 1, dd + k)).toISOString().slice(0, 10);
      m = await tryDate(d2, true);
      if (m) return m;
    }
    return null;
  }

  function detailTable(r) {
    const mo = model(r), mk = market(r);
    const t = el("table", "compare");
    const hr = t.createTHead().insertRow();
    const cols = sport === "epl" ? [r.home + " win", "Draw", r.away + " win"] : [r.away, r.home];
    ["", ...cols].forEach((h) => hr.appendChild(el("th", null, h)));
    const tb = t.createTBody();
    const row = (label, vals) => { const tr = tb.insertRow(); tr.insertCell().textContent = label; vals.forEach((v) => { tr.insertCell().textContent = v == null ? "n/a" : v; }); };
    if (sport === "epl") {
      row("Model (pre-game)", [f.pct(mo.pH), f.pct(mo.pD), f.pct(mo.pA)]);
      row("Market no-vig", mk.q ? mk.q.map((x) => f.pct(x)) : ["n/a", "n/a", "n/a"]);
      row("Market odds (decimal)", mk.odds ? mk.odds.map((x) => x.toFixed(2)) : ["n/a", "n/a", "n/a"]);
      row("Model fair odds", [1 / mo.pH, 1 / mo.pD, 1 / mo.pA].map((x) => x.toFixed(2)));
    } else {
      row("Model win % (pre-game)", [f.pct(mo.pA), f.pct(mo.pH)]);
      row("Market no-vig %", mk.q != null ? [f.pct(1 - mk.q), f.pct(mk.q)] : ["n/a", "n/a"]);
      row("Market moneyline", [f.american(mk.am), f.american(mk.hm)]);
      row("Model spread", [signed(num(r.pred_margin)), signed(-num(r.pred_margin))]);
      row("Market " + S.SPORTS[sport].lineName.toLowerCase(), [mk.hl != null ? lineTxt(-mk.hl) : "n/a", mk.hl != null ? lineTxt(mk.hl) : "n/a"]);
    }
    const tr = tb.insertRow();
    tr.insertCell().textContent = "Total (model / market / actual)";
    const tc = tr.insertCell(); tc.colSpan = cols.length;
    tc.textContent = num(r.pred_total).toFixed(1) + " / " + (mk.tl != null ? mk.tl : "n/a") + " / " + (r.hs + r.as);
    const tr2 = tb.insertRow();
    tr2.insertCell().textContent = "Pre-game Elo";
    if (sport === "epl") { tr2.insertCell().textContent = String(r.elo_home_pre); tr2.insertCell().textContent = ""; tr2.insertCell().textContent = String(r.elo_away_pre); }
    else { tr2.insertCell().textContent = String(r.elo_away_pre); tr2.insertCell().textContent = String(r.elo_home_pre); }
    return t;
  }

  async function openGame(r) {
    const node = el("div", "game game-detail hist-detail");
    const teams = el("div", "teams");
    teams.append(el("span", null, r.away), el("span", "num", String(r.as)), el("span", null, r.home + " (home)"), el("span", "num", String(r.hs)));
    node.appendChild(teams);
    node.appendChild(detailTable(r));
    const mo = model(r), mk = market(r);
    const chips = el("div", "hist-chips");
    chips.appendChild(el("span", "pill " + (mo.tie ? "" : mo.right ? "hist-right" : "hist-wrong"), mo.tie ? "Tie: no pick to grade" : mo.right ? "✓ Model picked the winner" : "✗ Model picked the loser"));
    vsLine(r, mk).forEach((t) => chips.appendChild(el("span", "pill", t)));
    node.appendChild(chips);
    const sp = SPLIT[r.split] || [r.split, ""];
    node.appendChild(el("p", "small muted", sp[1] + " Every model number uses only information available before the game (Elo, rest, recent form" +
      (sport === "mlb" ? ", starting pitchers' earlier starts" : sport === "nhl" ? ", starting goalies' earlier games" : sport === "epl" ? ", attack and defense ratings" : "") + ")." +
      (mk.any ? "" : " Our odds sources do not cover this " + (sport === "epl" ? "match" : "game") + ", so there is no market comparison.")));
    const h3 = el("h3", null, "3D view");
    h3.style.margin = "14px 0 4px"; h3.style.fontSize = "1rem";
    node.appendChild(h3);
    const box = el("div", "replay-host");
    box.appendChild(el("p", "muted small", "Looking this game up on ESPN…"));
    node.appendChild(box);
    S.showGame({ title: r.away + " at " + r.home, subtitle: S.SPORTS[sport].name + " · " + fmtDate(r.date) + " · " + r.away + " " + r.as + " – " + r.hs + " " + r.home, node });
    let ctl = null, closed = false;
    if (S.onGameClose) S.onGameClose(() => { closed = true; if (ctl) ctl.close(); });
    if (!window.Replay3D) { box.textContent = "3D view unavailable: the replay script did not load."; return; }
    let m = null;
    try { m = await espnMatch(r); } catch (e) { m = null; }
    if (closed) return;
    if (m) {
      ctl = await window.Replay3D.open(box, sport, m.id, {});
      if (closed) { ctl.close(); return; }
      if (!ctl.empty) return;
      ctl.close();
    }
    const ls = sport === "mlb" ? (await loadLines())[r.game_id] : null;
    if (closed) return;
    ctl = await window.Replay3D.openFinal(box, sport, {
      home: { abbr: r.home, score: r.hs }, away: { abbr: r.away, score: r.as }, date: r.date, label: r.type === "P" ? "Playoffs" : "",
      venue: m ? m.venue : null, linescore: ls ? { away: ls.away_line, home: ls.home_line } : null,
      note: m ? "ESPN lists this game but has no play-by-play for it, so the 3D view shows the final result" + (ls ? " and the inning line score" : "") + " only."
        : "No play-by-play exists for this game in our sources" + (ls ? "; the 3D view shows the final result and Retrosheet's inning-by-inning line score only." : "; the 3D view shows the final result only."),
    });
    if (closed) ctl.close();
  }

  document.addEventListener("DOMContentLoaded", () => {
    const d = $("h-date");
    if (!d) return;
    d.addEventListener("change", render);
    $("h-team").addEventListener("change", render);
    $("h-prev").addEventListener("click", () => nearestDay(-1));
    $("h-next").addEventListener("click", () => nearestDay(1));
    $("h-random").addEventListener("click", () => jump("random"));
    $("h-upset").addEventListener("click", () => jump("upset"));
    // deep links: replays.html?date=1998-09-08#mlb shows that day; ?game=<game_id>#mlb opens that game
    const q = new URLSearchParams(location.search);
    if (q.get("date")) d.value = q.get("date");
    if (q.get("game")) pendingOpen = q.get("game");
  });

  window.History3D = { show };
})();
