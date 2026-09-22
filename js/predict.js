/* In-browser inference for every sport. The models are trained offline by
   scripts/train_model.py and exported as model_<sport>.json; this file
   re-implements the exact feature and prediction math (checked against Python
   by scripts/check_predict_parity.js). Read-only: no network calls except
   fetching the model JSON. */
(function (root) {
  "use strict";

  const cache = {};

  // ---------------- odds math (shared by every sport) ----------------
  const odds = {
    // raw implied probability (vig included) from American odds
    americanToProb(ml) {
      ml = Number(ml);
      if (!Number.isFinite(ml) || ml === 0) return null;
      return ml < 0 ? -ml / (-ml + 100) : 100 / (ml + 100);
    },
    decimalToProb(d) {
      d = Number(d);
      return Number.isFinite(d) && d > 1 ? 1 / d : null;
    },
    // remove the bookmaker margin by normalising the sides to sum to 1
    noVig2(p1, p2) {
      if (p1 == null || p2 == null) return [null, null];
      const s = p1 + p2;
      return [p1 / s, p2 / s];
    },
    noVig3(p1, p2, p3) {
      if (p1 == null || p2 == null || p3 == null) return [null, null, null];
      const s = p1 + p2 + p3;
      return [p1 / s, p2 / s, p3 / s];
    },
    probToAmerican(p) {
      if (!(p > 0 && p < 1)) return null;
      return p >= 0.5 ? (-100 * p) / (1 - p) : (100 * (1 - p)) / p;
    },
    probToDecimal(p) {
      return p > 0 ? 1 / p : null;
    },
    // edge = model probability minus no-vig market probability; flagged only past the threshold
    edge(pModel, pImplied, threshold) {
      if (pModel == null || pImplied == null) return { edge: null, flag: false };
      const e = pModel - pImplied;
      return { edge: e, flag: e > threshold };
    },
  };

  // ---------------- helpers ----------------
  function dayNumber(date) {
    if (typeof date === "number") return date;
    if (date instanceof Date) return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date));
    if (!m) throw new Error("Predict: date must be YYYY-MM-DD, got " + date);
    return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000);
  }

  function fold(s) {
    return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  // resolve an MLB starter / NHL goalie by id first, then by (accent-insensitive) name
  function resolveKey(table, key) {
    if (key == null || !table) return null;
    const k = String(key);
    if (Object.prototype.hasOwnProperty.call(table, k)) return k;
    const f = fold(k);
    if (!f) return null;
    let hit = null;
    for (const id in table) {
      if (fold(table[id].name) === f) { hit = id; break; }
    }
    if (hit) return hit;
    // "J. Smith" style: last name + first initial
    const parts = String(key).trim().split(/\s+/);
    if (parts.length >= 2) {
      const last = fold(parts[parts.length - 1]);
      const first = fold(parts[0]).charAt(0);
      const cands = Object.keys(table).filter((id) => {
        const n = String(table[id].name).trim().split(/\s+/);
        return fold(n[n.length - 1]) === last && fold(n[0]).charAt(0) === first;
      });
      if (cands.length === 1) return cands[0];
    }
    return null;
  }

  // ---------------- features (mirror of featurize() in train_model.py) ----------------
  function form(ts, lg, N) {
    const r = ts ? ts.recent : [];
    const n = r.length;
    const half = lg / 2.0;
    let w = 0, m = 0, pf = 0, pa = 0;
    for (const x of r) { m += x[0]; pf += x[1]; pa += x[2]; w += x[3]; }
    return [
      (w + 0.5 * (N - n)) / N,
      m / N,
      (pf + half * (N - n)) / N,
      (pa + half * (N - n)) / N,
    ];
  }

  function starterRating(model, key, lg) {
    const c = model.constants;
    const lgRa = lg / 2.0;
    const s = key != null ? model.starters[key] : null;
    const ra = s ? s.ra : [];
    let sum = 0;
    for (const v of ra) sum += v;
    return (sum + lgRa * c.sp_prior) / (ra.length + c.sp_prior);
  }

  function goalieRating(model, key) {
    const c = model.constants;
    const lgSv = model.league.lg_sv;
    const g = key != null ? model.goalies[key] : null;
    const sv = g ? g.sv : [];
    let saves = 0, shots = 0;
    for (const x of sv) { saves += x[0]; shots += x[1]; }
    return (saves + lgSv * c.g_prior_shots) / (shots + c.g_prior_shots);
  }

  function featurize(sport, model, home, away, day, neutral, hkey, akey) {
    const c = model.constants;
    const th = model.teams[home], ta = model.teams[away];
    const lg = model.league.lg_total;
    const eh = th ? th.elo : 1500.0;
    const ea = ta ? ta.elo : 1500.0;
    const hfa = model.elo.HFA;
    const x = { elo_diff: eh - ea + (neutral ? 0 : hfa), neutral: neutral ? 1 : 0 };
    const cap = c.rest_cap;
    const rh = th && th.last_day != null ? Math.min(day - th.last_day, cap) : cap;
    const ra = ta && ta.last_day != null ? Math.min(day - ta.last_day, cap) : cap;
    x.rest_h = rh;
    x.rest_a = ra;
    if (c.b2b) { x.b2b_h = rh === 1 ? 1 : 0; x.b2b_a = ra === 1 ? 1 : 0; }
    const N = c.recent_n;
    const fh = form(th, lg, N), fa = form(ta, lg, N);
    x.wp10_diff = fh[0] - fa[0];
    x.mg10_diff = fh[1] - fa[1];
    x.pf10_h = fh[2]; x.pa10_h = fh[3]; x.pf10_a = fa[2]; x.pa10_a = fa[3];
    x.lg_total = lg;
    if (sport === "mlb") { x.sp_h = starterRating(model, hkey, lg); x.sp_a = starterRating(model, akey, lg); }
    if (sport === "nhl") { x.gsv_h = goalieRating(model, hkey); x.gsv_a = goalieRating(model, akey); }
    if (sport === "epl") {
      const half = lg / 2.0;
      x.att_h = th && th.att != null ? th.att : half;
      x.def_h = th && th.def != null ? th.def : half;
      x.att_a = ta && ta.att != null ? ta.att : half;
      x.def_a = ta && ta.def != null ? ta.def : half;
    }
    return x;
  }

  // ---------------- model evaluation (mirror of from_features()) ----------------
  function fromFeatures(sport, model, x) {
    const m = model.model;
    const z = m.features.map((f, i) => (x[f] - m.mean[i]) / m.std[i]);
    const dot = (coef, b) => {
      let s = 0;
      for (let i = 0; i < coef.length; i++) s += coef[i] * z[i];
      return s + b;
    };
    const out = { margin: dot(m.margin.coef, m.margin.intercept), total: dot(m.total.coef, m.total.intercept) };
    if (sport === "epl") {
      const logits = m.win.coef.map((c, i) => dot(c, m.win.intercept[i]));
      const mx = Math.max.apply(null, logits);
      const ex = logits.map((v) => Math.exp(v - mx));
      const s = ex.reduce((a, b) => a + b, 0);
      const pr = {};
      m.win.classes.forEach((c, i) => { pr[c] = ex[i] / s; });
      out.pH = pr.H; out.pD = pr.D; out.pA = pr.A;
    } else {
      out.pH = 1 / (1 + Math.exp(-dot(m.win.coef, m.win.intercept)));
    }
    return out;
  }

  // ---------------- public API ----------------
  function load(sport) {
    if (!cache[sport]) {
      cache[sport] = fetch("model_" + sport + ".json", { cache: "no-cache" }).then((r) => {
        if (!r.ok) throw new Error("model_" + sport + ".json -> HTTP " + r.status);
        return r.json();
      }).catch((e) => { delete cache[sport]; throw e; });
    }
    return cache[sport];
  }

  function game(sport, model, opts) {
    const o = opts || {};
    const home = o.home, away = o.away;
    if (!model.teams[home]) throw new Error("Predict: unknown " + sport.toUpperCase() + " team code '" + home + "'");
    if (!model.teams[away]) throw new Error("Predict: unknown " + sport.toUpperCase() + " team code '" + away + "'");
    const day = dayNumber(o.date == null ? new Date() : o.date);
    const neutral = !!o.neutral;
    let hkey = null, akey = null;
    if (sport === "mlb") { hkey = resolveKey(model.starters, o.homeStarter); akey = resolveKey(model.starters, o.awayStarter); }
    if (sport === "nhl") { hkey = resolveKey(model.goalies, o.homeStarter); akey = resolveKey(model.goalies, o.awayStarter); }
    const x = featurize(sport, model, home, away, day, neutral, hkey, akey);
    const p = fromFeatures(sport, model, x);
    const inputs = Object.assign({}, x, {
      homeStarterMatched: hkey ? (sport === "mlb" ? model.starters[hkey].name : model.goalies[hkey].name) : null,
      awayStarterMatched: akey ? (sport === "mlb" ? model.starters[akey].name : model.goalies[akey].name) : null,
    });
    if (sport === "epl") {
      return {
        pHome: p.pH, pAway: p.pA, pDraw: p.pD, margin: p.margin, total: p.total,
        fairHome: odds.probToDecimal(p.pH), fairAway: odds.probToDecimal(p.pA), fairDraw: odds.probToDecimal(p.pD),
        inputs,
      };
    }
    return {
      pHome: p.pH, pAway: 1 - p.pH, pDraw: null, margin: p.margin, total: p.total,
      fairHome: odds.probToAmerican(p.pH), fairAway: odds.probToAmerican(1 - p.pH), fairDraw: null,
      inputs,
    };
  }

  function players(sport, model, team) {
    const list = (model.players && model.players[team]) || [];
    return list.map((e) => ({
      player: e.player, id: e.id, position: e.position, role: e.role, stats: Object.assign({}, e.stats),
      basis: "last " + e.games_last + " games + season (" + model.player_reference_season + ")",
    }));
  }

  function teamCodes(model) {
    return Object.keys(model.teams).sort().map((code) => ({ code, name: model.teams[code].name || code }));
  }

  root.Predict = { load, game, players, teamCodes, odds, fromFeatures, featurize, dayNumber, resolveKey };
})(typeof window !== "undefined" ? window : globalThis);
