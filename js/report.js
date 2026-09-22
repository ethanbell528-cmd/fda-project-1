/* Report page. Every number on this page is read from data/report/*.json
   (written by scripts/build_report_data.py); text is filled from the same
   objects the charts use, so the prose and the charts cannot disagree. */
(function () {
  "use strict";
  const S = window.Site;
  const F = S.fmt;
  const NAME = (s) => S.SPORTS[s].name;
  const THE = (s) => (s === "mlb" ? "" : "the ") + NAME(s); // "the NFL", but "MLB"
  const LINE_WORD = { nfl: "spread", nba: "spread", mlb: "run-line", nhl: "puck-line", epl: "Asian-handicap" };
  const charts = [];        // {canvas, build} for re-render on theme change

  // ---------- tiny DOM helpers (textContent only) ----------
  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === "class") n.className = attrs[k];
      else if (k === "style") n.setAttribute("style", attrs[k]);
      else n.setAttribute(k, attrs[k]);
    }
    kids.flat().forEach((k) => { if (k != null) n.appendChild(typeof k === "string" || typeof k === "number" ? document.createTextNode(String(k)) : k); });
    return n;
  }
  const B = (x) => ({ strong: x });
  // tagged template: strings as text, B(x) values as <strong>, others as text
  function P(strings, ...vals) {
    const p = el("p");
    strings.forEach((s, i) => {
      p.appendChild(document.createTextNode(s));
      if (i < vals.length) {
        const v = vals[i];
        if (v && typeof v === "object" && "strong" in v) p.appendChild(el("strong", null, String(v.strong)));
        else if (v != null) p.appendChild(document.createTextNode(String(v)));
      }
    });
    return p;
  }
  const pct = (v, d = 1) => F.pct(v, d);
  const pts = (a, b) => ((a - b) * 100).toFixed(1); // percentage-point gap
  const listJoin = (arr) => arr.length <= 1 ? arr.join("") : arr.slice(0, -1).join(", ") + " and " + arr[arr.length - 1];

  async function j(name) {
    try { return await S.loadJSON("data/report/" + name + ".json"); } catch (e) { console.warn(e); return null; }
  }

  // ---------- chart plumbing ----------
  const color = (s) => S.sportColor(s);
  const INK2 = () => S.css("--ink-2");
  const ACCENT = () => S.css("--accent");
  const MUTED = () => S.css("--muted");

  // Draw a labelled horizontal reference line (e.g. 50%) and end-of-line labels.
  const refPlugin = {
    id: "refline",
    afterDatasetsDraw(chart, _a, opts) {
      const { ctx, chartArea, scales } = chart;
      if (opts && opts.y != null && scales.y) {
        const y = scales.y.getPixelForValue(opts.y);
        ctx.save();
        ctx.strokeStyle = S.css("--axis"); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(chartArea.left, y); ctx.lineTo(chartArea.right, y); ctx.stroke();
        ctx.fillStyle = MUTED(); ctx.font = "600 11px " + S.css("--font");
        ctx.textAlign = "right"; ctx.fillText(opts.label || "", chartArea.right - 4, y - 5);
        ctx.restore();
      }
      if (opts && opts.endLabels) {
        const items = [];
        chart.data.datasets.forEach((ds, i) => {
          const meta = chart.getDatasetMeta(i);
          if (meta.hidden || !meta.data.length) return;
          let k = ds.data.length - 1;
          while (k >= 0 && (ds.data[k] == null || (typeof ds.data[k] === "object" && ds.data[k].y == null))) k--;
          if (k < 0) return;
          const pt = meta.data[k];
          items.push({ x: pt.x, y: pt.y, text: ds.label, color: ds.borderColor });
        });
        items.sort((a, b) => a.y - b.y);
        for (let i = 1; i < items.length; i++) if (items[i].y - items[i - 1].y < 13) items[i].y = items[i - 1].y + 13;
        ctx.save();
        ctx.font = "700 11px " + S.css("--font"); ctx.textBaseline = "middle"; ctx.textAlign = "left";
        items.forEach((it) => {
          ctx.strokeStyle = it.color; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(it.x + 4, it.y); ctx.lineTo(it.x + 12, it.y); ctx.stroke();
          ctx.fillStyle = INK2(); ctx.fillText(it.text, it.x + 15, it.y);
        });
        ctx.restore();
      }
    },
  };

  function chartCard(opts) {
    // opts: {title, caption, height, build(canvas) -> Chart, table:{headers, rows}, multi: [{title, build}]}
    const card = el("div", { class: "card chart-card" });
    card.appendChild(el("h3", null, opts.title));
    card.appendChild(el("p", { class: "caption" }, opts.caption));
    const boxes = [];
    if (opts.multi) {
      const grid = el("div", { class: "multiples" });
      opts.multi.forEach((m) => {
        const cell = el("div", { class: "multiple" }, el("div", { class: "multiple-title" }, m.title));
        const box = el("div", { class: "chart-box short" });
        const cv = el("canvas", { role: "img", "aria-label": m.title });
        box.appendChild(cv); cell.appendChild(box); grid.appendChild(cell);
        boxes.push({ box, cv, build: m.build });
      });
      card.appendChild(grid);
    } else {
      const box = el("div", { class: "chart-box" + (opts.short ? " short" : "") });
      if (opts.height) box.style.height = opts.height + "px";
      const cv = el("canvas", { role: "img", "aria-label": opts.title });
      box.appendChild(cv); card.appendChild(box);
      boxes.push({ box, cv, build: opts.build });
    }
    let det = null;
    if (opts.table) {
      det = el("details", { class: "data-table" }, el("summary", null, "Show the numbers behind this chart"));
      const holder = el("div");
      S.renderTable(holder, opts.table.headers, opts.table.rows);
      det.appendChild(holder);
      card.appendChild(det);
    }
    boxes.forEach((b) => {
      if (!window.Chart) {
        b.box.textContent = "";
        b.box.appendChild(el("div", { class: "chart-fallback" }, "The chart library could not load (offline or blocked), so the chart is hidden. The numbers are in the table below."));
        b.box.style.height = "auto";
        if (det) det.open = true;
        return;
      }
      const entry = { cv: b.cv, build: b.build, chart: null };
      charts.push(entry);
    });
    return card;
  }

  function renderAllCharts() {
    if (!S.applyChartDefaults()) return;
    charts.forEach((c) => {
      if (c.chart) c.chart.destroy();
      try { c.chart = c.build(c.cv); } catch (e) { console.error(e); }
    });
  }

  const pctAxis = (min, max) => ({ min, max, ticks: { callback: (v) => v + "%" }, grid: { color: S.css("--grid") } });
  const seasonAxis = () => ({ type: "linear", ticks: { stepSize: 5, callback: (v) => String(v) }, grid: { display: false } });
  const tipPct = (d = 1) => ({ callbacks: { label: (c) => ` ${c.parsed.y == null ? "n/a" : c.parsed.y.toFixed(d) + "%"}  ${c.dataset.label}` } });

  // ---------- section scaffold ----------
  const toc = [];
  function section(id, kicker, sports, title, paras, card) {
    const sec = el("section", { class: "finding", id });
    const k = el("div", { class: "kicker" });
    sports.forEach((s) => k.appendChild(el("span", { class: "dot", style: "background:var(--" + s + ")" })));
    k.appendChild(document.createTextNode(kicker));
    sec.appendChild(k);
    sec.appendChild(el("h2", null, title));
    paras.forEach((p) => p && sec.appendChild(p));
    if (card) sec.appendChild(card);
    document.getElementById("findings").appendChild(sec);
    toc.push({ id, label: kicker });
    return sec;
  }

  // ---------- 1. favorites ----------
  function fFavorites(d) {
    const rows = d.rows;
    const spread = rows.filter((r) => r.sport === "nfl" || r.sport === "nba");
    const best = rows.slice().sort((a, b) => b.fav_win - a.fav_win)[0];
    const worst = rows.slice().sort((a, b) => a.fav_win - b.fav_win)[0];
    const title = `Favorites win ${pct(worst.fav_win, 0)} to ${pct(best.fav_win, 0)} of games, but against the spread they are a coin flip: ${spread.map((r) => NAME(r.sport) + " " + pct(r.fav_cover)).join(", ")}`;
    const paras = [
      P`The team the betting market favors wins most of the time in every sport: ${B(pct(best.fav_win))} in ${THE(best.sport)} (${best.first} to ${best.last}, ${F.int(best.fav_rows)} favorite team-games) down to ${B(pct(worst.fav_win))} in ${THE(worst.sport)}, where ${worst.sport === "epl" ? "a further " + pct(worst.fav_draw) + " of favorites' matches end in a draw" : "upsets are more common"}. That is exactly what the line is for: it moves the price until both sides are equally attractive, so the favorite's edge in winning disappears once the handicap is applied.`,
      P`Against the handicap, ${listJoin(spread.map((r) => `${NAME(r.sport)} favorites covered ${pct(r.fav_cover)} of ${F.int(r.fav_cover_n)} decided bets`))}, with pushes left out. ${rows.filter((r) => r.sport === "epl").map((r) => `EPL favorites covered the Asian handicap ${pct(r.fav_cover)} of the time (${pct(r.push_rate)} pushes). `).join("")}${rows.filter((r) => r.sport === "nhl" || r.sport === "mlb").map((r) => `${NAME(r.sport)} is different by design: its ${r.line_name} makes the favorite win by two or more, and favorites managed that only ${pct(r.fav_cover)} of the time (${r.first} to ${r.last}). `).join("")}In the point-spread sports, neither side's cover rate is far enough from 50% to beat the standard −110 price, which needs 52.4%. Puck-line and run-line bets are priced at very different odds, so their cover rates are not measured against 50%.`,
    ];
    const card = chartCard({
      title: "Favorites: how often they win and how often they cover",
      caption: "Share of favorite team-games won (ties and draws count as non-wins) and share that covered the line (pushes excluded). Seasons with a betting line only.",
      build: (cv) => new Chart(cv, {
        type: "bar",
        data: {
          labels: rows.map((r) => NAME(r.sport)),
          datasets: [
            { label: "Favorite wins", data: rows.map((r) => r.fav_win * 100), backgroundColor: INK2(), borderWidth: 0 },
            { label: "Favorite covers the line", data: rows.map((r) => r.fav_cover * 100), backgroundColor: ACCENT(), borderWidth: 0 },
          ],
        },
        options: { scales: { y: pctAxis(0, 80), x: { grid: { display: false } } }, plugins: { tooltip: tipPct(), refline: { y: 50, label: "50%" } }, datasets: { bar: { categoryPercentage: 0.7, barPercentage: 0.9 } } },
        plugins: [refPlugin],
      }),
      table: { headers: ["Sport", "Seasons with a line", "Favorite team-games", "Favorite win %", "Favorite cover %", "Decided bets", "Push %", "Line type"],
        rows: rows.map((r) => [NAME(r.sport), `${r.first} to ${r.last}`, F.int(r.fav_rows), pct(r.fav_win), pct(r.fav_cover), F.int(r.fav_cover_n), pct(r.push_rate), r.line_name]) },
    });
    section("favorites", "Cross-sport · favorites", rows.map((r) => r.sport), title, paras, card);
  }

  // ---------- 2. home edge ----------
  function fHome(d) {
    const o = d.overall;
    const by = Object.fromEntries(o.map((x) => [x.sport, x]));
    const nba = by.nba;
    const covidLows = o.filter((x) => x.covid_label && x.min_season === x.covid_label);
    const title = nba
      ? `Home-court advantage is shrinking: NBA home teams won ${pct(nba.early)} of games in ${nba.early_label} but ${pct(nba.late)} in ${nba.late_label}`
      : "Home advantage by sport";
    const paras = [];
    paras.push(P`Across the full span, home teams won ${listJoin(o.map((x) => `${pct(x.home_win)} in ${THE(x.sport)}`))} (neutral-site games excluded). ${o.filter((x) => x.sport !== "nhl" && x.early - x.late >= 0.01).map((x) => `${NAME(x.sport)} home win % fell from ${pct(x.early)} in its first ten seasons to ${pct(x.late)} in its last ten`).join("; ")}.${o.filter((x) => x.sport !== "nhl" && Math.abs(x.early - x.late) < 0.01).map((x) => ` ${NAME(x.sport)} barely moved (${pct(x.early)} to ${pct(x.late)}).`).join("")}`);
    if (covidLows.length) {
      paras.push(P`The lowest home win rate in the whole data set for ${listJoin(covidLows.map((x) => NAME(x.sport)))} came in ${listJoin(covidLows.map((x) => `${x.covid_label} (${pct(x.covid)})`))}, the seasons played mostly without fans because of COVID-19. ${by.nhl ? `The NHL moves the other way (${pct(by.nhl.early)} to ${pct(by.nhl.late)}), but that is mostly an accounting change: ${pct(by.nhl.tie_early)} of home games in ${by.nhl.early_label} ended in ties, which count as non-wins, and ties were abolished in 2005-06.` : ""}`);
    }
    const partial = o.filter((x) => x.partial_excluded && x.partial_excluded.length).map((x) => `${NAME(x.sport)} ${x.partial_excluded.join(", ")}`);
    const card = chartCard({
      title: "Home win % by season",
      caption: `Share of home team-games won, by season (x-axis = year the season started). Neutral sites excluded; ties and draws count as non-wins, which is why EPL sits lowest.${partial.length ? " Seasons still in progress are left out: " + partial.join(", ") + "." : ""}`,
      height: 380,
      build: (cv) => new Chart(cv, {
        type: "line",
        data: { datasets: o.map((x) => ({ label: NAME(x.sport), data: d.series[x.sport].map((p) => ({ x: p.season, y: p.pct * 100, label: p.label, games: p.games })), borderColor: color(x.sport), backgroundColor: color(x.sport) })) },
        options: {
          layout: { padding: { right: 56 } },
          scales: { x: seasonAxis(), y: pctAxis(30, 70) },
          plugins: { legend: { position: "top", align: "start" }, refline: { endLabels: true },
            tooltip: { callbacks: { title: (items) => items.length ? "Season starting " + items[0].parsed.x : "", label: (c) => ` ${c.parsed.y.toFixed(1)}%  ${c.dataset.label} (${c.raw.label}, ${F.int(c.raw.games)} home games)` } } },
          interaction: { mode: "x", intersect: false },
        },
        plugins: [refPlugin],
      }),
      table: { headers: ["Sport", "All seasons", "First 10 seasons", "Last 10 seasons", "Best season", "Worst season"],
        rows: o.map((x) => [NAME(x.sport), `${pct(x.home_win)} of ${F.int(x.games)}`, `${pct(x.early)} (${x.early_label})`, `${pct(x.late)} (${x.late_label})`, `${pct(x.max)} (${x.max_season})`, `${pct(x.min)} (${x.min_season})`]) },
    });
    section("home-edge", "Cross-sport · home advantage", o.map((x) => x.sport), title, paras, card);
  }

  // ---------- 3. scoring eras ----------
  function fScoring(d) {
    const sm = d.summary;
    const top = sm.slice().sort((a, b) => b.latest_index - a.latest_index)[0];
    const flat = sm.slice().sort((a, b) => Math.abs(a.latest_index - 100) - Math.abs(b.latest_index - 100))[0];
    const title = `Scoring eras: ${NAME(top.sport)} games now average ${F.num(top.latest_avg, 1)} ${top.unit}, ${F.num(top.latest_index - 100, 0)}% above the 1990s, while ${NAME(flat.sport)} scoring is within ${F.num(Math.abs(flat.latest_index - 100), 0)}% of where it started`;
    const paras = [
      P`Each line divides a season's average combined score by the average over that sport's first ten seasons (= 100), so sports with very different scoring can share one axis. In the most recent season shown, ${listJoin(sm.map((x) => `${NAME(x.sport)} games averaged ${F.num(x.latest_avg, 2)} ${x.unit} in ${x.latest_label} (index ${F.num(x.latest_index, 0)})`))}.`,
      P`The low points line up with well-known eras: ${listJoin(sm.map((x) => `${NAME(x.sport)} bottomed out in ${x.low_label} at ${F.num(x.low_avg, 2)} ${x.unit}`))}. The highs were ${listJoin(sm.map((x) => `${x.high_label} for ${THE(x.sport)} (${F.num(x.high_avg, 2)})`))}.`,
    ];
    const card = chartCard({
      title: "Average combined score per game, indexed to each sport's first ten seasons = 100",
      caption: "Index = season average total ÷ average total over the sport's first ten seasons × 100. Regular season and playoffs; seasons in progress left out.",
      height: 380,
      build: (cv) => new Chart(cv, {
        type: "line",
        data: { datasets: sm.map((x) => ({ label: NAME(x.sport), data: d.series[x.sport].map((p) => ({ x: p.season, y: p.index, avg: p.avg, label: p.label })), borderColor: color(x.sport), backgroundColor: color(x.sport) })) },
        options: {
          layout: { padding: { right: 56 } },
          scales: { x: seasonAxis(), y: { grid: { color: S.css("--grid") } } },
          plugins: { refline: { y: 100, label: "first-10-season average = 100", endLabels: true },
            tooltip: { callbacks: { title: (items) => items.length ? "Season starting " + items[0].parsed.x : "", label: (c) => ` ${c.parsed.y.toFixed(1)}  ${c.dataset.label} (${c.raw.avg} ${sm.find((x) => NAME(x.sport) === c.dataset.label).unit} per game)` } } },
          interaction: { mode: "x", intersect: false },
        },
        plugins: [refPlugin],
      }),
      table: { headers: ["Sport", "Baseline seasons", "Baseline avg", "Latest full season", "Latest avg", "Index", "Lowest season", "Highest season"],
        rows: sm.map((x) => [NAME(x.sport), x.base_label, F.num(x.base_avg, 2), x.latest_label, F.num(x.latest_avg, 2), F.num(x.latest_index, 1), `${x.low_label} (${F.num(x.low_avg, 2)})`, `${x.high_label} (${F.num(x.high_avg, 2)})`]) },
    });
    section("scoring", "Cross-sport · scoring eras", sm.map((x) => x.sport), title, paras, card);
  }

  // ---------- 4. totals ----------
  function fTotals(d) {
    const rows = d.rows.filter((r) => r.over != null);
    const us = rows.filter((r) => r.sport !== "epl");
    const lo = us.slice().sort((a, b) => a.over - b.over)[0], hi = us.slice().sort((a, b) => b.over - a.over)[0];
    const epl = rows.find((r) => r.sport === "epl");
    const title = `The over/under is a near-perfect coin flip: overs hit ${pct(lo.over)} to ${pct(hi.over)} of the time in US sports`;
    const paras = [
      P`Bookmakers set the total so that bets on the over and the under balance. Over the seasons with a posted total, ${listJoin(us.map((r) => `${NAME(r.sport)} games went over ${pct(r.over)} of ${F.int(r.games)} decided games`))} (pushes excluded). The average line sat within a fraction of the average result: ${listJoin(us.map((r) => `${NAME(r.sport)} ${F.num(r.avg_line, 1)} posted vs ${F.num(r.avg_actual, 1)} scored`))}.`,
      P`Being right on average is not the same as being right game by game: the typical miss was ${listJoin(us.map((r) => `${F.num(r.mae, 1)} in ${THE(r.sport)}`))} (mean absolute gap between the total and the line).${epl ? ` The EPL line is different: football-data.co.uk only prices a fixed 2.5-goal line, so it is not balanced to 50%. Premier League matches went over 2.5 goals ${pct(epl.over)} of the time (${epl.first} to ${epl.last}, average ${F.num(epl.avg_actual, 2)} goals).` : ""}`,
    ];
    const card = chartCard({
      title: "Share of games that went over the posted total",
      caption: "Over ÷ (over + under), pushes excluded, one row per game. Seasons with a posted total only (EPL: fixed 2.5-goal line).",
      short: true,
      build: (cv) => new Chart(cv, {
        type: "bar",
        data: { labels: rows.map((r) => NAME(r.sport)), datasets: [{ label: "Over %", data: rows.map((r) => r.over * 100), backgroundColor: rows.map((r) => color(r.sport)), borderWidth: 0, maxBarThickness: 56 }] },
        options: { scales: { y: pctAxis(40, 60), x: { grid: { display: false } } }, plugins: { legend: { display: false }, tooltip: tipPct(), refline: { y: 50, label: "50%" } }, interaction: { mode: "nearest", intersect: true } },
        plugins: [refPlugin],
      }),
      table: { headers: ["Sport", "Seasons", "Decided games", "Over %", "Push %", "Avg line", "Avg total", "Mean abs. miss"],
        rows: rows.map((r) => [NAME(r.sport), `${r.first} to ${r.last}`, F.int(r.games), pct(r.over), pct(r.push_rate), F.num(r.avg_line, 2), F.num(r.avg_actual, 2), F.num(r.mae, 2)]) },
    });
    section("totals", "Cross-sport · over/under", rows.map((r) => r.sport), title, paras, card);
  }

  // ---------- 5. rest ----------
  const REST_PHRASE = {
    nfl: ["on a short week (5 days or fewer)", "on a normal week (6 to 8 days)"],
    nba: ["on the second night of a back-to-back", "with two or more days of rest"],
    nhl: ["on the second night of a back-to-back", "with two or more days of rest"],
    mlb: ["the day after playing (or in a doubleheader)", "after a day off"],
  };
  function fRest(d) {
    const rows = d.rows;
    const by = Object.fromEntries(rows.map((r) => [r.sport, r]));
    const nba = by.nba;
    const title = nba
      ? `Tired legs are real but already priced: NBA teams on a back-to-back against a rested opponent won ${pct(nba.mismatch_win)}, and still covered ${pct(nba.mismatch_cover)}`
      : "Rest and travel effects";
    const paras = [];
    paras.push(P`Rest is measured as days since a team's previous regular-season game. ${rows.map((r) => `In ${THE(r.sport)}, teams won ${pct(r.short_win)} of ${F.int(r.short_n)} games ${REST_PHRASE[r.sport][0]} and ${pct(r.normal_win)} of ${F.int(r.normal_n)} ${REST_PHRASE[r.sport][1]}.`).join(" ")}`);
    const priced = rows.filter((r) => r.mismatch_odds_n > 200);
    if (priced.length) {
      const se = (r) => Math.sqrt(r.mismatch_implied * (1 - r.mismatch_implied) / r.mismatch_odds_n);
      const off = priced.filter((r) => Math.abs(r.mismatch_odds_win - r.mismatch_implied) > 2 * se(r));
      paras.push(P`The market prices most of this in. When a tired team met a rested one and a moneyline existed, ${listJoin(priced.map((r) => `${NAME(r.sport)} tired teams won ${pct(r.mismatch_odds_win)} of ${F.int(r.mismatch_odds_n)} games against a no-vig implied ${pct(r.mismatch_implied)} (${((r.mismatch_odds_win - r.mismatch_implied) / se(r)).toFixed(1)} standard errors)`))}. ${off.length ? `Only the ${listJoin(off.map((r) => NAME(r.sport)))} gap is more than two standard errors from zero, which suggests the market slightly overrates tired ${off.map((r) => NAME(r.sport)).join("/")} teams, but a gap that size appears by chance in roughly one test in twenty.` : "Every gap is within two standard errors of zero."} ${nba ? `Against the spread, NBA back-to-back teams covered ${pct(nba.short_cover)} (${F.int(nba.short_cover_n)} bets), no different from rested teams (${pct(nba.normal_cover)}).` : ""}${by.nfl ? ` NFL short weeks (mostly Thursday games) show no measurable effect: ${pct(by.nfl.short_win)} vs ${pct(by.nfl.normal_win)}, because both teams are usually on the same short week.` : ""}${by.nhl ? " NHL puck-line cover rates are not compared here because tired teams are more often underdogs, who get +1.5 goals." : ""}`);
    }
    const card = chartCard({
      title: "Win % on short rest vs normal rest",
      caption: `Regular season only. Short rest: NFL 5 days or fewer, NBA/NHL back-to-back (1 day), MLB played the day before. ${rows.length ? rows[0].first : ""} onward. EPL is left out because cup and European matches, which cause most short rests, are not in the data.`,
      short: true,
      build: (cv) => new Chart(cv, {
        type: "bar",
        data: { labels: rows.map((r) => NAME(r.sport)), datasets: [
          { label: "Normal rest", data: rows.map((r) => r.normal_win * 100), backgroundColor: INK2(), borderWidth: 0 },
          { label: "Short rest", data: rows.map((r) => r.short_win * 100), backgroundColor: ACCENT(), borderWidth: 0 },
        ] },
        options: { scales: { y: pctAxis(30, 60), x: { grid: { display: false } } }, plugins: { tooltip: tipPct(), refline: { y: 50, label: "50%" } }, datasets: { bar: { categoryPercentage: 0.6, barPercentage: 0.9 } } },
        plugins: [refPlugin],
      }),
      table: { headers: ["Sport", "Short rest", "Games", "Win %", "Cover %", "Normal rest", "Games", "Win %", "Cover %", "Tired vs rested: win %", "Implied"],
        rows: rows.map((r) => [NAME(r.sport), r.short_name, F.int(r.short_n), pct(r.short_win), pct(r.short_cover), r.normal_name, F.int(r.normal_n), pct(r.normal_win), pct(r.normal_cover), `${pct(r.mismatch_win)} of ${F.int(r.mismatch_n)}`, r.mismatch_odds_n ? pct(r.mismatch_implied) : "n/a"]) },
    });
    section("rest", "NFL · NBA · MLB · NHL · rest", rows.map((r) => r.sport), title, paras, card);
  }

  // ---------- 6. EPL draws ----------
  function fDraws(d) {
    if (!d) return;
    const close = d.buckets[0], far = d.buckets[d.buckets.length - 1];
    const big = d.buckets.slice().sort((a, b) => Math.abs(b.z) - Math.abs(a.z))[0];
    const title = `One Premier League match in four is a draw (${pct(d.draw_rate)}), and the odds price it almost exactly: ${pct(d.implied_draw)} implied vs ${pct(d.actual_draw_odds)} actual`;
    const paras = [
      P`Across ${F.int(d.matches)} matches from ${d.first} to ${d.last}, home teams won ${B(pct(d.home_rate))}, away teams ${B(pct(d.away_rate))} and ${B(pct(d.draw_rate))} ended level. In the ${F.int(d.odds_matches)} matches with 1X2 odds, the no-vig implied draw probability averaged ${pct(d.implied_draw)} against an actual draw rate of ${pct(d.actual_draw_odds)}.`,
      P`The draw depends on how evenly matched the teams are. When the market saw the teams within ${close.bucket} of each other in win probability, ${pct(close.actual)} of ${F.int(close.games)} matches were drawn (implied ${pct(close.implied)}); in the most lopsided matches (${far.bucket} apart) only ${pct(far.actual)} were (implied ${pct(far.implied)}). The largest gap between implied and actual is ${pts(Math.abs(big.actual - big.implied), 0)} percentage points (${big.bucket}, ${Math.abs(big.z).toFixed(1)} standard errors), so ${Math.abs(big.z) >= 2 ? "the market may slightly " + (big.actual > big.implied ? "underprice" : "overprice") + " draws in that bucket, although with seven buckets tested one gap this size is not unusual" : "every gap is within what chance produces at these sample sizes"}.`,
    ];
    const card = chartCard({
      title: "EPL draw rate by how close the market rated the two teams",
      caption: "x-axis: gap between the no-vig home and away win probabilities, in percentage points. Bars: actual share of matches drawn. Line: average no-vig implied draw probability. Matches with 1X2 odds, 2000-01 onward.",
      short: true,
      build: (cv) => new Chart(cv, {
        data: { labels: d.buckets.map((b) => b.bucket), datasets: [
          { type: "bar", label: "Actual draw %", data: d.buckets.map((b) => b.actual * 100), backgroundColor: color("epl"), borderWidth: 0, order: 2 },
          { type: "line", label: "Market-implied draw %", data: d.buckets.map((b) => b.implied * 100), borderColor: INK2(), backgroundColor: INK2(), pointRadius: 4, order: 1 },
        ] },
        options: { scales: { y: pctAxis(0, 40), x: { grid: { display: false }, title: { display: true, text: "Gap in win probability (points)" } } }, plugins: { tooltip: tipPct() } },
      }),
      table: { headers: ["Win-probability gap", "Matches", "Actual draw %", "Implied draw %", "Gap in standard errors"], rows: d.buckets.map((b) => [b.bucket, F.int(b.games), pct(b.actual), pct(b.implied), b.z.toFixed(2)]) },
    });
    section("epl-draws", "EPL · draws", ["epl"], title, paras, card);
  }

  // ---------- 7. star arcs ----------
  function fStars(d) {
    const rows = d.rows;
    const title = `The biggest careers in the data: ${listJoin(rows.map((r) => `${r.player} (${F.int(r.career_total)} ${r.stat})`))}`;
    const paras = [
      P`For each sport, this finds the player with the most career regular-season totals in the headline stat within the data's player span, then plots that player's season-by-season arc. ${rows.map((r) => `${r.player} leads ${THE(r.sport)} with ${F.int(r.career_total)} ${r.stat} over ${r.seasons} seasons (${r.runner_up} is next with ${F.int(r.runner_up_total)}); the peak was ${F.int(r.peak)} in ${r.peak_label}, and ${r.led_league === 0 ? "no single season of it topped the league" : `it topped every other player's total in ${r.led_league} season${r.led_league === 1 ? "" : "s"}`}.`).join(" ")}`,
      P`Spans matter: player-game data starts in ${listJoin(rows.map((r) => `${r.span_first} for ${THE(r.sport)}`))}, so earlier careers are cut off. That is why pre-2001 NBA or pre-1999 NFL stars do not appear.`,
    ];
    const card = chartCard({
      title: "Career arcs of each sport's career leader in this data",
      caption: "Regular-season totals by season; players traded mid-season are summed across teams. One small chart per sport, each on its own axis.",
      multi: rows.map((r) => ({
        title: `${NAME(r.sport)} · ${r.player} · ${r.stat}`,
        build: (cv) => new Chart(cv, {
          type: "bar",
          data: { labels: r.arc.map((a) => a.label), datasets: [{ label: r.stat, data: r.arc.map((a) => a.val), backgroundColor: color(r.sport), borderWidth: 0 }] },
          options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${F.int(c.parsed.y)} ${r.stat} (${r.arc[c.dataIndex].games} games)` } } },
            scales: { x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 5 } }, y: { beginAtZero: true } }, interaction: { mode: "nearest", intersect: false, axis: "x" } },
        }),
      })),
      table: { headers: ["Sport", "Player", "Stat", "Career total", "Seasons", "Peak season", "Seasons leading the league", "Next best", "Data span"],
        rows: rows.map((r) => [NAME(r.sport), r.player, r.stat, F.int(r.career_total), r.seasons, `${F.int(r.peak)} (${r.peak_label})`, r.led_league, `${r.runner_up} (${F.int(r.runner_up_total)})`, `${r.span_first} to ${r.span_last}`]) },
    });
    section("stars", "Players · career arcs", rows.map((r) => r.sport), title, paras, card);
  }

  // ---------- 8-9. model vs market, backtest (from backtest_<sport>.json) ----------
  function pending(id, kicker, title, text) {
    section(id, kicker, [], title, [P`${text}`], null);
  }

  const SPLIT = { nba: true, nhl: true, epl: true };
  function seasonLabel(s, y) { return SPLIT[s] ? `${y}-${String(y + 1).slice(-2)}` : String(y); }
  function seasonsLabel(s, arr) { return arr && arr.length ? (arr.length === 1 ? seasonLabel(s, arr[0]) : `${seasonLabel(s, arr[0])} to ${seasonLabel(s, arr[arr.length - 1])}`) : ""; }
  function holdoutLabel(b) { return b && b.holdout ? seasonsLabel(b.sport, b.holdout.seasons || []) : ""; }

  // Market comparison lives in holdout.market; if the holdout seasons have no odds
  // (MLB, NHL) the trainer reports the last seasons that do in market_era.
  function marketCmp(b) {
    const h = (b && b.holdout) || {};
    const pack = (m, label, era, trainedOn) => ({
      label, era, trainedOn, games: m.games, model: m.log_loss_model_same_games, market: m.log_loss_market,
      accModel: m.accuracy_model_same_games, accMarket: m.accuracy_market,
    });
    if (h.market && h.market.log_loss_market != null) return pack(h.market, holdoutLabel(b), false, b.train_seasons);
    const e = b && b.market_era;
    if (e && e.market && e.market.log_loss_market != null) return pack(e.market, seasonsLabel(b.sport, e.seasons || []), true, e.train_seasons);
    return null;
  }

  function fModelVsMarket(bt) {
    const sports = S.SPORT_ORDER.filter((s) => bt[s]);
    if (!sports.length) {
      pending("model-vs-market", "Model · vs the market", "Model vs. market: backtest pending", "The model backtests have not been generated yet. Run scripts/train_model.py for each sport, then scripts/build_report_data.py.");
      return;
    }
    const rows = sports.map((s) => {
      const b = bt[s], h = b.holdout || {};
      return { s, b, h, m: marketCmp(b), model: h.win_model && h.win_model.log_loss, base: h.baseline && h.baseline.log_loss, acc: h.win_model && h.win_model.accuracy };
    });
    const cmp = rows.filter((r) => r.m && r.m.model != null && r.m.market != null);
    const beat = cmp.filter((r) => r.m.model < r.m.market);
    const two = rows.filter((r) => r.s !== "epl");
    const beatBase = rows.filter((r) => r.model != null && r.base != null && r.model < r.base);
    let title = "Model vs. market";
    if (cmp.length) {
      title = beat.length
        ? `The model beats the betting market's own probabilities in ${beat.length} of ${cmp.length} sports (${listJoin(beat.map((r) => NAME(r.s)))})`
        : `The market wins: in all ${cmp.length} sports, the betting odds forecast winners better than the model (lower log loss on the same games)`;
    }
    const paras = [
      P`Each sport's model is trained on every season except the last two completed ones, which are held out and never used to choose features, Elo constants or coefficients. On those holdout games, the model beat a naive baseline (always predicting the training-era home win rate) in ${beatBase.length} of ${rows.length} sports: ${listJoin(rows.map((r) => `${NAME(r.s)} log loss ${F.num(r.model, 4)} vs ${F.num(r.base, 4)} (${holdoutLabel(r.b)}, ${F.int(r.h.games)} games)`))}. Lower log loss is better: a coin flip scores 0.693 on a two-outcome game, and an even three-way guess scores 1.099 on an EPL match (home, draw or away).`,
    ];
    if (cmp.length) {
      const detail = listJoin(cmp.map((r) => `${F.num(r.m.market, 4)} in ${THE(r.s)} vs the model's ${F.num(r.m.model, 4)} (${r.m.label}${r.m.era ? `, the last seasons with moneylines, using a copy of the model trained only on ${r.m.trainedOn}` : ""})`));
      const tail = beat.length ? "" : " A simple public-data model does not out-forecast the betting market in any sport, which is what market efficiency predicts: the odds already contain the Elo, rest and form information the model uses, plus injury news and lineups it never sees.";
      paras.push(P`The real test is the market. On the same games, the no-vig betting probabilities scored ${detail}.${tail}`);
    }
    const card = chartCard({
      title: "Holdout log loss: baseline vs model vs market (lower is better)",
      caption: "Log loss of home-win probabilities on the held-out seasons (ties excluded). The market bar appears only where the held-out seasons have moneylines; NBA and NHL are compared with the market on earlier seasons in the table. EPL is a three-outcome forecast on a different scale, so it is in the table only.",
      build: (cv) => new Chart(cv, {
        type: "bar",
        data: { labels: two.map((r) => NAME(r.s)), datasets: [
          { label: "Baseline (home win rate)", data: two.map((r) => r.base), backgroundColor: S.css("--axis"), borderWidth: 0 },
          { label: "Model", data: two.map((r) => r.model), backgroundColor: ACCENT(), borderWidth: 0 },
          { label: "Market (no-vig odds)", data: two.map((r) => (r.m && !r.m.era ? r.m.market : null)), backgroundColor: INK2(), borderWidth: 0 },
        ] },
        options: {
          scales: { y: { min: 0.45, max: 0.72, grid: { color: S.css("--grid") } }, x: { grid: { display: false } } },
          plugins: { tooltip: { callbacks: { label: (c) => ` ${c.parsed.y == null ? "n/a" : c.parsed.y.toFixed(3)}  ${c.dataset.label}` } } },
          datasets: { bar: { categoryPercentage: 0.7, barPercentage: 0.9 } },
        },
      }),
      table: {
        headers: ["Sport", "Holdout", "Games", "Baseline log loss", "Model log loss", "Model accuracy", "Market comparison", "Model (same games)", "Market", "Market accuracy"],
        rows: rows.map((r) => [NAME(r.s), holdoutLabel(r.b), F.int(r.h.games), F.num(r.base, 4), F.num(r.model, 4), pct(r.acc, 2),
          r.m ? `${F.int(r.m.games)} games (${r.m.label})` : "n/a", r.m ? F.num(r.m.model, 4) : "n/a", r.m ? F.num(r.m.market, 4) : "n/a", r.m ? pct(r.m.accMarket, 2) : "n/a"]),
      },
    });
    section("model-vs-market", "Model · vs the market", sports, title, paras, card);
  }

  function wlp(x) { return `${x.wins}-${x.losses}${x.pushes ? "-" + x.pushes : ""}`; }
  // hit rate from the win/loss counts, so the page never re-rounds an already rounded number
  function withHit(x) { return x && x.bets ? Object.assign({}, x, { hit: x.wins + x.losses ? x.wins / (x.wins + x.losses) : null }) : x; }

  function fBacktest(bt) {
    const sports = S.SPORT_ORDER.filter((s) => bt[s]);
    if (!sports.length) return;
    // Line/total picks and edge bets come from the holdout; where the holdout has no lines or
    // moneylines (MLB, NHL; NBA has no moneylines) they come from the trainer's market-era test.
    const rows = sports.map((s) => {
      const b = bt[s], h = b.holdout || {}, e = b.market_era || {};
      const has = (blk, key, sub) => blk[key] && blk[key][sub] && blk[key][sub].bets;
      const lnBlk = has(h, "line", "model_side_vs_line") ? h : (has(e, "line", "model_side_vs_line") ? e : null);
      const tlBlk = has(h, "totals", "model_side_vs_total") ? h : (has(e, "totals", "model_side_vs_total") ? e : null);
      const ebBlk = h.edge_bets_moneyline && h.edge_bets_moneyline.bets ? h : (e.edge_bets_moneyline && e.edge_bets_moneyline.bets ? e : null);
      const lab = (blk) => (!blk ? "n/a" : blk === h ? holdoutLabel(b) : seasonsLabel(s, e.seasons || []));
      return {
        s, b, h,
        ln: withHit(lnBlk && lnBlk.line.model_side_vs_line), lnLab: lab(lnBlk),
        tl: withHit(tlBlk && tlBlk.totals.model_side_vs_total), tlLab: lab(tlBlk),
        eb: ebBlk && ebBlk.edge_bets_moneyline, ebLab: lab(ebBlk),
        priced: s === "nfl" || s === "nba", // standard -110 spreads and totals
        lineMae: lnBlk && lnBlk.line.margin_mae_model, lineMkt: lnBlk && lnBlk.line.margin_mae_market_line,
      };
    });
    const spreadRows = rows.filter((r) => r.priced && r.ln);
    const totRows = rows.filter((r) => r.priced && r.tl);
    const best = spreadRows.slice().sort((a, b) => b.ln.hit - a.ln.hit)[0];
    const profit = rows.filter((r) => (r.ln && r.ln["roi_at_-110"] > 0) || (r.tl && r.tl["roi_at_-110"] > 0));
    const other = rows.filter((r) => !r.priced && r.ln);
    const title = best
      ? `Honest backtest: the model's best record against the spread was ${pct(best.ln.hit)} (${NAME(best.s)}), ${best.ln.hit > 0.5238 ? "above" : "below"} the 52.4% needed to profit at −110`
      : "Honest backtest";
    // two-standard-error band for a 50% bettor over n bets, used to judge whether a record is luck
    const zOf = (x) => { const n = x.wins + x.losses; return n ? (x.wins / n - 0.5) / Math.sqrt(0.25 / n) : 0; };
    const posItems = [];
    rows.forEach((r) => {
      if (r.ln && r.ln["roi_at_-110"] > 0) posItems.push({ what: `${NAME(r.s)} spread picks`, rec: wlp(r.ln), hit: r.ln.hit, z: zOf(r.ln) });
      if (r.tl && r.tl["roi_at_-110"] > 0) posItems.push({ what: `${NAME(r.s)} total picks`, rec: wlp(r.tl), hit: r.tl.hit, z: zOf(r.tl) });
    });
    const nTests = rows.reduce((a, r) => a + (r.ln ? 1 : 0) + (r.tl ? 1 : 0) + (r.eb ? 1 : 0), 0);
    const paras = [
      P`Each game was "bet" on whichever side of the posted line the model's predicted margin favored, and on the over or under whenever the model's predicted total disagreed with the posted total. ${spreadRows.length ? listJoin(spreadRows.map((r) => `${NAME(r.s)} spread picks went ${wlp(r.ln)} (${pct(r.ln.hit)}, ${r.lnLab})`)) + "; " : ""}${totRows.length ? listJoin(totRows.map((r) => `${NAME(r.s)} total picks went ${wlp(r.tl)} (${pct(r.tl.hit)})`)) + "." : ""} ${other.length ? `${listJoin(other.map((r) => `${NAME(r.s)} ${LINE_WORD[r.s]} picks hit ${pct(r.ln.hit)} (${r.lnLab})`))}, but those bets are sold at prices far from −110 that are not in the data, so their hit rate says nothing about profit.` : ""}`,
      P`${rows.filter((r) => r.eb).map((r) => `Betting on ${NAME(r.s)} moneylines only when the model's win probability beat the no-vig market by more than ${pct(r.eb.threshold, 0)} produced ${F.int(r.eb.bets)} bets (${r.ebLab}), ${F.int(r.eb.wins)} wins and a return of ${pct(r.eb.roi, 2)}.`).join(" ")} ${profit.length
        ? `${posItems.length === 1 ? "The only positive result is" : "The positive results are"} ${listJoin(posItems.map((x) => `${x.what} (${x.rec}, ${pct(x.hit)}, ${x.z.toFixed(1)} standard errors above a coin flip)`))}. With ${nTests} strategies tested in this section, one result about two standard errors out is roughly what luck alone produces, so it is not evidence of a lasting edge.`
        : "None of these strategies made money, which is the honest result: the closing line is very hard to beat."} ${rows.filter((r) => r.priced && r.lineMae != null).length ? `The model's predicted margins missed by ${listJoin(rows.filter((r) => r.priced && r.lineMae != null).map((r) => `${F.num(r.lineMae, 1)} points in ${THE(r.s)} (the market line missed by ${F.num(r.lineMkt, 1)})`))} on average.` : ""}`,
    ];
    const chartRows = rows.filter((r) => r.priced);
    const lineCard = chartCard({
      title: "Hit rate of the model's picks against the spread and the total (NFL, NBA)",
      caption: "Share of decided bets won (pushes excluded) on held-out seasons. The reference line at 52.4% is the break-even rate at the standard −110 price. Puck-line, run-line and Asian-handicap picks are in the table only, because their prices vary.",
      short: true,
      build: (cv) => new Chart(cv, {
        type: "bar",
        data: { labels: chartRows.map((r) => NAME(r.s)), datasets: [
          { label: "Picks vs the spread", data: chartRows.map((r) => (r.ln ? r.ln.hit * 100 : null)), backgroundColor: ACCENT(), borderWidth: 0 },
          { label: "Picks vs the total", data: chartRows.map((r) => (r.tl ? r.tl.hit * 100 : null)), backgroundColor: INK2(), borderWidth: 0 },
        ] },
        options: {
          scales: { y: pctAxis(40, 60), x: { grid: { display: false } } },
          plugins: { tooltip: tipPct(), refline: { y: 52.38, label: "break-even at −110 (52.4%)" } },
          datasets: { bar: { categoryPercentage: 0.6, barPercentage: 0.9 } },
        },
        plugins: [refPlugin],
      }),
      table: {
        headers: ["Sport", "Line type", "Line picks W-L-P", "Hit %", "ROI at −110", "Seasons", "Total picks W-L-P", "Hit %", "ROI at −110", "Edge moneyline bets", "Edge ROI", "Seasons"],
        rows: rows.map((r) => [NAME(r.s), S.SPORTS[r.s].lineName,
          r.ln ? `${r.ln.wins}-${r.ln.losses}-${r.ln.pushes || 0}` : "n/a", r.ln ? pct(r.ln.hit) : "n/a", r.ln && r.ln["roi_at_-110"] != null ? pct(r.ln["roi_at_-110"], 2) : "n/a (price varies)", r.lnLab,
          r.tl ? `${r.tl.wins}-${r.tl.losses}-${r.tl.pushes || 0}` : "n/a", r.tl ? pct(r.tl.hit) : "n/a", r.tl && r.tl["roi_at_-110"] != null ? pct(r.tl["roi_at_-110"], 2) : "n/a (price varies)",
          r.eb ? `${F.int(r.eb.bets)} (${F.int(r.eb.wins)} won)` : "n/a", r.eb && r.eb.roi != null ? pct(r.eb.roi, 2) : "n/a", r.ebLab]),
      },
    });
    const calRows = rows.filter((r) => r.h.calibration_home_win && r.h.calibration_home_win.length);
    const calCard = calRows.length ? chartCard({
      title: "Calibration: predicted vs actual home win rate on the holdout",
      caption: "Holdout games grouped by the model's predicted home win probability (10-point bins). A well-calibrated model sits on the diagonal. Bins with fewer than 20 games are left off the chart but kept in the table.",
      build: (cv) => new Chart(cv, {
        type: "line",
        data: { datasets: [{ label: "Perfect calibration", data: [{ x: 0, y: 0 }, { x: 100, y: 100 }], borderColor: S.css("--axis"), borderWidth: 1, pointRadius: 0, pointHoverRadius: 0 }].concat(calRows.map((r) => ({
          label: NAME(r.s), borderColor: color(r.s), backgroundColor: color(r.s), pointRadius: 4,
          data: r.h.calibration_home_win.filter((c) => c.n >= 20).map((c) => ({ x: c.predicted * 100, y: c.observed * 100, n: c.n })),
        }))) },
        options: {
          scales: { x: { type: "linear", min: 0, max: 100, title: { display: true, text: "Predicted home win %" }, ticks: { callback: (v) => v + "%" }, grid: { display: false } }, y: pctAxis(0, 100) },
          plugins: { tooltip: { filter: (c) => c.datasetIndex > 0, callbacks: { label: (c) => ` ${c.parsed.y.toFixed(1)}% won  ${c.dataset.label} (predicted ${c.parsed.x.toFixed(1)}%, ${c.raw.n} games)` } } },
          interaction: { mode: "nearest", intersect: false },
        },
      }),
      table: { headers: ["Sport", "Bin", "Games", "Predicted", "Actual"], rows: calRows.flatMap((r) => r.h.calibration_home_win.map((c) => [NAME(r.s), c.bin, F.int(c.n), pct(c.predicted, 2), pct(c.observed, 2)])) },
    }) : null;
    const sec = section("backtest", "Model · honest backtest", sports, title, paras, lineCard);
    if (calCard) sec.appendChild(calCard);
  }

  // ---------- 10. this week's games (live) ----------
  function fLive() {
    const sec = section("this-week", "Live · this week", S.SPORT_ORDER, "This week's games: the model's prediction next to the live odds", [
      P`This section is live. It reads today's games (or the next scheduled ones) from ESPN's public scoreboard and shows the current line, total and moneyline, from The Odds API when a key is configured and otherwise from the odds ESPN carries. Beside them it puts the model's win probability, predicted line and predicted total, and the market's no-vig probability. An edge is flagged only when the model's probability is more than the documented threshold above the market's. The panel refreshes every 60 seconds and changes with the schedule, so its numbers are not part of the historical findings above.`,
    ], null);
    const tabs = el("div", { class: "sport-tabs", role: "tablist", "aria-label": "Sport for live games" });
    const card = el("div", { class: "card", id: "live" },
      el("div", { class: "live-head" }, el("h3", { style: "margin:0;font-size:1rem" }, "Live and upcoming games"), el("span", { class: "small muted", id: "live-updated", "aria-live": "polite" }, "Not loaded yet")),
      el("p", { class: "small muted", id: "live-note", style: "margin:4px 0 0" }),
      el("div", { class: "games", id: "live-games" }), el("div", { id: "live-more" }));
    sec.appendChild(tabs);
    sec.appendChild(card);
    if (!window.Live || typeof window.Live.show !== "function") {
      document.getElementById("live-note").textContent = "The live module (js/live.js) did not load, so live games cannot be shown. The historical findings above are unaffected.";
      return;
    }
    let cur = null;
    const pick = (s) => {
      cur = s;
      tabs.querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.s === s)));
      window.Live.show(s);
    };
    S.SPORT_ORDER.forEach((s) => {
      const b = el("button", { class: "sport-tab", type: "button", role: "tab", "data-s": s, "aria-selected": "false" }, el("span", { class: "dot", style: "background:var(--" + s + ")" }), NAME(s));
      b.addEventListener("click", () => pick(s));
      tabs.appendChild(b);
    });
    // start when the section scrolls near the viewport, so the report itself loads fast
    const start = () => { if (!cur) pick("nfl"); };
    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); start(); } }, { rootMargin: "300px" });
      io.observe(sec);
    } else start();
    setTimeout(start, 5000); // fallback: load anyway once the report itself has rendered
  }

  function modelTiles(c) {
    const bt = c.bt || {};
    const sports = S.SPORT_ORDER.filter((s) => bt[s]);
    if (!sports.length) return [["pending", "model backtest", "run scripts/train_model.py"]];
    const cmp = sports.map((s) => ({ s, m: marketCmp(bt[s]) })).filter((x) => x.m && x.m.model != null && x.m.market != null);
    const beat = cmp.filter((x) => x.m.model < x.m.market).length;
    // spreads at the standard -110 price only (NFL, NBA holdouts)
    const lines = sports.filter((s) => s === "nfl" || s === "nba")
      .map((s) => ({ s, l: withHit(bt[s].holdout && bt[s].holdout.line && bt[s].holdout.line.model_side_vs_line) })).filter((x) => x.l && x.l.bets);
    const best = lines.sort((a, b) => b.l.hit - a.l.hit)[0];
    const out = [[`${beat} of ${cmp.length}`, "sports where the model out-forecast the betting odds", "held-out games, log loss on the same games"]];
    if (best) out.push([pct(best.l.hit), "model's best record against the spread", `${NAME(best.s)} holdout, ${best.l.wins}-${best.l.losses}-${best.l.pushes}; break-even at −110 is 52.4%`]);
    return out;
  }

  function modelMethod(c, holder) {
    const bt = c.bt || {}, models = c.models || {};
    const sports = S.SPORT_ORDER.filter((s) => bt[s] || models[s]);
    holder.textContent = "";
    if (!sports.length) { holder.appendChild(P`Model formulas will appear here once scripts/train_model.py has run.`); return; }
    holder.appendChild(el("h3", null, "The prediction models"));
    holder.appendChild(P`Models are trained offline in Python (scikit-learn) by scripts/train_model.py and exported to model_<sport>.json. The browser runs the same equations in js/predict.js, so live predictions need no server. Elo ratings start at 1500 in the first season and are updated after every game:`);
    holder.appendChild(el("div", { class: "formula" },
      "expected home result  E = 1 / (1 + 10^(-(Elo_home + HFA - Elo_away) / 400))\n" +
      "new Elo_home = Elo_home + K × MOV multiplier × (actual − E)   (actual = 1 win, 0.5 tie or draw, 0 loss)\n" +
      "start of each season: Elo = 1500 + (1 − r) × (Elo − 1500)"));
    const ul = el("ul");
    sports.forEach((s) => {
      const m = models[s] || {}, b = bt[s] || {}, e = m.elo || b.elo || {};
      const feats = m.features || (m.model && m.model.features);
      const txt = `K = ${e.K != null ? e.K : "n/a"}, home advantage HFA = ${e.HFA != null ? e.HFA : "n/a"} Elo points, season regression r = ${e.season_regression != null ? e.season_regression : "n/a"}` +
        `${e.tuned_on ? ` (chosen on ${e.tuned_on})` : ""}${e.mov_multiplier ? `; MOV multiplier = ${e.mov_multiplier}` : ""}. ` +
        `Trained on ${b.train_seasons || (m.spans && m.spans.train) || "n/a"}, holdout ${holdoutLabel(b) || (m.spans && m.spans.holdout) || "n/a"}. ` +
        `${feats ? "Features: " + feats.join(", ") + ". " : ""}${m.edge_rationale || ""}`;
      ul.appendChild(el("li", null, el("strong", null, NAME(s) + ": "), txt));
      const co = m.coefficients || {};
      const fmtCo = (c) => Object.entries(c).map(([k, v]) => `${v >= 0 ? "+" : "−"} ${Math.abs(v).toFixed(3)}·${k}`).join(" ");
      const parts = [];
      if (co.win && co.win.coef && !Array.isArray(co.win.coef)) parts.push(`home win probability = 1 / (1 + e^−z), z = ${Number(co.win.intercept).toFixed(3)} ${fmtCo(co.win.coef)}`);
      if (co.margin && co.margin.coef) parts.push(`predicted home margin = ${Number(co.margin.intercept).toFixed(3)} ${fmtCo(co.margin.coef)}`);
      if (co.total && co.total.coef) parts.push(`predicted total = ${Number(co.total.intercept).toFixed(3)} ${fmtCo(co.total.coef)}`);
      if (parts.length) ul.appendChild(el("li", null, el("strong", null, NAME(s) + " equations (features standardized with the training mean and standard deviation stored in model_" + s + ".json): "), el("div", { class: "formula" }, parts.join("\n"))));
      if (m.player_formula) ul.appendChild(el("li", null, el("strong", null, NAME(s) + " player projections: "), m.player_formula));
    });
    holder.appendChild(ul);
    const uniq = [...new Set(sports.flatMap((s) => (bt[s] && bt[s].notes) || []))];
    if (uniq.length) {
      holder.appendChild(el("h4", null, "Backtest rules"));
      const ul2 = el("ul");
      uniq.forEach((n) => ul2.appendChild(el("li", null, n)));
      holder.appendChild(ul2);
    }
  }

  // ---------- tiles, lede, methodology ----------
  function tiles(h, extra) {
    const t = document.getElementById("tiles");
    const items = [
      [F.int(h.rows), "team-game rows", `${F.int(h.games)} games, each seen from both teams' side`],
      [`${h.first_season}–${h.last_date.slice(0, 4)}`, "seasons covered", `through ${h.last_date_text}`],
      [String(h.sports), "sports", h.sport_list.join(" · ")],
      [F.int(h.games_with_market), "games with a betting market", "a spread, total, moneyline or 1X2 price"],
    ].concat(extra || []);
    items.forEach(([v, l, s]) => t.appendChild(el("div", { class: "tile" }, el("div", { class: "value" }, v), el("div", { class: "label" }, l), el("div", { class: "sub" }, s))));
  }

  function coverageTable(cov, head) {
    const rows = Object.keys(cov).map((s) => {
      const c = cov[s];
      const spans = Object.entries(c.spans || {}).map(([k, v]) => k.replace(/_/g, " ") + ": " + String(v).replace(/ to /g, "–")).join(" · ");
      return [NAME(s), F.int(c.rows), F.int(c.games), `${c.first_season}–${c.last_season}`, String(c.seasons), String(c.teams), spans];
    });
    S.renderTable(document.getElementById("coverage-table"), ["Sport", "Team-game rows", "Games", "Seasons", "Count", "Teams", "Honest span of each field"], rows);
    const holder = document.getElementById("dropped");
    const ul = el("ul");
    Object.keys(cov).forEach((s) => {
      (cov[s].notes || []).filter((n) => /drop|exclud|remov|left without|not yet played|unplayed/i.test(n)).forEach((n) => ul.appendChild(el("li", null, el("strong", null, NAME(s) + ": "), n)));
    });
    holder.appendChild(ul);
    const all = el("details", { class: "data-table" }, el("summary", null, "All data-cleaning notes, by sport"));
    Object.keys(cov).forEach((s) => {
      all.appendChild(el("h4", null, NAME(s)));
      const l = el("ul");
      (cov[s].notes || []).forEach((n) => l.appendChild(el("li", null, n)));
      all.appendChild(l);
    });
    holder.appendChild(all);
  }

  function buildToc() {
    const t = document.getElementById("toc");
    toc.forEach((x, i) => t.appendChild(el("a", { href: "#" + x.id }, `${i + 1}. ${x.label}`)));
    t.appendChild(el("a", { href: "#methodology" }, "Methodology"));
  }

  async function main() {
    const [head, fav, home, scoring, totals, rest, draws, stars, market, bt, models, cov] = await Promise.all(
      ["headline", "favorites", "home_edge", "scoring", "totals", "rest", "epl_draws", "stars", "market", "backtests", "models", "coverage"].map(j));
    if (!head) {
      document.getElementById("lede").textContent = "The summary files in data/report/ could not be loaded. Run scripts/build_report_data.py, and open the site through a web server (not file://).";
      return;
    }
    const ctx = { head, fav, home, scoring, totals, rest, draws, stars, market, bt, models, cov };
    window.__report = ctx;
    const extraTiles = modelTiles(ctx);
    tiles(head, extraTiles);
    document.getElementById("lede").textContent = lede(ctx);

    if (fav) fFavorites(fav);
    if (home) fHome(home);
    if (scoring) fScoring(scoring);
    if (totals) fTotals(totals);
    if (rest) fRest(rest);
    if (draws) fDraws(draws);
    if (stars) fStars(stars);
    fModelVsMarket(bt || {});
    fBacktest(bt || {});
    fLive();
    if (cov) coverageTable(cov, head);
    modelMethod(ctx, document.getElementById("model-method"));
    buildToc();
    renderAllCharts();
    document.addEventListener("themechange", renderAllCharts);
  }

  function lede(c) {
    const h = c.head;
    const bits = [`This report follows ${F.int(h.games)} games (${F.int(h.rows)} team-game rows) across the ${listJoin(h.sport_list)}, from the ${h.first_season} season through ${h.last_date_text}, and compares what happened with what the betting market expected.`];
    if (c.fav) {
      const nba = c.fav.rows.find((r) => r.sport === "nba"), nfl = c.fav.rows.find((r) => r.sport === "nfl");
      if (nba && nfl) bits.push(`Favorites win most games (${pct(nfl.fav_win)} in the NFL, ${pct(nba.fav_win)} in the NBA) yet cover the spread about half the time (${pct(nfl.fav_cover)} and ${pct(nba.fav_cover)}).`);
    }
    if (c.home) {
      const nba = c.home.overall.find((x) => x.sport === "nba");
      const lows = c.home.overall.filter((x) => x.covid_label && x.min_season === x.covid_label);
      if (nba) bits.push(`Home advantage has faded, from ${pct(nba.early)} to ${pct(nba.late)} in the NBA${lows.length ? `, and it hit its lowest point in the mostly fan-free 2020 seasons (${listJoin(lows.map((x) => NAME(x.sport) + " " + pct(x.covid)))})` : ""}.`);
    }
    const bt = c.bt || {};
    const cmp = S.SPORT_ORDER.filter((s) => bt[s]).map((s) => ({ s, m: marketCmp(bt[s]) })).filter((x) => x.m && x.m.model != null && x.m.market != null);
    if (cmp.length) {
      const beat = cmp.filter((x) => x.m.model < x.m.market);
      bits.push(beat.length
        ? `A simple Elo-based model out-forecast the betting odds in ${beat.length} of ${cmp.length} sports on held-out seasons.`
        : `A simple Elo-based model does not beat the betting odds in any of the ${cmp.length} sports tested on held-out seasons: the market is the better forecaster.`);
    }
    return bits.join(" ");
  }

  window.Report = { el, P, B, chartCard, section, charts, renderAllCharts, refPlugin };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", main); else main();
})();
