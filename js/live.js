/* Live games panel: live scores + live odds (read-only, HTTP GET only) + model predictions.

   Scores:  ESPN public scoreboard JSON (no key).
   Odds:    The Odds API v4 when window.SITE_CONFIG.ODDS_API_KEY is set (60-second in-memory
            cache shared by all sports); otherwise, or on any error / quota hit, the odds ESPN
            carries in the same scoreboard response, labelled "odds via ESPN".
   Model:   window.Predict (js/predict.js). If it is missing the panel still shows scores + odds.

   Nothing here places bets or links to a sportsbook. */
(function () {
  "use strict";

  const ESPN = "https://site.api.espn.com/apis/site/v2/sports/";
  const LEAGUE = { nfl: "football/nfl", nba: "basketball/nba", mlb: "baseball/mlb", nhl: "hockey/nhl", epl: "soccer/eng.1" };
  const ODDS_SPORT = { nfl: "americanfootball_nfl", nba: "basketball_nba", mlb: "baseball_mlb", nhl: "icehockey_nhl", epl: "soccer_epl" };
  const REFRESH_MS = 60 * 1000;
  const ODDS_TTL_MS = 60 * 1000;
  const SHOW_FIRST = 6;

  // ESPN abbreviation -> panel franchise code (only where they differ; checked against data/<sport>.csv).
  const ESPN_CODE = {
    nfl: { LAR: "LA", WSH: "WAS" },
    nba: { GS: "GSW", NY: "NYK", SA: "SAS", NO: "NOP", UTAH: "UTA", WSH: "WAS", PHO: "PHX" },
    mlb: { AZ: "ARI", OAK: "ATH", CWS: "CHW", WAS: "WSH" },
    nhl: { LA: "LAK", NJ: "NJD", SJ: "SJS", TB: "TBL", UTAH: "UTA", LV: "VGK" },
    epl: {},
  };
  // ESPN / The Odds API club names -> football-data.co.uk names used in data/epl.csv.
  const EPL_NAME = {
    "afc bournemouth": "Bournemouth", "bournemouth": "Bournemouth",
    "manchester city": "Man City", "man city": "Man City",
    "manchester united": "Man United", "man united": "Man United",
    "tottenham hotspur": "Tottenham", "tottenham": "Tottenham", "spurs": "Tottenham",
    "brighton & hove albion": "Brighton", "brighton and hove albion": "Brighton", "brighton": "Brighton",
    "wolverhampton wanderers": "Wolves", "wolves": "Wolves",
    "nottingham forest": "Nott'm Forest", "nott'm forest": "Nott'm Forest",
    "newcastle united": "Newcastle", "newcastle": "Newcastle",
    "west ham united": "West Ham", "west ham": "West Ham",
    "leeds united": "Leeds", "leeds": "Leeds",
    "ipswich town": "Ipswich", "ipswich": "Ipswich",
    "leicester city": "Leicester", "leicester": "Leicester",
    "luton town": "Luton", "luton": "Luton",
    "sheffield united": "Sheffield United", "sheffield utd": "Sheffield United",
    "sheffield wednesday": "Sheffield Weds",
    "west bromwich albion": "West Brom", "west brom": "West Brom",
    "norwich city": "Norwich", "norwich": "Norwich",
    "cardiff city": "Cardiff", "swansea city": "Swansea", "stoke city": "Stoke",
    "hull city": "Hull", "hull": "Hull", "huddersfield town": "Huddersfield",
    "coventry city": "Coventry", "coventry": "Coventry",
    "crystal palace": "Crystal Palace", "c palace": "Crystal Palace",
    "queens park rangers": "QPR", "birmingham city": "Birmingham", "wigan athletic": "Wigan",
    "blackburn rovers": "Blackburn", "bolton wanderers": "Bolton", "derby county": "Derby",
    "arsenal": "Arsenal", "aston villa": "Aston Villa", "brentford": "Brentford", "burnley": "Burnley",
    "chelsea": "Chelsea", "everton": "Everton", "fulham": "Fulham", "liverpool": "Liverpool",
    "southampton": "Southampton", "sunderland": "Sunderland", "watford": "Watford",
  };

  // ---------------- small helpers ----------------
  const $ = (id) => document.getElementById(id);
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function num(v) {
    if (v == null) return null;
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    const s = String(v).trim().toLowerCase();
    if (s === "even" || s === "ev") return 100;
    if (s === "pk" || s === "pick") return 0;
    const x = parseFloat(s.replace(/^[ou]/, ""));
    return Number.isFinite(x) ? x : null;
  }
  function pick(obj, names) {
    if (!obj) return null;
    for (const n of names) if (obj[n] != null && Number.isFinite(Number(obj[n]))) return Number(obj[n]);
    return null;
  }
  function median(xs) {
    const a = xs.filter((x) => x != null && Number.isFinite(x)).sort((p, q) => p - q);
    if (!a.length) return null;
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }
  function norm(s) { return String(s || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, ""); }
  function ymd(d) { return d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0"); }

  // odds math (local fallbacks; Predict.odds is used when present)
  const OM = {
    americanToProb: (ml) => (ml == null ? null : ml < 0 ? -ml / (-ml + 100) : 100 / (ml + 100)),
    probToAmerican: (p) => (p == null || p <= 0 || p >= 1 ? null : p >= 0.5 ? -100 * p / (1 - p) : 100 * (1 - p) / p),
    americanToDecimal: (ml) => (ml == null ? null : ml > 0 ? 1 + ml / 100 : 1 + 100 / -ml),
  };
  function oddsLib() {
    const P = window.Predict && window.Predict.odds;
    return {
      americanToProb: (P && P.americanToProb) || OM.americanToProb,
      probToAmerican: (P && P.probToAmerican) || OM.probToAmerican,
    };
  }

  async function getJSON(url) {
    const r = await fetch(url, { method: "GET", cache: "no-store" });
    if (!r.ok) { const e = new Error("HTTP " + r.status); e.status = r.status; throw e; }
    return r.json();
  }

  // ---------------- team codes ----------------
  function codeFor(sport, team) {
    if (!team) return null;
    if (sport === "epl") {
      for (const k of [team.displayName, team.shortDisplayName, team.name, team.location]) {
        const hit = k && EPL_NAME[String(k).toLowerCase()];
        if (hit) return hit;
      }
      return team.shortDisplayName || team.displayName || null;
    }
    const a = team.abbreviation;
    return (ESPN_CODE[sport] && ESPN_CODE[sport][a]) || a;
  }

  // ---------------- ESPN parsing ----------------
  function parseEspnOdds(sport, comp, home, away) {
    const list = Array.isArray(comp.odds) ? comp.odds.filter(Boolean) : [];
    if (!list.length) return null;
    const o = list[0];
    const src = "odds via ESPN" + (o.provider && o.provider.name ? " (" + o.provider.name + ")" : "");
    const side = (x, s) => x && x[s] && (x[s].close || x[s].open);
    let homeLine = null;
    const ps = side(o.pointSpread, "home");
    if (ps) homeLine = num(ps.line);
    if (homeLine == null && typeof o.details === "string") {
      const m = o.details.match(/^([A-Z0-9]+)\s+([+-]?\d+(\.\d+)?)$/);
      if (m && sport !== "mlb" && sport !== "nhl") {
        const x = Math.abs(parseFloat(m[2]));
        if (m[1] === home.abbr) homeLine = -x; else if (m[1] === away.abbr) homeLine = x;
      }
    }
    let total = num(o.overUnder);
    if (total == null) { const t = side(o.total, "over"); if (t) total = num(t.line); }
    let mlHome = null, mlAway = null, mlDraw = null;
    const mh = side(o.moneyline, "home"), ma = side(o.moneyline, "away"), md = side(o.moneyline, "draw");
    if (mh) mlHome = num(mh.odds);
    if (ma) mlAway = num(ma.odds);
    if (md) mlDraw = num(md.odds);
    if (mlHome == null && o.homeTeamOdds) mlHome = num(o.homeTeamOdds.moneyLine);
    if (mlAway == null && o.awayTeamOdds) mlAway = num(o.awayTeamOdds.moneyLine);
    if (mlDraw == null && o.drawOdds) mlDraw = num(o.drawOdds.moneyLine);
    if (homeLine == null && total == null && mlHome == null) return null;
    const out = { source: src, homeLine, total, mlHome, mlAway };
    if (sport === "epl") {
      out.decH = OM.americanToDecimal(mlHome); out.decA = OM.americanToDecimal(mlAway); out.decD = OM.americanToDecimal(mlDraw);
    }
    return out;
  }

  function parseEvent(sport, ev) {
    const comp = ev.competitions && ev.competitions[0];
    if (!comp) return null;
    const cs = comp.competitors || [];
    const hc = cs.find((c) => c.homeAway === "home") || cs[0];
    const ac = cs.find((c) => c.homeAway === "away") || cs[1];
    if (!hc || !ac) return null;
    const side = (c) => {
      const pr = (c.probables || [])[0];
      return {
        code: codeFor(sport, c.team),
        abbr: c.team && c.team.abbreviation,
        name: (c.team && (c.team.shortDisplayName || c.team.displayName)) || "?",
        full: (c.team && c.team.displayName) || "",
        score: c.score != null && c.score !== "" ? Number(c.score) : null,
        probable: pr && pr.athlete ? { id: pr.athlete.id, name: pr.athlete.displayName || pr.athlete.fullName } : null,
      };
    };
    const home = side(hc), away = side(ac);
    const st = (ev.status && ev.status.type) || {};
    return {
      id: ev.id, date: ev.date, state: st.state || "pre", detail: st.shortDetail || st.detail || "",
      neutral: !!comp.neutralSite, home, away,
      preseason: !!(ev.season && ev.season.type === 1),
      odds: parseEspnOdds(sport, comp, home, away),
    };
  }

  // Which ESPN URLs to show for a sport: today's board, plus the next board with upcoming games
  // if today has nothing live/upcoming. ESPN rejects date ranges, so days are probed one by one
  // (at most 7 requests, remembered for 10 minutes).
  const nextBoard = {};
  async function loadEvents(sport) {
    const base = ESPN + LEAGUE[sport] + "/scoreboard";
    const d = await getJSON(base);
    let events = (d.events || []).map((e) => parseEvent(sport, e)).filter(Boolean);
    let note = "";
    const active = events.filter((e) => e.state === "pre" || e.state === "in");
    if (!active.length) {
      const cached = nextBoard[sport];
      let url = cached && Date.now() - cached.at < 10 * 60 * 1000 ? cached.url : null;
      if (!cached || Date.now() - cached.at >= 10 * 60 * 1000) {
        const cands = [];
        if (sport === "nfl" && d.week && d.week.number) {
          const t = (d.season && d.season.type) || 2;
          cands.push(base + "?week=" + (d.week.number + 1) + "&seasontype=" + t);
        } else {
          const now = new Date();
          for (let k = 1; k <= 7; k++) { const x = new Date(now); x.setDate(now.getDate() + k); cands.push(base + "?dates=" + ymd(x)); }
        }
        url = null;
        for (const u of cands) {
          try {
            const dd = await getJSON(u);
            if ((dd.events || []).some((e) => e.status && e.status.type && e.status.type.state === "pre")) { url = u; break; }
          } catch (e) { /* try next day */ }
        }
        nextBoard[sport] = { url, at: Date.now() };
      }
      if (url) {
        const dd = await getJSON(url);
        const up = (dd.events || []).map((e) => parseEvent(sport, e)).filter(Boolean);
        note = "No games left today, so the next scheduled games are shown too.";
        events = up.concat(events);
      } else if (!events.length) {
        note = "No games scheduled today or in the next 7 days (off-season or break).";
      }
    }
    const rank = { in: 0, pre: 1, post: 2 };
    events.sort((a, b) => (rank[a.state] - rank[b.state]) || (new Date(a.date) - new Date(b.date)));
    return { events, note };
  }

  // ---------------- The Odds API (optional) ----------------
  const oddsCache = new Map(); // shared across sports: sport -> {at, data | error}
  function apiKey() { return (window.SITE_CONFIG && window.SITE_CONFIG.ODDS_API_KEY) || ""; }
  async function loadOddsApi(sport) {
    const key = apiKey();
    if (!key) return { data: null, reason: "no API key configured" };
    const hit = oddsCache.get(sport);
    if (hit && Date.now() - hit.at < ODDS_TTL_MS) return hit;
    const epl = sport === "epl";
    const url = "https://api.the-odds-api.com/v4/sports/" + ODDS_SPORT[sport] + "/odds?regions=" + (epl ? "uk,eu" : "us") +
      "&markets=h2h,spreads,totals&oddsFormat=" + (epl ? "decimal" : "american") + "&apiKey=" + encodeURIComponent(key);
    let res;
    try {
      const data = await getJSON(url);
      res = { at: Date.now(), data, reason: "" };
    } catch (e) {
      res = { at: Date.now(), data: null, reason: e.status === 401 || e.status === 429 ? "The Odds API quota or key problem (HTTP " + e.status + ")" : "The Odds API unreachable" };
    }
    oddsCache.set(sport, res);
    return res;
  }
  function consensusFromOddsApi(sport, ev, g) {
    const nameMatch = (a, b) => { const x = norm(a), y = norm(b); return x && y && (x === y || x.includes(y) || y.includes(x)); };
    const homeOk = (n) => nameMatch(n, g.home.full) || (sport === "epl" && EPL_NAME[String(n).toLowerCase()] === g.home.code);
    const awayOk = (n) => nameMatch(n, g.away.full) || (sport === "epl" && EPL_NAME[String(n).toLowerCase()] === g.away.code);
    if (!(homeOk(ev.home_team) && awayOk(ev.away_team))) return null;
    const hp = [], ap = [], dp = [], sp = [], tp = [];
    for (const b of ev.bookmakers || []) {
      for (const m of b.markets || []) {
        for (const o of m.outcomes || []) {
          if (m.key === "h2h") {
            if (o.name === ev.home_team) hp.push(o.price); else if (o.name === ev.away_team) ap.push(o.price); else if (/draw/i.test(o.name)) dp.push(o.price);
          } else if (m.key === "spreads" && o.name === ev.home_team) sp.push(o.point);
          else if (m.key === "totals" && /over/i.test(o.name)) tp.push(o.point);
        }
      }
    }
    const books = (ev.bookmakers || []).length;
    const out = { source: "odds via The Odds API (median of " + books + " books)", homeLine: median(sp), total: median(tp) };
    if (sport === "epl") { out.decH = median(hp); out.decA = median(ap); out.decD = median(dp); }
    else { out.mlHome = median(hp); out.mlAway = median(ap); }
    return out;
  }

  // ---------------- model ----------------
  const models = {};
  async function modelFor(sport) {
    if (!window.Predict || typeof window.Predict.load !== "function") return { model: null, reason: "model unavailable (predict.js not loaded)" };
    if (!models[sport]) {
      models[sport] = Promise.resolve().then(() => window.Predict.load(sport))
        .then((m) => ({ model: m, reason: m ? "" : "model unavailable" }))
        .catch((e) => { delete models[sport]; return { model: null, reason: "model unavailable (" + e.message + ")" }; });
    }
    return models[sport];
  }
  async function predictGame(sport, model, g) {
    if (!model || !window.Predict || typeof window.Predict.game !== "function") return null;
    try {
      const r = await window.Predict.game(sport, model, {
        home: g.home.code, away: g.away.code, date: g.date, neutral: g.neutral,
        homeStarter: g.home.probable ? g.home.probable.name : null, awayStarter: g.away.probable ? g.away.probable.name : null,
      });
      if (!r) return null;
      const pHome = pick(r, ["p_home", "pHome", "home_win", "homeWin", "p_home_win"]);
      const pDraw = pick(r, ["p_draw", "pDraw", "draw"]);
      let pAway = pick(r, ["p_away", "pAway", "away_win", "awayWin"]);
      if (pAway == null && pHome != null) pAway = 1 - pHome - (pDraw || 0);
      return {
        pHome, pAway, pDraw,
        margin: pick(r, ["margin", "home_margin", "pred_margin", "predMargin", "spread"]),
        total: pick(r, ["total", "pred_total", "predTotal"]),
        note: r.note || r.warning || "",
      };
    } catch (e) {
      return { error: e.message };
    }
  }
  function edgeThreshold(model) {
    const t = pick(model, ["edge_threshold", "edgeThreshold"]);
    if (t != null) return t;
    return window.Predict && Number.isFinite(window.Predict.EDGE_THRESHOLD) ? window.Predict.EDGE_THRESHOLD : null;
  }

  // implied (no-vig) probabilities from a market object
  function implied(sport, mk) {
    if (!mk) return null;
    if (sport === "epl") {
      if (!(mk.decH > 1 && mk.decA > 1 && mk.decD > 1)) return null;
      const h = 1 / mk.decH, a = 1 / mk.decA, d = 1 / mk.decD, s = h + a + d;
      return { home: h / s, away: a / s, draw: d / s, vig: s - 1 };
    }
    const L = oddsLib();
    const h = L.americanToProb(mk.mlHome), a = L.americanToProb(mk.mlAway);
    if (h == null || a == null) return null;
    return { home: h / (h + a), away: a / (h + a), vig: h + a - 1 };
  }

  // ---------------- rendering ----------------
  const F = () => window.Site.fmt;
  function lineText(v) { return v == null ? "n/a" : v === 0 ? "PK" : (v > 0 ? "+" : "") + v; }

  function statusText(g) {
    if (g.state === "pre") {
      const d = new Date(g.date);
      return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) + " · " +
        d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    }
    return g.detail || (g.state === "in" ? "Live" : "Final");
  }

  function cardFor(sport, g, ctx) {
    const f = F();
    const card = el("article", "game");
    const st = el("div", "status" + (g.state === "in" ? " live" : ""), (g.state === "in" ? "● Live · " : g.state === "post" ? "Final · " : "") + statusText(g));
    if (g.state === "post") st.textContent = g.detail || "Final";
    card.appendChild(st);

    if (g.preseason) card.appendChild(el("span", "pill", "Preseason: lineups differ; the model was built on regular-season and playoff games"));
    const teams = el("div", "teams");
    const order = [g.away, g.home];
    order.forEach((t, i) => {
      teams.appendChild(el("span", null, t.name + (i === 1 ? (g.neutral ? " (neutral)" : " (home)") : "")));
      teams.appendChild(el("span", "num", t.score == null || g.state === "pre" ? "–" : String(t.score)));
    });
    card.appendChild(teams);
    if ((sport === "mlb" || sport === "nhl") && (g.away.probable || g.home.probable)) {
      const w = sport === "mlb" ? "Probable pitchers" : "Probable goalies";
      card.appendChild(el("div", "small muted", w + ": " + (g.away.probable ? g.away.probable.name : "TBD") + " vs " + (g.home.probable ? g.home.probable.name : "TBD")));
    }

    const mk = g.market;
    const imp = implied(sport, mk);
    const pr = g.pred;
    const thr = ctx.threshold;
    const isEpl = sport === "epl";
    const cols = isEpl ? [["Home", "home"], ["Draw", "draw"], ["Away", "away"]] : [[g.away.name, "away"], [g.home.name, "home"]];

    const tbl = el("table", "compare");
    const hr = tbl.createTHead().insertRow();
    hr.appendChild(el("th", null, ""));
    cols.forEach((c) => hr.appendChild(el("th", null, isEpl ? (c[1] === "home" ? g.home.name : c[1] === "away" ? g.away.name : "Draw") : c[0])));
    const tb = tbl.createTBody();
    function row(label, vals, cls) {
      const r = tb.insertRow();
      r.insertCell().textContent = label;
      vals.forEach((v) => {
        const c = r.insertCell();
        if (v && typeof v === "object") { c.textContent = v.text; if (v.cls) c.className = v.cls; if (v.title) c.title = v.title; }
        else c.textContent = v == null ? "n/a" : v;
        if (cls) c.classList.add(cls);
      });
    }
    const pOf = (o, k) => (o ? o["p" + k[0].toUpperCase() + k.slice(1)] : null);

    // model probabilities with edge flags
    row("Model win %", cols.map((c) => {
      const p = pr && !pr.error ? pOf(pr, c[1]) : null;
      if (p == null) return pr && pr.error ? "error" : "n/a";
      const ip = imp ? imp[c[1]] : null;
      const diff = ip != null ? p - ip : null;
      if (thr != null && diff != null && diff > thr) return { text: f.pct(p) + " edge", cls: "edge", title: "Model is " + (diff * 100).toFixed(1) + " points above the market's no-vig probability" };
      return f.pct(p);
    }));
    row("Market no-vig %", cols.map((c) => (imp && imp[c[1]] != null ? f.pct(imp[c[1]]) : "n/a")));
    if (isEpl) {
      row("Market odds", cols.map((c) => { const v = mk && mk["dec" + c[1][0].toUpperCase()]; return v ? v.toFixed(2) : "n/a"; }));
      row("Model fair odds", cols.map((c) => { const p = pr ? pOf(pr, c[1]) : null; return p ? (1 / p).toFixed(2) : "n/a"; }));
    } else {
      const L = oddsLib();
      row("Market moneyline", cols.map((c) => f.american(mk ? (c[1] === "home" ? mk.mlHome : mk.mlAway) : null)));
      row("Model fair ML", cols.map((c) => { const p = pr ? pOf(pr, c[1]) : null; return f.american(p != null ? L.probToAmerican(p) : null); }));
    }
    // line: model predicted margin (home) expressed as a handicap, vs market line
    const lineName = window.Site.SPORTS[sport].lineName;
    const mLine = pr && pr.margin != null ? -pr.margin : null;
    if (!isEpl) {
      row("Market " + lineName.toLowerCase(), cols.map((c) => (mk && mk.homeLine != null ? lineText(c[1] === "home" ? mk.homeLine : -mk.homeLine) : "n/a")));
      row("Model " + lineName.toLowerCase(), cols.map((c) => (mLine != null ? lineText(+(c[1] === "home" ? mLine : -mLine).toFixed(1)) : "n/a")));
    } else {
      row("Model goal diff", cols.map((c) => (c[1] === "draw" ? "" : pr && pr.margin != null ? f.signed(c[1] === "home" ? pr.margin : -pr.margin) : "n/a")));
    }
    const totRow = tb.insertRow();
    totRow.insertCell().textContent = "Total (market / model)";
    const tc = totRow.insertCell();
    tc.colSpan = cols.length;
    tc.textContent = (mk && mk.total != null ? mk.total : "n/a") + " / " + (pr && pr.total != null ? pr.total.toFixed(1) : "n/a");
    card.appendChild(tbl);

    const src = el("div", "src");
    const bits = [];
    bits.push(mk ? mk.source : g.state === "post" ? "n/a: odds are no longer listed for finished games" : "n/a: no line posted yet");
    if (pr && !pr.error && g.state !== "pre") bits.push(g.state === "post"
      ? "model numbers use current ratings, which may already include this result"
      : "model numbers are the pre-game view from current ratings");
    if (!pr) bits.push(ctx.modelReason || "model unavailable");
    else if (pr.error) bits.push("model error: " + pr.error);
    if (pr && pr.note) bits.push(pr.note);
    src.textContent = bits.join(" · ");
    card.appendChild(src);

    // players (lazy)
    const det = el("details", "small");
    det.style.marginTop = "8px";
    det.appendChild(el("summary", null, g.state === "pre" ? "Player projections" : "Player projections vs actual"));
    const body = el("div");
    det.appendChild(body);
    det.addEventListener("toggle", function () {
      if (det.open && !det.dataset.loaded) { det.dataset.loaded = "1"; renderPlayers(sport, g, ctx, body); }
    });
    card.appendChild(det);
    return card;
  }

  // ---- players: Predict.players projections vs ESPN summary box score ----
  const STAT_ALIAS = {
    pts: ["points"], points: ["points", "totalGoals"], reb: ["rebounds"], rebounds: ["rebounds"], ast: ["assists"], assists: ["assists", "goalAssists"],
    pass_yds: ["passingYards"], pass_td: ["passingTouchdowns"], int: ["interceptions"], interceptions: ["interceptions"],
    rush_yds: ["rushingYards"], rush_td: ["rushingTouchdowns"], rec: ["receptions"], receptions: ["receptions"],
    rec_yds: ["receivingYards"], rec_td: ["receivingTouchdowns"],
    h: ["hits"], hits: ["hits"], hr: ["homeRuns"], rbi: ["RBIs"], sb: ["stolenBases"],
    k: ["p_strikeouts"], k_p: ["p_strikeouts"], so_p: ["p_strikeouts"], er: ["p_earnedRuns"], ip: ["p_fullInnings.partInnings"],
    goals: ["goals", "totalGoals"], g: ["goals", "totalGoals"], a: ["assists", "goalAssists"],
    save_pct: ["savePercentage"], sv_pct: ["savePercentage"], saves: ["saves"],
  };
  function actualsFromSummary(s) {
    const byName = {};
    const put = (name, key, val) => { if (!name) return; (byName[name] = byName[name] || {})[key] = val; };
    for (const team of (s.boxscore && s.boxscore.players) || []) {
      for (const grp of team.statistics || []) {
        const keys = grp.keys || [];
        const pitching = keys.includes("earnedRuns");
        for (const a of grp.athletes || []) {
          const nm = a.athlete && a.athlete.displayName;
          (a.stats || []).forEach((v, i) => put(nm, (pitching ? "p_" : "") + keys[i], v));
        }
      }
    }
    for (const r of s.rosters || []) {
      for (const p of r.roster || []) {
        const nm = p.athlete && p.athlete.displayName;
        for (const st of p.stats || []) put(nm, st.name || st.abbreviation, st.displayValue != null ? st.displayValue : st.value);
      }
    }
    return byName;
  }
  function projFields(p) {
    const src = p.stats || p.proj || p.projection || p.projections || p;
    const out = [];
    for (const [k, v] of Object.entries(src)) {
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      if (/(^|_)(id|games|n|season|weight|w|usage_adj|usage_recent)$/i.test(k)) continue;
      out.push([k, v]);
    }
    return out.slice(0, 6);
  }
  function actualFor(act, k) {
    if (!act) return null;
    for (const alias of STAT_ALIAS[k] || [k]) if (act[alias] != null && act[alias] !== "") return act[alias];
    if ((k === "points" || k === "pts") && act.goals != null && act.assists != null) return Number(act.goals) + Number(act.assists);
    return null;
  }
  async function renderPlayers(sport, g, ctx, body) {
    body.textContent = "Loading…";
    let actual = null;
    if (g.state !== "pre") {
      try { actual = actualsFromSummary(await getJSON(ESPN + LEAGUE[sport] + "/summary?event=" + g.id)); }
      catch (e) { actual = null; }
    }
    body.textContent = "";
    if (!ctx.model || !window.Predict || typeof window.Predict.players !== "function") {
      body.appendChild(el("p", "muted", "Player projections unavailable: " + (ctx.modelReason || "model not loaded") + "."));
      return;
    }
    const byFold = {};
    if (actual) for (const nm of Object.keys(actual)) byFold[norm(nm)] = actual[nm];
    let basis = "";
    for (const side of [g.away, g.home]) {
      let list = [];
      try {
        const r = await window.Predict.players(sport, ctx.model, side.code, { opponent: side === g.home ? g.away.code : g.home.code, date: g.date });
        list = Array.isArray(r) ? r : (r && (r.players || r.list)) || [];
      } catch (e) { list = []; }
      const h = el("div", null, side.name);
      h.style.fontWeight = "700";
      h.style.marginTop = "6px";
      body.appendChild(h);
      if (!list.length) { body.appendChild(el("p", "muted", "n/a: the model has no player projections for this team.")); continue; }
      if (!basis && list[0].basis) basis = list[0].basis;
      const t = el("table", "compare");
      const head = t.createTHead().insertRow();
      ["Player", "Pos", g.state === "pre" ? "Projection per game" : "Projection / actual"].forEach((x) => head.appendChild(el("th", null, x)));
      const tb = t.createTBody();
      list.slice(0, 5).forEach((p) => {
        const r = tb.insertRow();
        const nm = p.player || p.name || "?";
        r.insertCell().textContent = nm;
        r.insertCell().textContent = p.position || p.role || "";
        const act = actual ? (actual[nm] || byFold[norm(nm)] || null) : null;
        const parts = projFields(p).map(([k, v]) => {
          const a = actualFor(act, k);
          const pv = k.includes("pct") ? v.toFixed(3) : v.toFixed(1);
          return k.replace(/_/g, " ") + " " + pv + (g.state === "pre" ? "" : " / " + (a == null ? (actual ? "–" : "n/a") : a));
        });
        const c = r.insertCell();
        c.textContent = parts.join(" · ");
        c.style.whiteSpace = "normal";
        c.style.textAlign = "left";
      });
      body.appendChild(t);
    }
    body.appendChild(el("p", "muted", (basis ? "Projection basis: " + basis + ". " : "") + (g.state === "pre"
      ? "Actual stats appear here once the game starts."
      : "Actual stats from ESPN's box score; '–' means the player has no line in the box score (did not play or stat not reported).")));
  }

  // ---------------- controller ----------------
  let current = null, timer = null, ticker = null, lastAt = 0, running = false, showAll = false;

  function tick() {
    const u = $("live-updated");
    if (!u || !lastAt) return;
    const s = Math.round((Date.now() - lastAt) / 1000);
    u.textContent = "Updated " + s + " second" + (s === 1 ? "" : "s") + " ago · refreshes every 60 s";
  }

  async function refresh() {
    const sport = current;
    if (!sport || running) return;
    running = true;
    const box = $("live-games"), note = $("live-note"), more = $("live-more");
    box.classList.add("stale");
    try {
      const [{ events, note: evNote }, mres, oapi] = await Promise.all([loadEvents(sport), modelFor(sport), loadOddsApi(sport)]);
      if (sport !== current) return;
      const ctx = { model: mres.model, modelReason: mres.reason, threshold: mres.model ? edgeThreshold(mres.model) : null };
      for (const g of events) {
        let mk = null;
        if (oapi.data) for (const ev of oapi.data) { mk = consensusFromOddsApi(sport, ev, g); if (mk) break; }
        g.market = mk || g.odds || null;
        g.pred = await predictGame(sport, ctx.model, g);
      }
      box.textContent = "";
      const shown = showAll ? events : events.slice(0, SHOW_FIRST);
      shown.forEach((g) => box.appendChild(cardFor(sport, g, ctx)));
      more.textContent = "";
      if (events.length > SHOW_FIRST) {
        const b = el("button", "btn ghost", showAll ? "Show fewer games" : "Show all " + events.length + " games");
        b.type = "button";
        b.style.marginTop = "10px";
        b.addEventListener("click", () => { showAll = !showAll; refresh(); });
        more.appendChild(b);
      }
      const parts = [];
      if (evNote) parts.push(evNote);
      if (!events.length && !evNote) parts.push("No games found.");
      const oddsWhy = oapi.data ? "Odds: The Odds API where matched, else ESPN." : "Odds via ESPN (" + oapi.reason + ").";
      parts.push(oddsWhy);
      parts.push(ctx.threshold != null
        ? "Edge flag: model win probability more than " + (ctx.threshold * 100).toFixed(1) + " percentage points above the market's no-vig probability."
        : "Edge flags off: " + (ctx.modelReason || "no model threshold available") + ".");
      note.textContent = parts.join(" ");
      lastAt = Date.now();
      tick();
    } catch (e) {
      if (sport === current) {
        note.textContent = "Live data unavailable right now (" + (navigator.onLine === false ? "you appear to be offline" : "ESPN could not be reached") + "). The historical dashboard below still works.";
        if (!lastAt) { box.textContent = ""; $("live-updated").textContent = "Not updated"; }
      }
    } finally {
      box.classList.remove("stale");
      running = false;
    }
  }

  function show(sport) {
    if (!LEAGUE[sport]) return;
    current = sport;
    showAll = false;
    lastAt = 0;
    $("live-games").textContent = "";
    $("live-more").textContent = "";
    $("live-updated").textContent = "Loading live games…";
    $("live-note").textContent = "";
    clearInterval(timer); clearInterval(ticker);
    refresh();
    timer = setInterval(() => { if (!document.hidden) refresh(); }, REFRESH_MS);
    ticker = setInterval(tick, 1000);
  }

  window.Live = { show, refresh, codeFor, ESPN_CODE, EPL_NAME, _parseEvent: parseEvent, _implied: implied };
})();
