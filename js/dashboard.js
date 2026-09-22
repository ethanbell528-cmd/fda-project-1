/* Dashboard: loads data/<sport>.csv in the browser, filters it, and recomputes every
   tile, chart and table from the filtered rows.

   FORMULAS (identical to the report's methodology; defined once in `finish()` below)
     team-games     = number of rows in the slice (each game has one row per team)
     games          = number of distinct game_id values in the slice
     win %          = rows with result W / all rows            (ties T and draws D count as non-wins)
     favorite win % = W among rows with favorite = 1 / rows with favorite = 1
     cover %        = cover / (cover + miss)                    (pushes and rows without a line excluded)
     favorite cover %= same, restricted to rows with favorite = 1
     over %         = over / (over + under)                     (pushes and rows without a total line excluded)
     avg total      = mean(total), total = score_for + score_against (both rows of a game share it,
                      so the row mean equals the per-game mean)
     avg total line = mean(total_line) over rows with a total line; compared with mean(total) on
                      the SAME rows
     line error     = mean(|margin + line|) over rows with a line (how far the result landed from the line)
     total scored   = sum(score_for) over the slice                                             */
(function () {
  "use strict";
  const S = window.Site;
  const $ = (id) => document.getElementById(id);
  const SPORTS = S.SPORTS, ORDER = S.SPORT_ORDER;

  const HA = ["H", "A", "N"], GT = ["regular", "playoff"], RES = ["W", "L", "T", "D"];
  const LR = { "": 0, cover: 1, miss: 2, push: 3 }, OU = { "": 0, over: 1, under: 2, push: 3 };

  const MEASURES = [
    { key: "count", label: "Team-games", fmt: (v) => S.fmt.int(v), axis: "team-games" },
    { key: "scored", label: "Total scored", fmt: (v) => S.fmt.int(v), axis: "" },
    { key: "avgTotal", label: "Average total", fmt: (v) => S.fmt.num(v, 1), axis: "" },
    { key: "winPct", label: "Win rate", fmt: (v) => S.fmt.pct(v), axis: "win %", pct: true },
    { key: "coverPct", label: "Cover rate", fmt: (v) => S.fmt.pct(v), axis: "cover %", pct: true },
    { key: "overPct", label: "Over rate", fmt: (v) => S.fmt.pct(v), axis: "over %", pct: true },
  ];
  const BREAKS = [
    { key: "season", label: "Season" },
    { key: "team", label: "Team" },
    { key: "ha", label: "Home / away" },
    { key: "gt", label: "Game type" },
    { key: "role", label: "Favorite / underdog" },
  ];

  const state = { sport: null, measure: "avgTotal", brk: "season" };
  const cache = {}; // sport -> Promise<data>
  const charts = {};
  let data = null;

  // ------------------------------------------------------------------ loading
  function load(sport) {
    if (cache[sport]) return cache[sport];
    cache[sport] = new Promise(function (resolve, reject) {
      if (!window.Papa) { reject(new Error("The CSV parser could not load (CDN blocked?).")); return; }
      const cols = { season: [], team: [], opp: [], ha: [], gt: [], res: [], sf: [], sa: [], line: [], tline: [], fav: [], lr: [], ou: [], gid: [] };
      const teamIdx = new Map(), teams = [], gidIdx = new Map(), labels = new Map();
      let n = 0;
      const ti = (t) => { let i = teamIdx.get(t); if (i === undefined) { i = teams.length; teams.push(t); teamIdx.set(t, i); } return i; };
      const f = (x) => (x === "" || x == null ? NaN : +x);
      window.Papa.parse("data/" + sport + ".csv", {
        download: true, header: true, skipEmptyLines: true, dynamicTyping: false,
        chunkSize: 1024 * 1024 * 2,
        chunk: function (res) {
          for (const r of res.data) {
            if (!r.team) continue;
            const s = +r.season;
            cols.season.push(s);
            if (!labels.has(s)) labels.set(s, r.season_label || String(s));
            cols.team.push(ti(r.team)); cols.opp.push(ti(r.opponent));
            cols.ha.push(Math.max(0, HA.indexOf(r.home_away)));
            cols.gt.push(Math.max(0, GT.indexOf(r.game_type)));
            cols.res.push(Math.max(0, RES.indexOf(r.result)));
            cols.sf.push(+r.score_for); cols.sa.push(+r.score_against);
            cols.line.push(f(r.line)); cols.tline.push(f(r.total_line));
            cols.fav.push(r.favorite === "" || r.favorite == null ? -1 : +r.favorite);
            cols.lr.push(LR[r.line_result || ""] || 0); cols.ou.push(OU[r.ou_result || ""] || 0);
            let g = gidIdx.get(r.game_id); if (g === undefined) { g = gidIdx.size; gidIdx.set(r.game_id, g); }
            cols.gid.push(g);
            n++;
          }
        },
        complete: function () {
          if (!n) { reject(new Error("No rows found in data/" + sport + ".csv.")); return; }
          const d = {
            sport, n, teams, labels, nGames: gidIdx.size,
            season: Int16Array.from(cols.season), team: Uint16Array.from(cols.team), opp: Uint16Array.from(cols.opp),
            ha: Uint8Array.from(cols.ha), gt: Uint8Array.from(cols.gt), res: Uint8Array.from(cols.res),
            sf: Float32Array.from(cols.sf), sa: Float32Array.from(cols.sa),
            line: Float32Array.from(cols.line), tline: Float32Array.from(cols.tline),
            fav: Int8Array.from(cols.fav), lr: Uint8Array.from(cols.lr), ou: Uint8Array.from(cols.ou),
            gid: Uint32Array.from(cols.gid),
          };
          const seasons = Array.from(labels.keys()).sort((a, b) => a - b);
          d.seasons = seasons;
          let fl = Infinity, ft = Infinity;
          for (let i = 0; i < n; i++) {
            if (!Number.isNaN(d.line[i]) && d.season[i] < fl) fl = d.season[i];
            if (!Number.isNaN(d.tline[i]) && d.season[i] < ft) ft = d.season[i];
          }
          d.firstLine = Number.isFinite(fl) ? fl : null;
          d.firstTotal = Number.isFinite(ft) ? ft : null;
          d.results = RES.filter((_, k) => { for (let i = 0; i < n; i++) if (d.res[i] === k) return true; return false; });
          d.hasN = d.ha.some((x) => x === 2);
          d.hasPlayoff = d.gt.some((x) => x === 1);
          resolve(d);
        },
        error: function (err) {
          reject(new Error(/404|Not Found/i.test(String(err && err.message)) || (err && err.code === 404)
            ? "data/" + sport + ".csv is not available yet." : "Could not load data/" + sport + ".csv (" + (err && err.message ? err.message : "network error") + ")."));
        },
      });
    });
    cache[sport].catch(() => { delete cache[sport]; });
    return cache[sport];
  }

  // ------------------------------------------------------------------ filters
  function filterValues() {
    return {
      from: +$("f-from").value, to: +$("f-to").value,
      team: $("f-team").value, opp: $("f-opp").value,
      ha: $("f-ha").value, gt: $("f-type").value, res: $("f-result").value,
    };
  }
  function opt(sel, value, text) { const o = document.createElement("option"); o.value = value; o.textContent = text; sel.appendChild(o); }
  function buildFilters(d) {
    const from = $("f-from"), to = $("f-to"), team = $("f-team"), opp = $("f-opp"), res = $("f-result");
    [from, to, team, opp, res].forEach((s) => { s.textContent = ""; });
    d.seasons.forEach((s) => { opt(from, s, d.labels.get(s)); opt(to, s, d.labels.get(s)); });
    const names = d.teams.map((t, i) => [t, i]).sort((a, b) => a[0].localeCompare(b[0]));
    opt(team, "", "All teams"); opt(opp, "", "All opponents");
    names.forEach(([t, i]) => { opt(team, i, t); opt(opp, i, t); });
    opt(res, "", "All");
    const resName = { W: "Win", L: "Loss", T: "Tie", D: "Draw" };
    d.results.forEach((r) => opt(res, RES.indexOf(r), resName[r]));
    $("f-ha").querySelector('option[value="N"]').hidden = !d.hasN;
    $("f-type").querySelector('option[value="playoff"]').hidden = !d.hasPlayoff;
    resetFilters(d);
  }
  function resetFilters(d) {
    $("f-from").value = d.seasons[0];
    $("f-to").value = d.seasons[d.seasons.length - 1];
    ["f-team", "f-opp", "f-ha", "f-type", "f-result"].forEach((id) => { $(id).value = ""; });
  }

  // ------------------------------------------------------------------ aggregation
  function acc() {
    return { n: 0, w: 0, scored: 0, total: 0, cov: 0, miss: 0, push: 0, over: 0, under: 0, opush: 0,
      nTl: 0, sumTl: 0, sumTotTl: 0, favN: 0, favW: 0, favCov: 0, favMiss: 0, dogN: 0, dogW: 0, errN: 0, errSum: 0, nLine: 0 };
  }
  function add(a, d, i) {
    const sf = d.sf[i], sa = d.sa[i], tot = sf + sa;
    a.n++; a.scored += sf; a.total += tot;
    const win = d.res[i] === 0;
    if (win) a.w++;
    const lr = d.lr[i];
    if (lr) { a.nLine++; if (lr === 1) a.cov++; else if (lr === 2) a.miss++; else a.push++; }
    const ou = d.ou[i];
    if (ou === 1) a.over++; else if (ou === 2) a.under++; else if (ou === 3) a.opush++;
    const tl = d.tline[i];
    if (!Number.isNaN(tl)) { a.nTl++; a.sumTl += tl; a.sumTotTl += tot; }
    const fv = d.fav[i];
    if (fv === 1) { a.favN++; if (win) a.favW++; if (lr === 1) a.favCov++; else if (lr === 2) a.favMiss++; }
    else if (fv === 0) { a.dogN++; if (win) a.dogW++; }
    const ln = d.line[i];
    if (!Number.isNaN(ln)) { a.errN++; a.errSum += Math.abs(sf - sa + ln); }
  }
  const ratio = (x, y) => (y > 0 ? x / y : null);
  function finish(a) {
    return {
      count: a.n, wins: a.w, scored: a.scored,
      avgTotal: ratio(a.total, a.n),
      winPct: ratio(a.w, a.n),
      coverPct: ratio(a.cov, a.cov + a.miss), nCover: a.cov + a.miss, nLine: a.nLine,
      overPct: ratio(a.over, a.over + a.under), nOver: a.over + a.under, nTl: a.nTl,
      avgTl: ratio(a.sumTl, a.nTl), avgTotOnTl: ratio(a.sumTotTl, a.nTl),
      favWinPct: ratio(a.favW, a.favN), favN: a.favN, dogWinPct: ratio(a.dogW, a.dogN), dogN: a.dogN,
      favCoverPct: ratio(a.favCov, a.favCov + a.favMiss), nFavCover: a.favCov + a.favMiss,
      lineErr: ratio(a.errSum, a.errN), nErr: a.errN,
    };
  }

  function groupKey(d, i, brk) {
    switch (brk) {
      case "season": return d.season[i];
      case "team": return d.team[i];
      case "ha": return d.ha[i];
      case "gt": return d.gt[i];
      case "role": return d.fav[i] === 1 ? 0 : d.fav[i] === 0 ? 1 : 2;
    }
    return 0;
  }
  function groupLabel(d, k, brk) {
    switch (brk) {
      case "season": return d.labels.get(k);
      case "team": return d.teams[k];
      case "ha": return ["Home", "Away", "Neutral"][k];
      case "gt": return ["Regular season", "Playoffs"][k];
      case "role": return ["Favorite", "Underdog", "No market data"][k];
    }
    return String(k);
  }

  function compute(d, fv) {
    const all = acc(), groups = new Map(), seen = new Uint8Array(d.nGames);
    let games = 0;
    const team = fv.team === "" ? -1 : +fv.team, opp = fv.opp === "" ? -1 : +fv.opp;
    const ha = fv.ha === "" ? -1 : HA.indexOf(fv.ha), gt = fv.gt === "" ? -1 : GT.indexOf(fv.gt), res = fv.res === "" ? -1 : +fv.res;
    const lo = Math.min(fv.from, fv.to), hi = Math.max(fv.from, fv.to);
    const margins = [];
    const vic = []; // margin of victory, one per game, when no team filter
    for (let i = 0; i < d.n; i++) {
      const s = d.season[i];
      if (s < lo || s > hi) continue;
      if (team >= 0 && d.team[i] !== team) continue;
      if (opp >= 0 && d.opp[i] !== opp) continue;
      if (ha >= 0 && d.ha[i] !== ha) continue;
      if (gt >= 0 && d.gt[i] !== gt) continue;
      if (res >= 0 && d.res[i] !== res) continue;
      add(all, d, i);
      const g = d.gid[i];
      if (!seen[g]) { seen[g] = 1; games++; }
      const k = groupKey(d, i, state.brk);
      let a = groups.get(k); if (!a) { a = acc(); groups.set(k, a); } add(a, d, i);
      const m = d.sf[i] - d.sa[i];
      if (team >= 0) margins.push(m);
      else if (m > 0 || (m === 0 && d.team[i] < d.opp[i])) vic.push(m);
    }
    const rows = Array.from(groups.entries()).map(([k, a]) => ({ k, label: groupLabel(d, k, state.brk), v: finish(a) }));
    if (state.brk === "team") rows.sort((a, b) => a.label.localeCompare(b.label));
    else rows.sort((a, b) => a.k - b.k);
    return { all: finish(all), games, rows, teamSel: team, margins: team >= 0 ? margins : vic };
  }

  // ------------------------------------------------------------------ rendering
  function tile(value, label, sub) {
    const t = document.createElement("div"); t.className = "tile";
    const v = document.createElement("div"); v.className = "value"; v.textContent = value;
    const l = document.createElement("div"); l.className = "label"; l.textContent = label;
    const s = document.createElement("div"); s.className = "sub"; s.textContent = sub;
    t.append(v, l, s); return t;
  }
  function renderTiles(d, r) {
    const a = r.all, sp = SPORTS[d.sport], box = $("tiles");
    box.textContent = "";
    const noLine = "n/a: no " + sp.lineName.toLowerCase() + " data in this slice" + (d.firstLine ? " (lines start " + d.labels.get(d.firstLine) + ")" : "");
    const noTot = "n/a: no total line in this slice" + (d.firstTotal ? " (totals start " + d.labels.get(d.firstTotal) + ")" : "");
    box.appendChild(tile(S.fmt.int(a.count), "Team-games", S.fmt.int(r.games) + " games · each game counts once per team"));
    box.appendChild(tile(S.fmt.pct(a.winPct), r.teamSel >= 0 ? d.teams[r.teamSel] + " win %" : "Win %", "Wins ÷ team-games; ties/draws are non-wins"));
    box.appendChild(tile(a.favN ? S.fmt.pct(a.favWinPct) : "n/a", r.teamSel >= 0 ? d.teams[r.teamSel] + " win % when favored" : "Favorites' win %",
      a.favN ? "n = " + S.fmt.int(a.favN) + " favored team-games" : "No market data in this slice"));
    if (r.teamSel >= 0) {
      box.appendChild(tile(a.nCover ? S.fmt.pct(a.coverPct) : "n/a", d.teams[r.teamSel] + " cover % vs. " + sp.lineName.toLowerCase(),
        a.nCover ? "cover ÷ (cover + miss), n = " + S.fmt.int(a.nCover) + ", pushes excluded" : noLine));
    } else {
      box.appendChild(tile(a.nFavCover ? S.fmt.pct(a.favCoverPct) : "n/a", "Favorites' cover % vs. " + sp.lineName.toLowerCase(),
        a.nFavCover ? "cover ÷ (cover + miss), n = " + S.fmt.int(a.nFavCover) + ", pushes excluded" : noLine));
    }
    box.appendChild(tile(S.fmt.num(a.avgTotal, 1), "Average total " + sp.unit, "Both teams' combined score per game"));
    box.appendChild(tile(a.nOver ? S.fmt.pct(a.overPct) : "n/a", "Over %", a.nOver ? "over ÷ (over + under), n = " + S.fmt.int(a.nOver) + (d.sport === "epl" ? ", line 2.5 goals" : "") : noTot));
  }

  function destroy(id) { if (charts[id]) { charts[id].destroy(); delete charts[id]; } }
  function mkChart(id, cfg) {
    destroy(id);
    const cv = $(id);
    if (!window.Chart) { cv.parentElement.dataset.fallback = "1"; return; }
    charts[id] = new window.Chart(cv, cfg);
  }
  function setText(id, t) { $(id).textContent = t; }
  function measureDef() { return MEASURES.find((m) => m.key === state.measure); }
  function brkDef() { return BREAKS.find((b) => b.key === state.brk); }

  function valueOf(v, key) { return key === "count" ? v.count : key === "scored" ? v.scored : v[key]; }
  function nOf(v, key) { return key === "coverPct" ? v.nCover : key === "overPct" ? v.nOver : v.count; }

  function baseOpts(pct, horizontal, yTitle) {
    const valAxis = { beginAtZero: !pct ? true : false, grid: { color: S.css("--grid") }, ticks: { callback: (v) => (pct ? Math.round(v * 100) + "%" : Math.abs(v) >= 100 ? S.fmt.int(v) : Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 })) }, title: { display: !!yTitle, text: yTitle } };
    if (pct) { valAxis.suggestedMin = 0; valAxis.suggestedMax = 1; valAxis.beginAtZero = true; }
    const catAxis = { grid: { display: false }, ticks: { autoSkip: true, maxRotation: 0 } };
    return {
      indexAxis: horizontal ? "y" : "x",
      scales: horizontal ? { x: valAxis, y: catAxis } : { x: catAxis, y: valAxis },
      plugins: { legend: { display: false }, tooltip: { callbacks: {} } },
    };
  }
  function legendFor(isLine) {
    const l = { display: true, position: "top", align: "start", labels: {} };
    if (isLine) { l.labels.usePointStyle = true; l.labels.pointStyle = "line"; l.labels.pointStyleWidth = 18; }
    return l;
  }
  function sizeBox(id, nCats, horizontal) {
    const box = $(id).parentElement;
    box.style.height = horizontal ? Math.max(300, nCats * 18 + 60) + "px" : "";
  }

  function renderCharts(d, r) {
    const sp = SPORTS[d.sport], col = S.sportColor(d.sport), gray = S.css("--muted");
    const m = measureDef(), b = brkDef(), rows = r.rows;
    const labels = rows.map((x) => x.label);
    const horizontal = state.brk === "team" && rows.length > 8;
    const isSeason = state.brk === "season";
    const unit = sp.unit;

    // chart 1: chosen measure by chosen breakdown
    const mLabel = m.key === "scored" ? "Total " + unit + " scored" : m.key === "avgTotal" ? "Average total " + unit : m.label;
    setText("c1-title", mLabel + " by " + b.label.toLowerCase());
    setText("c1-cap", ({
      count: "Number of team-game rows in each group.",
      scored: "Sum of the team's own score over its rows.",
      avgTotal: "Mean combined score per game.",
      winPct: "Wins ÷ team-games.",
      coverPct: "Cover ÷ (cover + miss) vs. the " + sp.lineName.toLowerCase() + "; groups with no line show no bar.",
      overPct: "Over ÷ (over + under); groups with no total line show no bar.",
    })[m.key]);
    let c1rows = rows.slice();
    if (horizontal) c1rows.sort((x, y) => (valueOf(y.v, m.key) ?? -1) - (valueOf(x.v, m.key) ?? -1));
    sizeBox("c1", c1rows.length, horizontal);
    const o1 = baseOpts(!!m.pct, horizontal, "");
    o1.plugins.tooltip.callbacks.label = (ctx) => {
      const v = c1rows[ctx.dataIndex].v;
      return " " + m.fmt(valueOf(v, m.key)) + "  (n = " + S.fmt.int(nOf(v, m.key)) + ")";
    };
    if (!m.pct && m.key === "avgTotal") o1.scales[horizontal ? "x" : "y"].beginAtZero = false;
    mkChart("c1", {
      type: isSeason ? "line" : "bar",
      data: { labels: c1rows.map((x) => x.label), datasets: [{ label: mLabel, data: c1rows.map((x) => valueOf(x.v, m.key)), borderColor: col, backgroundColor: col, spanGaps: false, pointRadius: isSeason ? 2 : 0, maxBarThickness: 36 }] },
      options: o1,
    });

    // chart 2: favorites vs underdogs win rate by breakdown
    setText("c2-title", "Favorites vs. underdogs: win rate by " + b.label.toLowerCase());
    const hasMkt = rows.some((x) => x.v.favN > 0);
    setText("c2-cap", hasMkt ? "Win % of team-games where the team was favored vs. an underdog (by line, else no-vig moneyline)." :
      "n/a: no market data in this slice" + (d.firstLine ? "; lines start " + d.labels.get(d.firstLine) + "." : "."));
    sizeBox("c2", rows.length, horizontal);
    const o2 = baseOpts(true, horizontal, "");
    o2.plugins.legend = legendFor(isSeason);
    o2.plugins.tooltip.callbacks.label = (ctx) => {
      const v = rows[ctx.dataIndex].v, fav = ctx.datasetIndex === 0;
      return " " + ctx.dataset.label + ": " + S.fmt.pct(fav ? v.favWinPct : v.dogWinPct) + " (n = " + S.fmt.int(fav ? v.favN : v.dogN) + ")";
    };
    mkChart("c2", {
      type: isSeason ? "line" : "bar",
      data: { labels, datasets: [
        { label: "Favorites", data: rows.map((x) => x.v.favWinPct), borderColor: col, backgroundColor: col, pointRadius: isSeason ? 2 : 0, maxBarThickness: 28 },
        { label: "Underdogs", data: rows.map((x) => x.v.dogWinPct), borderColor: gray, backgroundColor: gray, pointRadius: isSeason ? 2 : 0, maxBarThickness: 28 },
      ] },
      options: o2,
    });

    // chart 3: margin distribution
    const ms = r.margins;
    const teamSel = r.teamSel >= 0;
    setText("c3-title", teamSel ? d.teams[r.teamSel] + ": distribution of final margin" : "Distribution of winning margin");
    setText("c3-cap", teamSel ? "Team score minus opponent score, one bar per margin (" + S.fmt.int(ms.length) + " team-games). Negative = loss."
      : "Winner's score minus loser's score, one value per game (" + S.fmt.int(ms.length) + " games; ties/draws at 0). The breakdown switch does not apply here.");
    const cap = d.sport === "nfl" ? 40 : d.sport === "nba" ? 40 : 10;
    const bins = new Map();
    for (const x of ms) { const v = Math.max(-cap, Math.min(cap, x)); bins.set(v, (bins.get(v) || 0) + 1); }
    const lo = teamSel ? -cap : 0;
    const bl = [], bv = [];
    for (let v = lo; v <= cap; v++) { bl.push(v === cap ? cap + "+" : v === -cap ? "−" + cap + "+" : String(v)); bv.push(bins.get(v) || 0); }
    sizeBox("c3", 0, false);
    const o3 = baseOpts(false, false, "");
    o3.scales.x.title = { display: true, text: "margin (" + unit + ")" };
    o3.plugins.tooltip.callbacks.label = (ctx) => " " + S.fmt.int(ctx.raw) + " " + (teamSel ? "team-games" : "games") + " (" + S.fmt.pct(ms.length ? ctx.raw / ms.length : null) + ")";
    mkChart("c3", {
      type: "bar",
      data: { labels: bl, datasets: [{ label: "Games", data: bv, backgroundColor: col, borderColor: col, categoryPercentage: 0.95, barPercentage: 0.9 }] },
      options: o3,
    });

    // chart 4: actual total vs total line
    setText("c4-title", "Average total vs. the posted total line, by " + b.label.toLowerCase());
    const hasTl = rows.some((x) => x.v.nTl > 0);
    setText("c4-cap", hasTl ? "Both averages use only games that had a total line, so they compare like with like." +
      (d.sport === "epl" ? " EPL's line is always 2.5 goals." : "") : noTotMsg(d));
    sizeBox("c4", rows.length, horizontal);
    const o4 = baseOpts(false, horizontal, unit);
    o4.scales[horizontal ? "x" : "y"].beginAtZero = false;
    o4.plugins.legend = legendFor(isSeason);
    o4.plugins.tooltip.callbacks.label = (ctx) => " " + ctx.dataset.label + ": " + S.fmt.num(ctx.raw, 2) + " (n = " + S.fmt.int(rows[ctx.dataIndex].v.nTl) + ")";
    mkChart("c4", {
      type: isSeason ? "line" : "bar",
      data: { labels, datasets: [
        { label: "Actual total", data: rows.map((x) => x.v.avgTotOnTl), borderColor: col, backgroundColor: col, pointRadius: isSeason ? 2 : 0, maxBarThickness: 28 },
        { label: "Total line", data: rows.map((x) => x.v.avgTl), borderColor: gray, backgroundColor: gray, pointRadius: isSeason ? 2 : 0, maxBarThickness: 28 },
      ] },
      options: o4,
    });

    // chart 5: line error
    setText("c5-title", "How far results land from the " + sp.lineName.toLowerCase() + ", by " + b.label.toLowerCase());
    const hasLine = rows.some((x) => x.v.nErr > 0);
    setText("c5-cap", hasLine ? "Mean of |margin + line| in " + unit + ": 0 would mean the line predicted every margin exactly." :
      "n/a: no " + sp.lineName.toLowerCase() + " data in this slice" + (d.firstLine ? "; lines start " + d.labels.get(d.firstLine) + "." : "."));
    sizeBox("c5", rows.length, horizontal);
    const o5 = baseOpts(false, horizontal, unit);
    o5.plugins.tooltip.callbacks.label = (ctx) => " " + S.fmt.num(ctx.raw, 2) + " " + unit + " (n = " + S.fmt.int(rows[ctx.dataIndex].v.nErr) + ")";
    mkChart("c5", {
      type: isSeason ? "line" : "bar",
      data: { labels, datasets: [{ label: "Average line error", data: rows.map((x) => x.v.lineErr), borderColor: col, backgroundColor: col, pointRadius: isSeason ? 2 : 0, maxBarThickness: 36 }] },
      options: o5,
    });
  }
  function noTotMsg(d) { return "n/a: no total line in this slice" + (d.firstTotal ? "; totals start " + d.labels.get(d.firstTotal) + "." : "."); }

  function renderTable(d, r) {
    const m = measureDef(), b = brkDef(), sp = SPORTS[d.sport];
    setText("tbl-title", "Numbers behind the view: by " + b.label.toLowerCase() + " (" + r.rows.length + " groups)");
    const pctN = (p, n) => (n ? S.fmt.pct(p) + " (" + S.fmt.int(n) + ")" : "n/a");
    const rows = r.rows.map((x) => [
      x.label, S.fmt.int(x.v.count), S.fmt.int(x.v.wins), S.fmt.pct(x.v.winPct), S.fmt.num(x.v.avgTotal, 2),
      pctN(x.v.coverPct, x.v.nCover), pctN(x.v.overPct, x.v.nOver), m.fmt(valueOf(x.v, m.key)),
    ]);
    const a = r.all;
    rows.push(["All filtered rows", S.fmt.int(a.count), S.fmt.int(a.wins), S.fmt.pct(a.winPct), S.fmt.num(a.avgTotal, 2),
      pctN(a.coverPct, a.nCover), pctN(a.overPct, a.nOver), m.fmt(valueOf(a, m.key))]);
    const mCol = m.key === "scored" ? "Total " + sp.unit + " scored" : m.key === "avgTotal" ? "Average total" : m.label;
    S.renderTable($("tbl"), [b.label, "Team-games", "Wins", "Win %", "Avg total " + sp.unit, "Cover % (n)", "Over % (n)", mCol + " (measure)"], rows);
    const tr = $("tbl").querySelector("tbody tr:last-child");
    if (tr) tr.style.fontWeight = "700";
  }

  function render() {
    if (!data) return;
    const fv = filterValues();
    const r = compute(data, fv);
    const sp = SPORTS[data.sport];
    const parts = [sp.name, data.labels.get(Math.min(fv.from, fv.to)) + " to " + data.labels.get(Math.max(fv.from, fv.to))];
    if (fv.team !== "") parts.push(data.teams[+fv.team]);
    if (fv.opp !== "") parts.push("vs. " + data.teams[+fv.opp]);
    if (fv.ha) parts.push({ H: "home", A: "away", N: "neutral site" }[fv.ha]);
    if (fv.gt) parts.push(fv.gt === "regular" ? "regular season" : "playoffs");
    if (fv.res !== "") parts.push({ 0: "wins", 1: "losses", 2: "ties", 3: "draws" }[fv.res]);
    setText("status", "Showing " + S.fmt.int(r.all.count) + " team-games: " + parts.join(" · ") + ".");
    renderTiles(data, r);
    if (!r.all.count) {
      ["c1", "c2", "c3", "c4", "c5"].forEach(destroy);
      ["c1", "c2", "c3", "c4", "c5"].forEach((c) => { setText(c + "-title", "No games match these filters"); setText(c + "-cap", "Widen the filters or press Reset."); });
      $("tbl").textContent = "No rows.";
      setText("tbl-title", "Numbers behind the view");
      return;
    }
    renderCharts(data, r);
    renderTable(data, r);
  }
  let deb = null;
  function schedule() { clearTimeout(deb); deb = setTimeout(render, 80); }

  // ------------------------------------------------------------------ switches & tabs
  function buildSeg(id, list, key) {
    const box = $(id);
    box.textContent = "";
    list.forEach((it) => {
      const b = document.createElement("button");
      b.type = "button"; b.textContent = it.label; b.dataset.key = it.key;
      b.setAttribute("aria-pressed", String(state[key] === it.key));
      b.addEventListener("click", () => {
        state[key] = it.key;
        box.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.key === it.key)));
        schedule();
      });
      box.appendChild(b);
    });
  }
  function buildTabs() {
    const box = $("sport-tabs");
    ORDER.forEach((s) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "sport-tab"; b.setAttribute("role", "tab"); b.dataset.sport = s;
      const dot = document.createElement("span"); dot.className = "dot"; dot.style.background = "var(--" + s + ")";
      b.append(dot, document.createTextNode(SPORTS[s].name));
      b.addEventListener("click", () => { if (location.hash !== "#" + s) location.hash = s; else selectSport(s); });
      box.appendChild(b);
    });
  }

  async function selectSport(sport) {
    if (!SPORTS[sport]) sport = "nfl";
    state.sport = sport;
    document.querySelectorAll(".sport-tab").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.sport === sport)));
    setText("hist-title", "Historical " + SPORTS[sport].name + " games");
    if (window.Live) window.Live.show(sport);
    if (window.Projections) window.Projections.show(sport);
    const body = $("dash-body");
    body.classList.add("stale", "loading");
    $("filters").classList.add("stale");
    try {
      const d = await load(sport);
      if (state.sport !== sport) return;
      data = d;
      buildFilters(d);
      $("filters").querySelectorAll("select,button").forEach((x) => { x.disabled = false; });
      render();
    } catch (e) {
      if (state.sport !== sport) return;
      data = null;
      $("tiles").textContent = "";
      ["c1", "c2", "c3", "c4", "c5"].forEach((c) => { destroy(c); setText(c + "-title", ""); setText(c + "-cap", ""); });
      $("tbl").textContent = "";
      setText("tbl-title", "");
      setText("status", e.message + " The historical view for " + SPORTS[sport].name + " will appear once the file is published; nothing is shown in its place.");
      ["f-from", "f-to", "f-team", "f-opp", "f-result"].forEach((id) => { $(id).textContent = ""; });
      $("filters").querySelectorAll("select,button").forEach((x) => { x.disabled = true; });
    } finally {
      if (state.sport === sport) { body.classList.remove("stale", "loading"); $("filters").classList.remove("stale"); }
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    S.applyChartDefaults();
    buildTabs();
    buildSeg("sw-measure", MEASURES, "measure");
    buildSeg("sw-break", BREAKS, "brk");
    ["f-from", "f-to", "f-team", "f-opp", "f-ha", "f-type", "f-result"].forEach((id) => $(id).addEventListener("change", schedule));
    $("f-reset").addEventListener("click", () => { if (data) { resetFilters(data); render(); } });
    document.addEventListener("themechange", () => { S.applyChartDefaults(); render(); });
    if (window.matchMedia) {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      if (mq.addEventListener) mq.addEventListener("change", () => { S.applyChartDefaults(); render(); });
    }
    window.addEventListener("hashchange", () => selectSport(location.hash.slice(1)));
    selectSport(location.hash.slice(1) || "nfl");
  });

  // exposed for testing / cross-checks
  window.Dashboard = { compute: (fv) => (data ? compute(data, fv) : null), render, selectSport, get data() { return data; }, state };
})();
