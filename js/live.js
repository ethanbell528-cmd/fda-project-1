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
        espnId: c.team && c.team.id,
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
  let viewDate = null; // YYYYMMDD when the viewer picks another day; null = today (live)
  async function loadEvents(sport) {
    const base = ESPN + LEAGUE[sport] + "/scoreboard";
    if (viewDate) {
      const dd = await getJSON(base + "?dates=" + viewDate);
      const evs = (dd.events || []).map((e) => parseEvent(sport, e)).filter(Boolean);
      evs.sort((a, b) => new Date(a.date) - new Date(b.date));
      return { events: evs, note: evs.length ? "" : "No " + window.Site.SPORTS[sport].name + " games on this date." };
    }
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

  function detailFor(sport, g, ctx) {
    const f = F();
    const card = el("div", "game game-detail");
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

    // 3D replay from ESPN play-by-play (loads on request; disposed when the pop-up closes)
    const rh = el("h3", null, "3D replay");
    rh.style.margin = "14px 0 4px";
    rh.style.fontSize = "1rem";
    card.appendChild(rh);
    const rbox = el("div", "replay-host");
    card.appendChild(rbox);
    if (g.state === "pre") {
      rbox.appendChild(el("p", "muted small", "The 3D replay appears here once the game starts, built from ESPN's play-by-play locations."));
    } else {
      const rb = el("button", "btn", g.state === "in" ? "Load live 3D replay" : "Load 3D replay");
      rb.type = "button";
      rb.addEventListener("click", async () => {
        rb.disabled = true;
        if (!window.Replay3D) { rbox.textContent = "3D replay script did not load."; return; }
        let ctl = null, closed = false;
        const stop = () => { closed = true; if (ctl) ctl.close(); };
        if (window.Site.onGameClose) window.Site.onGameClose(stop);
        ctl = await window.Replay3D.open(rbox, sport, g.id, { live: g.state === "in" });
        if (closed) ctl.close();
      });
      rbox.appendChild(rb);
    }

    // players: rendered when the game pop-up opens
    const ph = el("h3", null, g.state === "pre" ? "Players: model vs market" : "Players: model vs market vs actual");
    ph.style.margin = "14px 0 4px";
    ph.style.fontSize = "1rem";
    card.appendChild(ph);
    const body = el("div", "small");
    card.appendChild(body);
    let loaded = false;
    return { node: card, loadPlayers: () => { if (!loaded) { loaded = true; renderPlayers(sport, g, ctx, body); } } };
  }

  // Compact card on the page; clicking it opens the full game in a large pop-up.
  function cardFor(sport, g, ctx) {
    const f = F();
    const card = el("article", "game game-compact");
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-haspopup", "dialog");
    card.setAttribute("aria-label", g.away.name + " at " + g.home.name + ": open the full game");
    card.appendChild(el("div", "status" + (g.state === "in" ? " live" : ""), (g.state === "in" ? "● Live · " : "") + statusText(g)));
    const teams = el("div", "teams");
    [g.away, g.home].forEach((t, i) => {
      teams.appendChild(el("span", null, t.name + (i === 1 ? (g.neutral ? " (neutral)" : " (home)") : "")));
      teams.appendChild(el("span", "num", t.score == null || g.state === "pre" ? "–" : String(t.score)));
    });
    card.appendChild(teams);
    const pr = g.pred, imp = implied(sport, g.market), thr = ctx.threshold;
    let line = "Model: n/a";
    let edge = false;
    if (pr && !pr.error && pr.pHome != null) {
      if (sport === "epl") {
        line = "Model: " + g.home.name + " " + f.pct(pr.pHome, 0) + " · draw " + f.pct(pr.pDraw, 0) + " · " + g.away.name + " " + f.pct(pr.pAway, 0);
      } else {
        const fav = pr.pHome >= pr.pAway ? ["home", g.home.name, pr.pHome] : ["away", g.away.name, pr.pAway];
        line = "Model: " + fav[1] + " " + f.pct(fav[2], 0) + (imp && imp[fav[0]] != null ? " · market " + f.pct(imp[fav[0]], 0) : "");
      }
      if (imp && thr != null) edge = ["home", "away", "draw"].some((k) => { const pk = pr["p" + k[0].toUpperCase() + k.slice(1)]; return pk != null && imp[k] != null && pk - imp[k] > thr; });
    }
    const ml = el("div", "small", line);
    ml.style.marginTop = "4px";
    card.appendChild(ml);
    // market odds on the card itself
    const mk = g.market;
    let mtxt;
    if (!mk) mtxt = "Market: no odds posted yet";
    else if (sport === "epl") mtxt = "Market: " + g.home.name + " " + (mk.decH ? mk.decH.toFixed(2) : "n/a") + " · draw " + (mk.decD ? mk.decD.toFixed(2) : "n/a") + " · " + g.away.name + " " + (mk.decA ? mk.decA.toFixed(2) : "n/a");
    else {
      const parts = [];
      if (mk.mlAway != null || mk.mlHome != null) parts.push(g.away.abbr + " " + f.american(mk.mlAway) + " / " + g.home.abbr + " " + f.american(mk.mlHome));
      if (mk.homeLine != null) parts.push(g.home.abbr + " " + lineText(mk.homeLine));
      if (mk.total != null) parts.push("O/U " + mk.total);
      mtxt = "Market: " + (parts.length ? parts.join(" · ") : "n/a");
    }
    const mkl = el("div", "small muted", mtxt + (mk && mk.live ? " (live)" : ""));
    card.appendChild(mkl);
    if (edge) card.appendChild(el("span", "edge small", "model edge"));
    card.appendChild(el("div", "open-hint", "Click for odds, model and players"));
    const open = () => {
      const d = detailFor(sport, g, ctx);
      window.Site.showGame({
        title: g.away.name + " at " + g.home.name,
        subtitle: window.Site.SPORTS[sport].name + " · " + (g.state === "in" ? "Live · " : "") + statusText(g),
        node: d.node,
      });
      d.loadPlayers();
    };
    card.addEventListener("click", open);
    card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
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
  // ---------------- player props: model vs market ----------------
  // Full-game over/under player lines from ESPN's public odds feed (sportsbook listed by ESPN,
  // e.g. DraftKings). GET only, no key. Only markets that match a stat the model projects are used;
  // "milestone", first-scorer and partial-game markets are ignored.
  const CORE = { nfl: "football/leagues/nfl", nba: "basketball/leagues/nba", mlb: "baseball/leagues/mlb", nhl: "hockey/leagues/nhl", epl: "soccer/leagues/eng.1" };
  const PROP_MARKETS = {
    nfl: [[/^total passing yards \(incl\. overtime\)$/i, "pass_yds"], [/^total passing touchdowns \(incl\. overtime\)$/i, "pass_td"],
          [/^total passing interceptions \(incl\. overtime\)$/i, "int"], [/^total rushing yards \(incl\. overtime\)$/i, "rush_yds"],
          [/^total receptions \(incl\. overtime\)$/i, "rec"], [/^total receiving yards \(incl\. overtime\)$/i, "rec_yds"]],
    nba: [[/^total points( \(incl\. overtime\))?$/i, "pts"], [/^total rebounds( \(incl\. overtime\))?$/i, "reb"], [/^total assists( \(incl\. overtime\))?$/i, "ast"]],
    mlb: [[/^total hits$/i, "h"], [/^total home runs$/i, "hr"], [/^total rbis$/i, "rbi"], [/^total stolen bases$/i, "sb"],
          [/^total strikeouts$/i, "k_p"], [/^earned runs allowed$/i, "er"], [/^total outs recorded$/i, "ip", 1 / 3]],
    nhl: [[/^total goals( \(incl\. overtime\))?$/i, "goals"], [/^total assists( \(incl\. overtime\))?$/i, "assists"], [/^total points( \(incl\. overtime\))?$/i, "points"]],
    epl: [[/^(total )?goals( scored)?$/i, "goals"], [/^(total )?assists$/i, "assists"]],
  };
  const PROPS_TTL_MS = 10 * 60 * 1000;
  const propCache = {}, rosterCache = {};

  function nameKey(s) {
    return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
      .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, "").replace(/[^a-z ]/g, " ").split(/\s+/).filter(Boolean);
  }
  async function roster(sport, espnTeamId) {
    if (!espnTeamId) return {};
    const key = sport + ":" + espnTeamId, hit = rosterCache[key];
    if (hit && Date.now() - hit.at < 6 * 3600 * 1000) return hit.map;
    const d = await getJSON(ESPN + LEAGUE[sport] + "/teams/" + espnTeamId + "/roster");
    const map = {};
    const add = (a) => { if (a && a.id) map[String(a.id)] = a.fullName || a.displayName || ""; };
    for (const a of d.athletes || []) { if (a && Array.isArray(a.items)) a.items.forEach(add); else add(a); }
    rosterCache[key] = { at: Date.now(), map };
    return map;
  }
  // Match a model player (name, team) to an ESPN athlete id on that team's roster.
  function matchAthlete(name, rosterMap) {
    const want = nameKey(name);
    if (!want.length) return null;
    const entries = Object.entries(rosterMap).map(([id, nm]) => [id, nameKey(nm)]);
    const full = want.join(" ");
    let hit = entries.find(([, k]) => k.join(" ") === full);
    if (!hit) hit = entries.find(([, k]) => k.length > 1 && k[0] === want[0] && k[k.length - 1] === want[want.length - 1]);
    if (!hit) hit = entries.find(([, k]) => k.length > 1 && k.every((t) => want.includes(t)));
    if (!hit) {
      const last = entries.filter(([, k]) => k[k.length - 1] === want[want.length - 1] && k[0] && k[0][0] === want[0][0]);
      if (last.length === 1) hit = last[0];
    }
    return hit ? hit[0] : null;
  }
  // -> { provider, byAthlete: { espnAthleteId: { stat: { line, updated } } } } or throws
  async function loadProps(sport, gameId) {
    const key = sport + ":" + gameId, hit = propCache[key];
    if (hit && Date.now() - hit.at < PROPS_TTL_MS) return hit.data;
    const base = "https://sports.core.api.espn.com/v2/sports/" + CORE[sport] + "/events/" + gameId + "/competitions/" + gameId + "/odds";
    const list = await getJSON(base);
    const prov = (list.items || []).find((i) => i && i.propBets) || null;
    const data = { provider: prov && prov.provider ? prov.provider.name : null, byAthlete: {} };
    if (prov) {
      const pid = prov.provider.id;
      let page = 1, pages = 1;
      do {
        const d = await getJSON(base + "/" + pid + "/propBets?limit=1000&page=" + page);
        pages = d.pageCount || 1;
        for (const it of d.items || []) {
          const nm = it.type && it.type.name, ref = it.athlete && it.athlete.$ref;
          const m = ref && ref.match(/athletes\/(\d+)/);
          const line = it.current && it.current.target ? Number(it.current.target.value) : NaN;
          if (!nm || !m || !Number.isFinite(line)) continue;
          const mk = (PROP_MARKETS[sport] || []).find(([re]) => re.test(nm));
          if (!mk) continue;
          const [, stat, scale] = mk;
          const price = it.odds && it.odds.american ? num(it.odds.american.value) : null;
          const slot = (data.byAthlete[m[1]] = data.byAthlete[m[1]] || {});
          // ESPN returns each over/under pair as two items, over first then under (checked against
          // 0.5 RBI / runs / walks lines, where the "1 or more" side is always the longer price).
          if (slot[stat] && slot[stat].raw === line && slot[stat].under == null) slot[stat].under = price;
          else slot[stat] = { line: line * (scale || 1), raw: line, market: nm, updated: it.lastUpdated, over: price, under: null };
        }
        page += 1;
      } while (page <= pages && page <= 5);
    }
    propCache[key] = { at: Date.now(), data };
    return data;
  }
  // Count stats with small lines (hits, HR, RBI, SB, TDs, INT, goals, assists, strikeouts, earned runs,
  // receptions): a line of 0.5 means "1 or more", so the model's average is turned into P(over) with a
  // Poisson distribution whose mean is the projection. Yardage, innings and NBA stats show the difference.
  const COUNT_STATS = new Set(["h", "hr", "rbi", "sb", "k_p", "er", "pass_td", "int", "rush_td", "rec_td", "rec", "goals", "assists", "points"]);
  function poissonOver(mean, line) {
    if (!(mean >= 0)) return null;
    const k = Math.floor(line) + 1; // over x.5 means at least floor(x.5)+1
    let term = Math.exp(-mean), cdf = 0;
    for (let i = 0; i < k; i++) { cdf += term; term *= mean / (i + 1); }
    return Math.max(0, Math.min(1, 1 - cdf));
  }
  function fmtProj(k, v) { return k.includes("pct") ? v.toFixed(3) : v.toFixed(1); }
  function fmtLine(k, v) { return k === "ip" ? v.toFixed(2).replace(/0$/, "") : String(Math.round(v * 100) / 100); }

  const STAT_LABEL = {
    pts: "Points", reb: "Rebounds", ast: "Assists",
    pass_yds: "Pass yds", pass_td: "Pass TD", int: "INT", rush_yds: "Rush yds", rush_td: "Rush TD",
    rec: "Receptions", rec_yds: "Rec yds", rec_td: "Rec TD",
    h: "Hits", hr: "HR", rbi: "RBI", sb: "SB", ip: "Innings", k_p: "Strikeouts", er: "Earned runs",
    goals: "Goals", assists: "Assists", points: "Points", save_pct: "Save %",
  };
  // Run fn once the element scrolls near the viewport (saves requests for off-screen cards).
  function whenVisible(node, fn) {
    // hidden tabs never report intersections, so load right away there
    if (!("IntersectionObserver" in window) || document.visibilityState === "hidden") { fn(); return; }
    const io = new IntersectionObserver((ents) => {
      if (ents.some((e) => e.isIntersecting)) { io.disconnect(); fn(); }
    }, { rootMargin: "200px" });
    io.observe(node);
  }

  async function renderPlayers(sport, g, ctx, body) {
    body.textContent = "Loading…";
    let actual = null;
    if (g.state !== "pre") {
      try { actual = actualsFromSummary(await getJSON(ESPN + LEAGUE[sport] + "/summary?event=" + g.id)); }
      catch (e) { actual = null; }
    }
    if (!ctx.model || !window.Predict || typeof window.Predict.players !== "function") {
      body.textContent = "";
      body.appendChild(el("p", "muted", "Player projections unavailable: " + (ctx.modelReason || "model not loaded") + "."));
      return;
    }
    const byFold = {};
    if (actual) for (const nm of Object.keys(actual)) byFold[norm(nm)] = actual[nm];
    const sides = [];
    for (const side of [g.away, g.home]) {
      let list = [];
      try {
        const r = await window.Predict.players(sport, ctx.model, side.code, { opponent: side === g.home ? g.away.code : g.home.code, date: g.date });
        list = Array.isArray(r) ? r : (r && (r.players || r.list)) || [];
      } catch (e) { list = []; }
      sides.push({ side, list: list.slice(0, 5) });
    }
    const basis = (sides.find((x) => x.list.length) || { list: [{}] }).list[0].basis || "";

    // market: null = not loaded yet, {error} = failed, else {provider, byAthlete, ids}
    let market = null;
    const linesFor = (side, p) => {
      const athleteId = market && market.ids ? market.ids[side.code + "|" + (p.player || p.name)] : null;
      return athleteId && market.byAthlete ? market.byAthlete[athleteId] || {} : {};
    };
    const openPlayer = (side, p) => {
      const nm = p.player || p.name || "?";
      const act = actual ? (actual[nm] || byFold[norm(nm)] || null) : null;
      const showAct = g.state !== "pre";
      const lines = linesFor(side, p);
      const rows = projFields(p).map(([k, v]) => {
        const ln = lines[k];
        let vs = "";
        if (ln && COUNT_STATS.has(k) && ln.line < 5 && ln.line % 1 !== 0) {
          const po = poissonOver(v, ln.line);
          vs = po == null ? "" : "P(over) " + Math.round(po * 100) + "%";
        } else if (ln) {
          const d = v - ln.line;
          vs = (d > 0 ? "+" : "") + (k.includes("pct") ? d.toFixed(3) : d.toFixed(1));
        }
        const L = oddsLib();
        const po = ln ? L.americanToProb(ln.over) : null, pu = ln ? L.americanToProb(ln.under) : null;
        const mkOver = po != null && pu != null ? po / (po + pu) : null; // no-vig market P(over)
        const row = [STAT_LABEL[k] || k.replace(/_/g, " "), fmtProj(k, v),
          ln ? fmtLine(k, ln.line) : (market && !market.error ? "–" : "…"),
          ln && ln.over != null ? window.Site.fmt.american(ln.over) + " / " + window.Site.fmt.american(ln.under) : (ln ? "n/a" : ""),
          mkOver != null ? Math.round(mkOver * 100) + "%" : (ln ? "n/a" : ""),
          vs];
        if (showAct) { const a = actualFor(act, k); row.push(a == null ? (actual ? "–" : "n/a") : a); }
        return row;
      });
      let mnote;
      if (!market) mnote = "Sportsbook lines are still loading; close and reopen in a moment.";
      else if (market.error) mnote = "Sportsbook player lines unavailable right now (" + market.error + ").";
      else if (!market.provider) mnote = "No sportsbook player lines posted for this game yet.";
      else mnote = "Line and odds = the " + market.provider + " over/under for that stat, via ESPN's public odds feed (American odds, over first). Market P(over) removes the bookmaker's margin: P(over) ÷ (P(over) + P(under)). '–' means no line is posted for this player and stat." + (sport === "mlb" ? " Innings = outs-recorded line ÷ 3." : "");
      window.Site.showPlayer({
        title: nm,
        subtitle: [p.position, side.name, g.away.name + " at " + g.home.name].filter(Boolean).join(" · "),
        headers: ["Stat", "Model", "Line", "Over / under odds", "Market P(over)", "Model vs line"].concat(showAct ? ["Actual"] : []),
        rows,
        notes: [
          mnote,
          "Model = projected per-game stat. " + (p.basis ? "Basis: " + p.basis + ". " : "") + "Projection = w × average of the last n games + (1 − w) × base-season average × usage adjustment, w = n ÷ (n + 5).",
          "Model vs line: for small count lines (such as 0.5 hits) it is the model's chance of going over, from a Poisson distribution with the projection as its mean; otherwise projection minus line. Not backtested (no free historical prop lines), so no edge flag.",
        ].concat(showAct ? ["Actual stats from ESPN's box score; '–' = no line in the box score."] : []),
      });
    };
    const draw = () => {
      body.textContent = "";
      const showAct = g.state !== "pre";
      for (const { side, list } of sides) {
        const h = el("div", null, side.name);
        h.style.fontWeight = "700";
        h.style.marginTop = "6px";
        body.appendChild(h);
        if (!list.length) { body.appendChild(el("p", "muted", "n/a: the model has no player projections for this team.")); continue; }
        const wrap = el("div", "player-list");
        for (const p of list) {
          const nm = p.player || p.name || "?";
          const b = el("button", "player-btn");
          b.type = "button";
          b.appendChild(document.createTextNode(nm));
          if (p.position) b.appendChild(el("span", "pos", p.position));
          const lines = linesFor(side, p);
          const nLines = Object.keys(lines).length;
          if (market && !market.error && market.provider) b.appendChild(el("span", "badge", nLines ? nLines + " line" + (nLines === 1 ? "" : "s") : "no lines"));
          b.setAttribute("aria-haspopup", "dialog");
          b.addEventListener("click", () => openPlayer(side, p));
          wrap.appendChild(b);
        }
        body.appendChild(wrap);
      }
      let status;
      if (!market) status = "Loading sportsbook player lines…";
      else if (market.error) status = "Sportsbook player lines unavailable (" + market.error + ").";
      else if (!market.provider) status = "No sportsbook player lines posted yet.";
      else status = market.provider + " lines found for " + market.matched + " of " + market.total + " players.";
      body.appendChild(el("p", "muted", "Click a player to see the model projection next to the market line" + (g.state !== "pre" ? " and the actual stat" : "") + ". " + status));
    };
    draw();

    (async () => { // the players only render inside the open game pop-up, so load the lines right away
      try {
        const [props, rA, rH] = await Promise.all([
          loadProps(sport, g.id),
          roster(sport, g.away.espnId).catch(() => ({})),
          roster(sport, g.home.espnId).catch(() => ({})),
        ]);
        const ids = {};
        let matched = 0, total = 0;
        for (const { side, list } of sides) {
          const rmap = side === g.home ? rH : rA;
          for (const p of list) {
            total += 1;
            let id = p.id && props.byAthlete[String(p.id)] && rmap[String(p.id)] ? String(p.id) : null; // NBA ids are ESPN ids
            if (!id) id = matchAthlete(p.player, rmap);
            if (id) { ids[side.code + "|" + p.player] = id; if (props.byAthlete[id]) matched += 1; }
          }
        }
        market = { provider: props.provider, byAthlete: props.byAthlete, ids, matched, total };
      } catch (e) {
        market = { error: e && e.status ? "HTTP " + e.status : "offline" };
      }
      draw();
    })();
  }

  // ---------------- game odds from ESPN's core odds feed ----------------
  // The public scoreboard drops odds once a game starts. The core odds feed keeps them and adds
  // an in-game book ("DraftKings - Live Odds"), so live games use that and upcoming games without
  // scoreboard odds use the pre-game book. GET only, cached 60 s per game.
  const coreOddsCache = {};
  async function coreOdds(sport, g) {
    const key = sport + ":" + g.id, hit = coreOddsCache[key];
    if (hit && Date.now() - hit.at < 60 * 1000) return hit.data;
    const url = "https://sports.core.api.espn.com/v2/sports/" + CORE[sport] + "/events/" + g.id + "/competitions/" + g.id + "/odds";
    let data = null;
    try {
      const d = await getJSON(url);
      const items = (d.items || []).filter((i) => i && i.provider);
      const live = items.find((i) => /live/i.test(i.provider.name || ""));
      const pre = items.find((i) => !/live/i.test(i.provider.name || ""));
      const o = g.state === "in" ? (live || pre) : (pre || live);
      if (o) {
        const h = o.homeTeamOdds || {}, a = o.awayTeamOdds || {};
        let homeLine = num(o.spread);
        // spread is quoted for the home side; flip if the favorite flags disagree with its sign
        if (homeLine != null && homeLine !== 0 && ((h.favorite && homeLine > 0) || (a.favorite && homeLine < 0))) homeLine = -homeLine;
        const cur = o.current || {};
        data = {
          source: (g.state === "in" && o === live ? "live odds via ESPN (" : "odds via ESPN (") + o.provider.name.replace(/\s*-\s*live odds/i, "") + ")",
          live: g.state === "in" && o === live,
          homeLine: sport === "epl" ? null : homeLine,
          total: num(o.overUnder),
          mlHome: num(h.moneyLine), mlAway: num(a.moneyLine),
          overPrice: cur.over ? num(cur.over.american) : null, underPrice: cur.under ? num(cur.under.american) : null,
        };
        if (sport === "epl") {
          const dr = o.drawOdds || {};
          data.decH = OM.americanToDecimal(data.mlHome); data.decA = OM.americanToDecimal(data.mlAway); data.decD = OM.americanToDecimal(num(dr.moneyLine));
        }
        if (data.homeLine == null && data.total == null && data.mlHome == null) data = null;
      }
    } catch (e) { data = null; }
    coreOddsCache[key] = { at: Date.now(), data };
    return data;
  }

  // ---------------- controller ----------------
  let current = null, timer = null, ticker = null, lastAt = 0, running = false, pending = false, showAll = false;

  function tick() {
    const u = $("live-updated");
    if (!u || !lastAt) return;
    const s = Math.round((Date.now() - lastAt) / 1000);
    u.textContent = viewDate ? "Loaded at " + new Date(lastAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) + " · chosen date, no auto-refresh" : "Updated " + s + " second" + (s === 1 ? "" : "s") + " ago · refreshes every 60 s";
  }

  async function refresh() {
    const sport = current;
    if (!sport) return;
    if (running) { pending = true; return; } // a sport/date switch during a load runs right after it
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
      // live games (and upcoming games the scoreboard left without odds) get ESPN's core odds feed
      await Promise.all(events.map(async (g) => {
        if (g.state === "post") return;
        const fromApi = g.market && g.market !== g.odds;
        if (fromApi || (g.state === "pre" && g.odds)) return;
        const co = await coreOdds(sport, g);
        if (co) g.market = co;
      }));
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
      if (viewDate) parts.push("Showing a chosen date: final scores are ESPN's; model numbers use today's ratings, not the ratings on that date.");
      note.textContent = parts.join(" ");
    } catch (e) {
      if (sport === current) {
        note.textContent = "Live data unavailable right now (" + (navigator.onLine === false ? "you appear to be offline" : "ESPN could not be reached") + "). The historical dashboard below still works.";
        if (!lastAt) { box.textContent = ""; $("live-updated").textContent = "Not updated"; }
      }
    } finally {
      box.classList.remove("stale");
      running = false;
      if (pending) { pending = false; refresh(); }
    }
  }

  function todayYmd() { return ymd(new Date()); }
  function setDateUI() {
    const inp = $("live-date"), ttl = $("live-title");
    if (inp && !inp.dataset.bound) {
      inp.dataset.bound = "1";
      const t = new Date(); t.setMinutes(t.getMinutes() - t.getTimezoneOffset());
      inp.value = t.toISOString().slice(0, 10);
      inp.max = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
      inp.addEventListener("change", () => {
        const v = (inp.value || "").replace(/-/g, "");
        viewDate = v && v !== todayYmd() ? v : null;
        if (current) show(current);
      });
    }
    if (ttl) {
      if (!viewDate) ttl.textContent = "Games today: model vs. market";
      else {
        const d = new Date(+viewDate.slice(0, 4), +viewDate.slice(4, 6) - 1, +viewDate.slice(6, 8));
        ttl.textContent = "Games on " + d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }) + ": model vs. market";
      }
    }
  }

  function show(sport) {
    if (!LEAGUE[sport]) return;
    setDateUI();
    current = sport;
    showAll = false;
    lastAt = 0;
    $("live-games").textContent = "";
    $("live-more").textContent = "";
    $("live-updated").textContent = "Loading live games…";
    $("live-note").textContent = "";
    clearInterval(timer); clearInterval(ticker);
    refresh();
    if (!viewDate) { // only today's board auto-refreshes
      timer = setInterval(() => { if (!document.hidden) refresh(); }, REFRESH_MS);
      ticker = setInterval(tick, 1000);
    }
  }

  window.Live = { show, refresh, codeFor, ESPN_CODE, EPL_NAME, _parseEvent: parseEvent, _implied: implied, _loadProps: loadProps, _roster: roster, _matchAthlete: matchAthlete, _coreOdds: coreOdds };
})();
