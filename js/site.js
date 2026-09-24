/* Shared by both pages: theme toggle, sport metadata, number formatting,
   CSV/JSON loading and Chart.js defaults read from the CSS color tokens. */
(function () {
  "use strict";

  // ---- theme toggle (OS default; explicit choice remembered per viewer) ----
  const root = document.documentElement;
  try {
    const saved = localStorage.getItem("theme");
    if (saved === "light" || saved === "dark") root.setAttribute("data-theme", saved);
  } catch (e) { /* storage blocked: follow OS */ }

  function currentTheme() {
    const t = root.getAttribute("data-theme");
    if (t) return t;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  document.addEventListener("DOMContentLoaded", function () {
    const btn = document.querySelector(".theme-btn");
    if (!btn) return;
    const label = () => { btn.textContent = currentTheme() === "dark" ? "Light mode" : "Dark mode"; };
    label();
    btn.addEventListener("click", function () {
      const next = currentTheme() === "dark" ? "light" : "dark";
      root.setAttribute("data-theme", next);
      try { localStorage.setItem("theme", next); } catch (e) { /* ignore */ }
      label();
      document.dispatchEvent(new CustomEvent("themechange"));
    });
  });

  // ---- sport metadata ----
  const SPORTS = {
    nfl: { name: "NFL", unit: "points", lineName: "Spread", scoreWord: "points" },
    nba: { name: "NBA", unit: "points", lineName: "Spread", scoreWord: "points" },
    mlb: { name: "MLB", unit: "runs", lineName: "Run line", scoreWord: "runs" },
    nhl: { name: "NHL", unit: "goals", lineName: "Puck line", scoreWord: "goals" },
    epl: { name: "EPL", unit: "goals", lineName: "Asian handicap", scoreWord: "goals" },
  };
  const SPORT_ORDER = ["nfl", "nba", "mlb", "nhl", "epl"];

  function css(name) {
    return getComputedStyle(root).getPropertyValue(name).trim();
  }
  function sportColor(s) { return css("--" + s); }

  // ---- formatting ----
  const nf0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
  const fmt = {
    int: (v) => (v == null || Number.isNaN(v) ? "n/a" : nf0.format(v)),
    num: (v, d = 1) => (v == null || Number.isNaN(v) ? "n/a" : Number(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })),
    pct: (v, d = 1) => (v == null || Number.isNaN(v) ? "n/a" : (v * 100).toFixed(d) + "%"),
    signed: (v, d = 1) => (v == null || Number.isNaN(v) ? "n/a" : (v > 0 ? "+" : "") + Number(v).toFixed(d)),
    american: (v) => (v == null || !Number.isFinite(v) ? "n/a" : (v > 0 ? "+" : "") + Math.round(v)),
  };

  // ---- loading ----
  async function loadJSON(url) {
    const r = await fetch(url, { cache: "no-cache" });
    if (!r.ok) throw new Error(url + " -> HTTP " + r.status);
    return r.json();
  }
  // Parses a CSV with PapaParse (CDN). Numeric columns are auto-typed; blanks -> null.
  function loadCSV(url) {
    return new Promise(function (resolve, reject) {
      if (!window.Papa) return reject(new Error("CSV parser failed to load (CDN blocked?)"));
      window.Papa.parse(url, {
        download: true, header: true, dynamicTyping: true, skipEmptyLines: true, worker: false,
        complete: (res) => resolve(res.data),
        error: (err) => reject(err),
      });
    });
  }

  // ---- Chart.js defaults from tokens ----
  function applyChartDefaults() {
    if (!window.Chart) return false;
    const C = window.Chart;
    C.defaults.font.family = css("--font") || "system-ui";
    C.defaults.font.size = 12;
    C.defaults.color = css("--muted");
    C.defaults.borderColor = css("--grid");
    C.defaults.maintainAspectRatio = false;
    C.defaults.animation.duration = 250;
    C.defaults.elements.line.borderWidth = 2;
    C.defaults.elements.line.tension = 0.2;
    C.defaults.elements.point.radius = 0;
    C.defaults.elements.point.hoverRadius = 5;
    C.defaults.elements.point.hitRadius = 12;
    C.defaults.elements.bar.borderRadius = 4;
    C.defaults.elements.bar.borderSkipped = "start";
    C.defaults.plugins.legend.labels.boxWidth = 12;
    C.defaults.plugins.legend.labels.boxHeight = 12;
    C.defaults.plugins.legend.labels.color = css("--ink-2");
    C.defaults.plugins.legend.labels.usePointStyle = false;
    C.defaults.plugins.tooltip.backgroundColor = css("--surface");
    C.defaults.plugins.tooltip.titleColor = css("--ink-2");
    C.defaults.plugins.tooltip.bodyColor = css("--ink");
    C.defaults.plugins.tooltip.borderColor = css("--axis");
    C.defaults.plugins.tooltip.borderWidth = 1;
    C.defaults.plugins.tooltip.padding = 10;
    C.defaults.plugins.tooltip.bodyFont = { weight: "600" };
    C.defaults.interaction = { mode: "index", intersect: false };
    C.defaults.scale.grid.color = css("--grid");
    C.defaults.scale.border = { color: css("--axis") };
    return true;
  }

  // Build an HTML table from rows (array of arrays) using textContent only.
  function renderTable(container, headers, rows) {
    container.textContent = "";
    const wrap = document.createElement("div");
    wrap.className = "table-wrap";
    const t = document.createElement("table");
    const thead = t.createTHead().insertRow();
    headers.forEach((h) => { const th = document.createElement("th"); th.textContent = h; thead.appendChild(th); });
    const tb = t.createTBody();
    rows.forEach((r) => {
      const tr = tb.insertRow();
      r.forEach((c) => { tr.insertCell().textContent = c == null ? "n/a" : c; });
    });
    wrap.appendChild(t);
    container.appendChild(wrap);
  }

  window.Site = { SPORTS, SPORT_ORDER, css, sportColor, fmt, loadJSON, loadCSV, applyChartDefaults, renderTable, currentTheme };
})();

/* Shared player pop-up (a native <dialog>): Site.showPlayer({ title, subtitle, headers, rows, notes }).
   Text is inserted with textContent only. Esc, the close button, or a click outside closes it. */
(function () {
  "use strict";
  let dlg = null;
  function ensure() {
    if (dlg) return dlg;
    dlg = document.createElement("dialog");
    dlg.className = "player-dialog";
    dlg.setAttribute("aria-labelledby", "pd-title");
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
    document.body.appendChild(dlg);
    return dlg;
  }
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  window.Site.showPlayer = function (o) {
    const d = ensure();
    d.textContent = "";
    const box = el("div", "pd-box");
    const head = el("div", "pd-head");
    const titles = el("div");
    const h = el("h2", null, o.title || "Player");
    h.id = "pd-title";
    titles.appendChild(h);
    if (o.subtitle) titles.appendChild(el("p", "muted small", o.subtitle));
    head.appendChild(titles);
    const x = el("button", "btn ghost pd-close", "Close");
    x.type = "button";
    x.addEventListener("click", () => d.close());
    head.appendChild(x);
    box.appendChild(head);
    const tw = el("div", "table-wrap");
    const t = el("table");
    const hr = t.createTHead().insertRow();
    (o.headers || []).forEach((c) => hr.appendChild(el("th", null, c)));
    const tb = t.createTBody();
    (o.rows || []).forEach((r) => { const tr = tb.insertRow(); r.forEach((c) => { tr.insertCell().textContent = c == null ? "n/a" : c; }); });
    tw.appendChild(t);
    box.appendChild(tw);
    (o.notes || []).forEach((n) => box.appendChild(el("p", "muted small", n)));
    d.appendChild(box);
    if (typeof d.showModal === "function") d.showModal(); else d.setAttribute("open", "");
    x.focus();
  };
})();

/* Large game pop-up: Site.showGame({ title, subtitle, node }). A separate <dialog> from the
   player pop-up, so a player can be opened on top of an open game. */
(function () {
  "use strict";
  let dlg = null;
  let cleanups = [];
  // cleanup callbacks (e.g. dispose a 3D replay) run when the game pop-up closes or is refilled
  function runCleanups() { const c = cleanups; cleanups = []; c.forEach((f) => { try { f(); } catch (e) { /* ignore */ } }); }
  function closeGame() { runCleanups(); if (dlg && dlg.open) dlg.close(); }
  window.Site.onGameClose = function (fn) { cleanups.push(fn); };
  window.Site.showGame = function (o) {
    if (!dlg) {
      dlg = document.createElement("dialog");
      dlg.className = "player-dialog game-dialog";
      dlg.setAttribute("aria-labelledby", "gd-title");
      dlg.addEventListener("click", (e) => { if (e.target === dlg) closeGame(); });
      dlg.addEventListener("cancel", runCleanups); // Esc key
      dlg.addEventListener("close", runCleanups);
      document.body.appendChild(dlg);
    }
    runCleanups();
    dlg.textContent = "";
    const box = document.createElement("div");
    box.className = "pd-box";
    const head = document.createElement("div");
    head.className = "pd-head";
    const titles = document.createElement("div");
    const h = document.createElement("h2");
    h.id = "gd-title";
    h.textContent = o.title || "Game";
    titles.appendChild(h);
    if (o.subtitle) { const s = document.createElement("p"); s.className = "muted small"; s.textContent = o.subtitle; titles.appendChild(s); }
    head.appendChild(titles);
    const x = document.createElement("button");
    x.type = "button";
    x.className = "btn ghost pd-close";
    x.textContent = "Close";
    x.addEventListener("click", closeGame);
    head.appendChild(x);
    box.appendChild(head);
    if (o.node) box.appendChild(o.node);
    dlg.appendChild(box);
    if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", "");
    x.focus();
  };
})();
