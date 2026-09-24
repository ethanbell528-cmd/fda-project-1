/* 3D game replays for the dashboard's game pop-up.

   Data: ESPN's public game summary (GET only, no key)
     https://site.api.espn.com/apis/site/v2/sports/<sport>/<league>/summary?event=<id>
   Every play is shown, and nothing is interpolated or invented. Each play is either drawn at a
   location ESPN recorded, drawn on a spot the rules fix (free-throw line, home plate, penalty
   spot, center), or placed as a bead on a time-order rail along the near side. Games with no
   recorded locations also get a scoring-flow line above the surface.

   Coordinate conventions (checked on several real games of each sport):
   - NBA   plays[].coordinate: half-court feet, x = 0..50 across the court (25 = middle),
           y = feet out from the hoop (0 = level with the rim). Both teams are normalized to
           one basket, so here the home team shoots at the right basket and the away team at
           the left one. Free throws carry a sentinel (about -2.1e8) and are text-only.
   - NHL   plays[].coordinate: true rink feet from center ice (x -100..100, y -42.5..42.5).
           Teams switch ends each period, exactly as recorded.
   - MLB   hitCoordinate: Gameday spray-chart units, home plate at (125.42, 198.27), about
           2.5 ft per unit, y shrinks toward the outfield. pitchCoordinate: strike-zone chart
           units; the zone box (x 90-145, y 148-195) is approximate, from called strikes.
   - NFL   drives[].plays[].start/end.yardLine: 0 = home goal line, 100 = away goal line,
           so the home team drives toward the right end zone.
   - EPL   fieldPositionX/Y (and 2X/2Y for where the ball went): percent of the pitch from
           the acting team's view, attacking x = 100. Home attacks right, away left.

   three.js is loaded only when a replay is opened (import map in dashboard.html). */
(function () {
  "use strict";

  const ESPN = "https://site.api.espn.com/apis/site/v2/sports/";
  const LEAGUE = { nfl: "football/nfl", nba: "basketball/nba", mlb: "baseball/mlb", nhl: "hockey/nhl", epl: "soccer/eng.1" };
  const SENTINEL = -1e6;

  let libs = null;
  async function loadThree() {
    if (libs) return libs;
    const THREE = await import("three");
    const { OrbitControls } = await import("three/addons/controls/OrbitControls.js");
    libs = { THREE, OrbitControls };
    return libs;
  }

  // ---------------- small DOM helpers ----------------
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function reducedMotion() { return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; }

  // ---------------- colors ----------------
  function hexToRgb(h) {
    h = String(h || "").replace("#", "");
    if (!/^[0-9a-f]{6}$/i.test(h)) return null;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function lum(rgb) {
    const c = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function contrast(a, b) { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }
  // Team colors from ESPN when they read well on the playing surface; otherwise the site's first
  // two categorical slots. The two teams must also be clearly different from each other.
  function teamColors(teams, surfaceHex) {
    const surf = hexToRgb(surfaceHex);
    const page = hexToRgb(css("--surface")) || [26, 26, 25]; // legend dots and arcs above the field sit on the page surface
    const pick = (t) => {
      for (const h of [t.color, t.alt]) { const rgb = hexToRgb(h); if (rgb && contrast(rgb, surf) >= 2.2 && contrast(rgb, page) >= 2) return rgb; }
      return null;
    };
    let h = pick(teams.home), a = pick(teams.away);
    const fb = [hexToRgb(css("--nfl")) || [42, 120, 214], hexToRgb(css("--nba")) || [235, 104, 52]];
    if (!h || !a || dist(h, a) < 110) { a = fb[0]; h = fb[1]; }
    const toHex = (rgb) => "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join("");
    return { home: toHex(h), away: toHex(a) };
  }

  // ---------------- per-sport surfaces (world units: NBA/NHL/MLB feet, NFL yards, EPL meters) ----------------
  const SURFACE = {
    nba: { L: 94, W: 50, base: "#c9a26f" },
    nhl: { L: 200, W: 85, base: "#eef3f6" },
    nfl: { L: 120, W: 53.33, base: "#3f7d3a" },
    epl: { L: 105, W: 68, base: "#3d8a3f" },
    mlb: { L: 700, W: 520, base: "#3f8a3c", z0: -450 }, // plane spans z -450..70, home plate at (0, 0)
  };

  function surfaceCanvas(sport, S, teams) {
    const scale = sport === "mlb" ? 3 : sport === "nfl" ? 20 : sport === "epl" ? 16 : sport === "nhl" ? 8 : 16;
    const cw = Math.round(S.L * scale), ch = Math.round(S.W * scale);
    const c = document.createElement("canvas");
    c.width = cw; c.height = ch;
    const g = c.getContext("2d");
    const z0 = S.z0 != null ? S.z0 : -S.W / 2;
    const P = (X, Z) => [(X + S.L / 2) * scale, (Z - z0) * scale];
    const line = (pts, w, col) => { g.beginPath(); pts.forEach(([x, z], i) => { const [a, b] = P(x, z); if (i) g.lineTo(a, b); else g.moveTo(a, b); }); g.lineWidth = w * scale; g.strokeStyle = col; g.stroke(); };
    const circle = (x, z, r, w, col, fill) => { const [a, b] = P(x, z); g.beginPath(); g.arc(a, b, r * scale, 0, Math.PI * 2); if (fill) { g.fillStyle = fill; g.fill(); } if (w) { g.lineWidth = w * scale; g.strokeStyle = col; g.stroke(); } };
    const rect = (x1, z1, x2, z2, fill, w, col) => { const [a, b] = P(x1, z1), [c2, d] = P(x2, z2); if (fill) { g.fillStyle = fill; g.fillRect(a, b, c2 - a, d - b); } if (w) { g.lineWidth = w * scale; g.strokeStyle = col; g.strokeRect(a, b, c2 - a, d - b); } };
    const text = (s, x, z, size, col, rot) => { const [a, b] = P(x, z); g.save(); g.translate(a, b); if (rot) g.rotate(rot); g.fillStyle = col; g.font = "700 " + Math.round(size * scale) + "px system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(s, 0, 0); g.restore(); };
    g.fillStyle = S.base; g.fillRect(0, 0, cw, ch);

    if (sport === "nba") {
      // wood grain stripes
      for (let x = -47; x < 47; x += 2.5) rect(x, -25, x + 1.25, 25, "rgba(120,80,40,0.07)");
      const W = "#ffffff";
      rect(-47, -25, 47, 25, null, 0.18, W);
      line([[0, -25], [0, 25]], 0.18, W);
      circle(0, 0, 6, 0.18, W);
      [-1, 1].forEach((s) => {
        const hx = s * (47 - 5.25);
        rect(Math.min(s * 47, s * (47 - 19)), -8, Math.max(s * 47, s * (47 - 19)), 8, "rgba(140,40,30,0.30)", 0.18, W);
        circle(s * (47 - 19), 0, 6, 0.18, W);
        // three-point line: corners 22 ft from the hoop, 14 ft deep from the baseline, arc 23.75 ft
        const cornerDepth = 14;
        line([[s * 47, -22], [s * (47 - cornerDepth), -22]], 0.18, W);
        line([[s * 47, 22], [s * (47 - cornerDepth), 22]], 0.18, W);
        const a0 = Math.asin(22 / 23.75);
        const pts = [];
        for (let i = 0; i <= 40; i++) { const t = -a0 + (2 * a0 * i) / 40; pts.push([hx - s * 23.75 * Math.cos(t), 23.75 * Math.sin(t)]); }
        line(pts, 0.18, W);
        text(s > 0 ? teams.home.abbr + " shoot →" : "← " + teams.away.abbr + " shoot", s * 30, 20.5, 2.2, "rgba(255,255,255,0.85)");
      });
    } else if (sport === "nhl") {
      const R = 28;
      g.fillStyle = "#8d969b"; g.fillRect(0, 0, cw, ch); // outside the boards
      g.save(); g.beginPath();
      const [x0, y0] = P(-100, -42.5), [x1, y1] = P(100, 42.5);
      g.roundRect(x0, y0, x1 - x0, y1 - y0, R * scale); g.clip();
      g.fillStyle = S.base; g.fillRect(0, 0, cw, ch);
      line([[0, -42.5], [0, 42.5]], 1, "#c8102e");
      [-25, 25].forEach((x) => line([[x, -42.5], [x, 42.5]], 1, "#1f4fbf"));
      [-89, 89].forEach((x) => line([[x, -42.5], [x, 42.5]], 0.25, "#c8102e"));
      circle(0, 0, 15, 0.25, "#1f4fbf");
      [-69, 69].forEach((x) => [-22, 22].forEach((z) => { circle(x, z, 15, 0.25, "#c8102e"); circle(x, z, 1, 0, null, "#c8102e"); }));
      [-20, 20].forEach((x) => [-22, 22].forEach((z) => circle(x, z, 1, 0, null, "#c8102e")));
      [-1, 1].forEach((s) => { const [a, b] = P(s * 89, 0); g.beginPath(); g.arc(a, b, 6 * scale, s > 0 ? Math.PI / 2 : -Math.PI / 2, s > 0 ? Math.PI * 1.5 : Math.PI / 2); g.fillStyle = "rgba(80,150,230,0.35)"; g.fill(); });
      g.restore();
      g.beginPath(); g.roundRect(x0, y0, x1 - x0, y1 - y0, R * scale); g.lineWidth = 1 * scale; g.strokeStyle = "#555"; g.stroke();
    } else if (sport === "nfl") {
      const W = "#ffffff";
      rect(-60, -S.W / 2, -50, S.W / 2, teams.homeColor);
      rect(50, -S.W / 2, 60, S.W / 2, teams.awayColor);
      text(teams.home.abbr, -55, 0, 5, "rgba(255,255,255,0.9)", -Math.PI / 2);
      text(teams.away.abbr, 55, 0, 5, "rgba(255,255,255,0.9)", Math.PI / 2);
      for (let x = -50; x <= 50; x += 5) line([[x, -S.W / 2], [x, S.W / 2]], x % 10 === 0 ? 0.25 : 0.15, W);
      for (let x = -49; x <= 49; x++) { [-S.W / 2 + 0.6, -3.08, 3.08, S.W / 2 - 0.6].forEach((z) => line([[x, z - 0.4], [x, z + 0.4]], 0.1, W)); }
      for (let x = -40; x <= 40; x += 10) { const n = 50 - Math.abs(x); text(String(n), x, S.W / 2 - 6, 2.4, "rgba(255,255,255,0.85)"); text(String(n), x, -S.W / 2 + 6, 2.4, "rgba(255,255,255,0.85)", Math.PI); }
      rect(-60, -S.W / 2, 60, S.W / 2, null, 0.3, W);
      text(teams.home.abbr + " drives →", -25, 0, 1.6, "rgba(255,255,255,0.55)");
      text("← " + teams.away.abbr + " drives", 25, 0, 1.6, "rgba(255,255,255,0.55)");
    } else if (sport === "epl") {
      const W = "#ffffff";
      for (let x = -52.5; x < 52.5; x += 10.5) rect(x, -34, x + 5.25, 34, "rgba(255,255,255,0.05)");
      rect(-52.5, -34, 52.5, 34, null, 0.15, W);
      line([[0, -34], [0, 34]], 0.15, W);
      circle(0, 0, 9.15, 0.15, W);
      [-1, 1].forEach((s) => {
        const gx = s * 52.5;
        rect(Math.min(gx, gx - s * 16.5), -20.16, Math.max(gx, gx - s * 16.5), 20.16, null, 0.15, W);
        rect(Math.min(gx, gx - s * 5.5), -9.16, Math.max(gx, gx - s * 5.5), 9.16, null, 0.15, W);
        circle(gx - s * 11, 0, 0.3, 0, null, W);
        text(s > 0 ? teams.home.abbr + " attack →" : "← " + teams.away.abbr + " attack", s * 36, 30, 2.2, "rgba(255,255,255,0.8)");
      });
    } else if (sport === "mlb") {
      // outfield grass is the base; fence arc; infield dirt; base paths
      const fence = (deg) => 400 - (70 * Math.abs(deg)) / 45; // ~330 ft down the lines, 400 ft to center
      g.beginPath();
      for (let d = -45; d <= 45; d++) { const r = fence(d), t = (d * Math.PI) / 180; const [a, b] = P(r * Math.sin(t), -r * Math.cos(t)); if (d === -45) g.moveTo(...P(0, 0)); g.lineTo(a, b); }
      g.closePath(); g.fillStyle = "#4a9a45"; g.fill();
      // infield dirt: the 95-ft arc around the mound, fair territory only
      g.save(); g.beginPath(); g.moveTo(...P(0, 0)); g.lineTo(...P(-400, -400)); g.lineTo(...P(400, -400)); g.closePath(); g.clip();
      circle(0, -60.5, 95, 0, null, "#b5835a");
      g.restore();
      const d90 = 90 / Math.SQRT2;
      const diamond = [[0, 0], [d90, -d90], [0, -2 * d90], [-d90, -d90], [0, 0]];
      g.beginPath(); diamond.forEach(([x, z], i) => { const [a, b] = P(x, z); if (i) g.lineTo(a, b); else g.moveTo(a, b); }); g.fillStyle = "#4a9a45"; g.fill();
      line(diamond, 1.5, "#d9c3a0");
      circle(0, -60.5, 9, 0, null, "#b5835a");
      circle(0, 0, 13, 0, null, "#b5835a");
      line([[0, 0], [-330 * Math.sin(Math.PI / 4), -330 * Math.cos(Math.PI / 4)]], 1, "#ffffff");
      line([[0, 0], [330 * Math.sin(Math.PI / 4), -330 * Math.cos(Math.PI / 4)]], 1, "#ffffff");
      const arc = [];
      for (let d = -45; d <= 45; d++) { const r = fence(d), t = (d * Math.PI) / 180; arc.push([r * Math.sin(t), -r * Math.cos(t)]); }
      line(arc, 2, "#2d5a2b");
      [["330", -45], ["400", 0], ["330", 45]].forEach(([s, d]) => { const r = fence(d) + 14, t = (d * Math.PI) / 180; text(s, r * Math.sin(t), -r * Math.cos(t), 12, "rgba(255,255,255,0.8)"); });
    }
    return c;
  }

  // ---------------- data: ESPN summary -> normalized events ----------------
  function periodLabel(sport, p) {
    const n = p && p.number;
    if (sport === "mlb") return (p.type ? p.type + " " : "") + (p.displayValue ? p.displayValue.replace(" Inning", "") : n);
    if (sport === "epl") return n === 1 ? "1st half" : n === 2 ? "2nd half" : "Period " + n;
    if (sport === "nhl") return n <= 3 ? "Period " + n : n === 4 ? "OT" : "Shootout";
    return n <= 4 ? "Q" + n : "OT" + (n > 5 ? n - 4 : "");
  }

  function headerTeams(d) {
    const comp = d.header && d.header.competitions && d.header.competitions[0];
    const out = {};
    for (const c of (comp && comp.competitors) || []) {
      const t = c.team || {};
      out[c.homeAway] = { id: String(t.id), abbr: t.abbreviation || "", name: t.displayName || t.shortDisplayName || t.name || "",
        names: [t.displayName, t.shortDisplayName, t.name, t.location, t.abbreviation].filter(Boolean), color: t.color, alt: t.alternateColor,
        score: c.score != null ? Number(c.score) : null };
    }
    return out;
  }

  // Every play gets exactly one category:
  //   real    - drawn where ESPN recorded it (coordinates, yard lines, pitch location)
  //   fixed   - drawn on a spot the rules fix (free-throw line, home plate, penalty spot, center)
  //   carried - NFL play without a yard line, drawn at the previous play's end spot (marked)
  //   rail    - no location: a bead on the time-order rail along the near side
  function parse(sport, d) {
    const T = headerTeams(d);
    const side = (id) => (id == null ? null : String(id) === T.home.id ? "home" : String(id) === T.away.id ? "away" : null);
    const other = (s) => (s === "home" ? "away" : s === "away" ? "home" : null);
    const sgn = (s) => (s === "home" ? 1 : -1);
    const ev = [];
    const push = (o) => { o.i = ev.length; if (!o.cat) o.cat = o.draw ? "real" : "rail"; ev.push(o); };

    if (sport === "nba") {
      for (const p of d.plays || []) {
        const s = side(p.team && p.team.id);
        const c = p.coordinate, tt = ((p.type && p.type.text) || "").toLowerCase();
        const valid = c && c.x > SENTINEL && c.y > -10 && c.y < 94 && !(c.x === 0 && c.y === 0); // older feeds use (0, 0) as "no location"
        let draw = null, cat = null;
        if (s && /free throw/.test(tt)) {
          draw = { kind: "spot", X: sgn(s) * 28, Z: 0, made: !!p.scoringPlay }; cat = "fixed"; // free-throw line, 15 ft from the backboard
        } else if (s && p.shootingPlay && valid) {
          const sg = sgn(s);
          draw = { kind: "shot", made: !!p.scoringPlay, pts: p.scoreValue, X: sg * (41.75 - c.y), Z: sg * (c.x - 25), hoop: [sg * 41.75, 0] };
        } else if (s && valid) {
          // non-shot events share the basket-relative frame: offensive actions at the acting team's
          // basket, defensive rebounds and defensive fouls at the basket the acting team defends
          const atOwn = /offensive|turnover|charge|travel|violation|3 second|kicked/.test(tt);
          const sg = sgn(atOwn ? s : other(s));
          draw = { kind: "dot", X: sg * (41.75 - c.y), Z: sg * (c.x - 25) };
        } else if (/jump ?ball/.test(tt)) {
          draw = { kind: "spot", X: 0, Z: 0, made: false }; cat = "fixed"; // center circle
        }
        push({ period: p.period.number, plabel: periodLabel(sport, p.period), clock: p.clock && p.clock.displayValue, text: p.text || "", side: s, h: p.homeScore, a: p.awayScore, draw, cat });
      }
    } else if (sport === "nhl") {
      const SHOT = { Shot: "on", Goal: "goal", Missed: "miss", Blocked: "blocked", "Penalty Shot": "on" };
      for (const p of d.plays || []) {
        const s = side(p.team && p.team.id);
        const c = p.coordinate, kind = SHOT[p.type && p.type.text];
        let draw = null;
        if (c && Math.abs(c.x) <= 100 && Math.abs(c.y) <= 43) {
          if (kind && s) draw = { kind: "shot", made: kind === "goal", sub: kind, X: c.x, Z: -c.y, hoop: [c.x >= 0 ? 89 : -89, 0], highlight: kind === "goal" };
          else draw = { kind: "dot", X: c.x, Z: -c.y };
        }
        push({ period: p.period.number, plabel: periodLabel(sport, p.period), clock: p.clock && p.clock.displayValue, text: p.text || (p.type && p.type.text) || "", side: s, h: p.homeScore, a: p.awayScore, draw });
      }
    } else if (sport === "mlb") {
      const HIT = new Set(["single", "double", "triple", "home-run"]);
      let runners = [false, false, false], half = null;
      for (const p of d.plays || []) {
        const bat = p.period && p.period.type === "Top" ? "away" : p.period && p.period.type === "Bottom" ? "home" : null;
        const hk = p.period ? p.period.type + p.period.number : null;
        if (hk !== half) { half = hk; runners = [false, false, false]; }
        const tp = (p.type && p.type.type) || "", txt = p.text || (p.type && p.type.text) || "";
        const hc = p.hitCoordinate, pc = p.pitchCoordinate;
        let draw = null, cat = null;
        if (hc && bat && Number.isFinite(hc.x) && Number.isFinite(hc.y)) {
          draw = { kind: "hit", made: HIT.has(tp), hr: tp === "home-run" || /homer|home run/i.test(txt), traj: p.trajectory || "", X: (hc.x - 125.42) * 2.5, Z: -(198.27 - hc.y) * 2.5 };
          draw.highlight = draw.hr;
        } else if (pc && Number.isFinite(pc.x)) {
          draw = { kind: "pitch", px: pc.x, py: pc.y, ptype: tp };
        } else if (bat && /struck out|strikes out|walked|walks|intentionally|hit by pitch/i.test(txt)) {
          draw = { kind: "spot", X: 0, Z: 0, made: /walk|hit by pitch/i.test(txt) }; cat = "fixed"; // home plate
        }
        // pitch and play events carry onFirst/onSecond/onThird when a runner is on that base
        if (pc || tp === "play-result" || p.atBatPitchNumber != null) runners = [!!p.onFirst, !!p.onSecond, !!p.onThird];
        push({ period: p.period ? p.period.number : null, plabel: p.period ? periodLabel(sport, p.period) : "", clock: "", text: txt, side: bat, h: p.homeScore, a: p.awayScore, draw, cat,
          atBat: p.atBatId, runners: runners.slice(), pitch: pc ? { x: pc.x, y: pc.y, type: tp, name: p.pitchType && p.pitchType.abbreviation, mph: p.pitchVelocity } : null });
      }
    } else if (sport === "nfl") {
      const drives = (d.drives && d.drives.previous) || [];
      if (d.drives && d.drives.current && !drives.some((x) => x.id === d.drives.current.id)) drives.push(d.drives.current);
      let lastEnd = null;
      drives.forEach((dr, di) => {
        const ds = side(dr.team && dr.team.id);
        for (const p of dr.plays || []) {
          const st = p.start || {}, en = p.end || {};
          const s = side(st.team && st.team.id) || ds;
          const tt = ((p.type && p.type.text) || "").toLowerCase();
          let draw = null, cat = null;
          const railType = /timeout|end of|end period|two-minute|two minute|end quarter/.test(tt);
          const y0 = st.yardLine, y1raw = en.yardLine;
          if (!railType && s && Number.isFinite(y0)) {
            let y1 = y1raw;
            if (/field goal/.test(tt)) y1 = s === "home" ? 110 : -10; // kick travels to the goal posts
            if (Number.isFinite(y1) && y1 !== y0) {
              draw = { kind: "drive", drive: di, X0: y0 - 50, X1: Math.max(-60, Math.min(60, y1 - 50)), made: !!p.scoringPlay, highlight: !!p.scoringPlay, turnover: !!p.isTurnover };
            } else {
              draw = { kind: "los", drive: di, X: y0 - 50, highlight: !!p.scoringPlay }; // no gain, incompletion, penalty: at the line of scrimmage
            }
          } else if (!railType && s && lastEnd != null) {
            draw = { kind: "los", drive: di, X: lastEnd, carried: true }; cat = "carried";
          }
          if (Number.isFinite(y1raw)) lastEnd = y1raw - 50; else if (Number.isFinite(y0)) lastEnd = y0 - 50;
          push({ period: p.period && p.period.number, plabel: p.period ? periodLabel(sport, p.period) : "", clock: p.clock && p.clock.displayValue, text: p.text || (p.type && p.type.text) || "", side: s, h: p.homeScore, a: p.awayScore, draw, cat, drive: di });
        }
      });
    } else if (sport === "epl") {
      const keyById = {};
      for (const k of d.keyEvents || []) keyById[k.id] = k;
      const nk = (v) => String(v || "").toLowerCase().replace(/&/g, "and").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
      const matchName = (raw) => { const nm = nk(raw); for (const s of ["home", "away"]) if (T[s].names.some((n) => nk(n) === nm)) return s; return null; };
      const teamFromText = (t) => {
        const s0 = String(t || "");
        for (const g of s0.match(/\(([^()]+)\)/g) || []) { const r = matchName(g.slice(1, -1)); if (r) return r; }
        const lead = s0.match(/^(?:Corner|Penalty|Substitution),\s*([^.,]+)[.,]/);
        return lead ? matchName(lead[1]) : null;
      };
      let items = (d.commentary || []).slice().sort((x, y) => (x.sequence || 0) - (y.sequence || 0));
      // sparse older feeds have no commentary, only key events (goals, cards, substitutions)
      if (!items.length) items = (d.keyEvents || []).map((k) => ({ play: k, text: k.text || k.shortText || (k.type && k.type.text), time: k.clock }));
      const used = new Set();
      let h = 0, a = 0;
      const allPos = [...(d.keyEvents || []), ...(d.commentary || []).map((c) => c.play || {})].map((q) => q.fieldPositionX).filter((v) => typeof v === "number");
      const pctScale = allPos.some((v) => v > 1.5); // the verified 0-100 percent scale
      const addPlay = (p, text, clock) => {
        const kev = keyById[p.id];
        const t = (p.type && p.type.type) || "";
        const s = side((kev && kev.team && kev.team.id) || (p.team && p.team.id)) || teamFromText(text) || teamFromText(p.text);
        if (p.scoringPlay || (kev && kev.scoringPlay)) {
          const m = String((kev && kev.text) || text || "").match(/Goal!\s*(.+?)\s+(\d+),\s*(.+?)\s+(\d+)\./);
          if (m) { h = +m[2]; a = +m[4]; } else if (s === "home") h++; else if (s === "away") a++;
        }
        let draw = null, cat = null;
        const sg = sgn(s);
        const mx = (v) => sg * ((v / 100) * 105 - 52.5), mz = (v) => sg * ((v / 100) * 68 - 34);
        const shot = /^(shot|goal|penalty---)/.test(t) || p.scoringPlay;
        // older feeds use (0, 0) as "no position", and some use an unverified 0-1 scale: both are treated as missing
        const hasPos = pctScale && p.fieldPositionX != null && p.fieldPositionY != null && !(p.fieldPositionX === 0 && p.fieldPositionY === 0);
        if (s && hasPos) {
          if (shot) {
            const to = p.fieldPosition2X != null && p.fieldPosition2Y != null ? [mx(p.fieldPosition2X), mz(p.fieldPosition2Y)] : null;
            const goal = !!(p.scoringPlay || /^goal|scored/.test(t));
            draw = { kind: "shot", made: goal, sub: goal ? "goal" : /on-target|saved/.test(t) ? "on" : /blocked/.test(t) ? "blocked" : "miss", X: mx(p.fieldPositionX), Z: mz(p.fieldPositionY), to, highlight: goal };
          } else draw = { kind: "dot", X: mx(p.fieldPositionX), Z: mz(p.fieldPositionY) };
        } else if (s && /penalty/.test(t) && !/foul|conceded/.test(t)) {
          draw = { kind: "spot", X: sg * (52.5 - 11), Z: 0, made: !!p.scoringPlay }; cat = "fixed"; // penalty spot, 11 m from goal
        } else if (/kickoff|start-2nd-half|start-extra/.test(t)) {
          draw = { kind: "spot", X: 0, Z: 0, made: false }; cat = "fixed"; // center spot
        }
        const per = (p.period && p.period.number) || (kev && kev.period && kev.period.number) || null;
        push({ period: per, plabel: per ? periodLabel(sport, { number: per }) : "", clock, text: text || p.text || p.shortText || (p.type && p.type.text) || "", side: s, h, a, draw, cat });
      };
      for (const it of items) {
        const p = it.play;
        if (p) { used.add(p.id); addPlay(p, it.text, it.time && it.time.displayValue); }
        else push({ period: null, plabel: "", clock: it.time && it.time.displayValue, text: it.text || "", side: teamFromText(it.text), h, a, draw: null });
      }
      // goals, kickoffs and restarts present in keyEvents but missing from commentary
      for (const k of d.keyEvents || []) if (!used.has(k.id) && (k.scoringPlay || /kickoff|start-2nd-half/.test((k.type && k.type.type) || ""))) addPlay(k, k.text, k.clock && k.clock.displayValue);
    }
    // a final score that the play list does not reach (e.g. an NHL shootout win) gets one closing row
    const fin = (d.header && d.header.competitions && d.header.competitions[0] && d.header.competitions[0].status && d.header.competitions[0].status.type) || {};
    if (fin.completed && ev.length && Number.isFinite(T.home.score) && Number.isFinite(T.away.score)) {
      const lastH = [...ev].reverse().find((e) => Number.isFinite(e.h)), lastA = [...ev].reverse().find((e) => Number.isFinite(e.a));
      if ((lastH && lastH.h !== T.home.score) || (lastA && lastA.a !== T.away.score)) {
        push({ period: null, plabel: "Final", clock: "", text: "Final score from ESPN" + (sport === "nhl" ? " (includes the shootout winner's goal)" : "") + ".", side: null, h: T.home.score, a: T.away.score, draw: null });
      }
    }
    // carry the last known score forward so every step has a scoreboard
    let lh = 0, la = 0;
    for (const e of ev) { if (Number.isFinite(e.h)) lh = e.h; else e.h = lh; if (Number.isFinite(e.a)) la = e.a; else e.a = la; }
    const counts = { real: 0, fixed: 0, carried: 0, rail: 0 };
    for (const e of ev) counts[e.cat] += 1;
    return { teams: T, events: ev, counts };
  }

  // ---------------- 3D scene ----------------
  function buildScene(L, sport, data, colors, mount, onPick) {
    const { THREE, OrbitControls } = L;
    const S = SURFACE[sport];
    const z0 = S.z0 != null ? S.z0 : -S.W / 2;
    const unit = sport === "mlb" ? 6 : sport === "nfl" ? 0.8 : sport === "epl" ? 0.9 : sport === "nhl" ? 1.6 : 0.8; // marker radius

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const scene = new THREE.Scene();
    const bg = () => scene.background = new THREE.Color(css("--surface") || "#1a1a19");
    bg();
    const w0 = mount.clientWidth || 800, h0 = mount.clientHeight || 480;
    renderer.setSize(w0, h0);
    mount.appendChild(renderer.domElement);
    renderer.domElement.setAttribute("aria-hidden", "true");

    const far = Math.max(S.L, S.W) * 6;
    const camera = new THREE.PerspectiveCamera(45, w0 / h0, 0.1, far);
    const target = sport === "mlb" ? new THREE.Vector3(0, 0, -170) : new THREE.Vector3(0, 0, 0);
    const home0 = sport === "mlb" ? new THREE.Vector3(0, 330, 280) : new THREE.Vector3(0, S.L * 0.62, S.W * 1.25);
    // narrow (phone) views need the camera further back so the whole surface fits across
    const homeFor = (aspect) => home0.clone().sub(target).multiplyScalar(Math.max(1, 1.45 / Math.max(aspect, 0.3))).add(target);
    let home = homeFor(w0 / h0);
    camera.position.copy(home);
    camera.lookAt(target);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(target);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI / 2.05;
    controls.minDistance = Math.max(S.L, S.W) * 0.15;
    controls.maxDistance = Math.max(S.L, S.W) * 2.5;
    controls.update();

    scene.add(new THREE.HemisphereLight(0xffffff, 0x445544, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(S.L * 0.3, S.L, S.W * 0.6);
    scene.add(sun);

    // surface
    const tex = new THREE.CanvasTexture(surfaceCanvas(sport, S, { home: data.teams.home, away: data.teams.away, homeColor: colors.home, awayColor: colors.away }));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(S.L, S.W), new THREE.MeshLambertMaterial({ map: tex }));
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(0, 0, z0 + S.W / 2);
    scene.add(plane);

    const white = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const dark = new THREE.MeshLambertMaterial({ color: 0x333333 });
    const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); scene.add(m); return m; };
    if (sport === "nba") {
      [-1, 1].forEach((s) => {
        add(new THREE.BoxGeometry(0.15, 3.5, 6), new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }), s * 43, 11.5, 0);
        const rim = add(new THREE.TorusGeometry(0.75, 0.07, 8, 24), new THREE.MeshLambertMaterial({ color: 0xff5a1f }), s * 41.75, 10, 0);
        rim.rotation.x = Math.PI / 2;
        add(new THREE.CylinderGeometry(0.25, 0.25, 10, 8), dark, s * 45.5, 5, 0);
      });
    } else if (sport === "nhl") {
      [-1, 1].forEach((s) => {
        const red = new THREE.MeshLambertMaterial({ color: 0xc8102e });
        add(new THREE.BoxGeometry(0.2, 4, 0.2), red, s * 89, 2, -3);
        add(new THREE.BoxGeometry(0.2, 4, 0.2), red, s * 89, 2, 3);
        add(new THREE.BoxGeometry(0.2, 0.2, 6), red, s * 89, 4, 0);
        add(new THREE.BoxGeometry(3.3, 4, 6), new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }), s * 90.7, 2, 0);
      });
      // boards
      const shape = new THREE.Shape();
      const r = 28, hx = 100, hz = 42.5;
      shape.moveTo(-hx + r, -hz); shape.lineTo(hx - r, -hz); shape.quadraticCurveTo(hx, -hz, hx, -hz + r); shape.lineTo(hx, hz - r);
      shape.quadraticCurveTo(hx, hz, hx - r, hz); shape.lineTo(-hx + r, hz); shape.quadraticCurveTo(-hx, hz, -hx, hz - r); shape.lineTo(-hx, -hz + r); shape.quadraticCurveTo(-hx, -hz, -hx + r, -hz);
      const pts = shape.getPoints(64).map((p) => new THREE.Vector3(p.x, 1.75, p.y));
      const boards = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x888888 }));
      scene.add(boards);
    } else if (sport === "nfl") {
      [-1, 1].forEach((s) => {
        const y = new THREE.MeshLambertMaterial({ color: 0xffd400 });
        add(new THREE.CylinderGeometry(0.15, 0.15, 3.3, 8), y, s * 60, 1.65, 0);
        add(new THREE.BoxGeometry(0.2, 0.2, 6.2), y, s * 60, 3.3, 0);
        add(new THREE.CylinderGeometry(0.1, 0.1, 10, 8), y, s * 60, 8.3, -3.1);
        add(new THREE.CylinderGeometry(0.1, 0.1, 10, 8), y, s * 60, 8.3, 3.1);
      });
    } else if (sport === "epl") {
      [-1, 1].forEach((s) => {
        add(new THREE.BoxGeometry(0.15, 2.44, 0.15), white, s * 52.5, 1.22, -3.66);
        add(new THREE.BoxGeometry(0.15, 2.44, 0.15), white, s * 52.5, 1.22, 3.66);
        add(new THREE.BoxGeometry(0.15, 0.15, 7.32), white, s * 52.5, 2.44, 0);
        add(new THREE.BoxGeometry(2, 2.44, 7.32), new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.25 }), s * 53.5, 1.22, 0);
      });
    } else if (sport === "mlb") {
      const d90 = 90 / Math.SQRT2;
      [[d90, -d90], [0, -2 * d90], [-d90, -d90]].forEach(([x, z]) => add(new THREE.BoxGeometry(3, 1, 3), white, x, 0.5, z));
      add(new THREE.CylinderGeometry(9, 9, 1.2, 24), new THREE.MeshLambertMaterial({ color: 0xb5835a }), 0, 0.6, -60.5);
      add(new THREE.BoxGeometry(2, 0.3, 2), white, 0, 0.15, 0);
      // outfield wall
      const fence = (deg) => 400 - (70 * Math.abs(deg)) / 45;
      const pos = [];
      for (let dg = -45; dg < 45; dg++) {
        const p = (k) => { const t = (k * Math.PI) / 180, r = fence(k); return [r * Math.sin(t), -r * Math.cos(t)]; };
        const [ax, az] = p(dg), [bx, bz] = p(dg + 1);
        pos.push(ax, 0, az, bx, 0, bz, bx, 10, bz, ax, 0, az, bx, 10, bz, ax, 10, az);
      }
      const wg = new THREE.BufferGeometry();
      wg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      wg.computeVertexNormals();
      scene.add(new THREE.Mesh(wg, new THREE.MeshLambertMaterial({ color: 0x1f4a2a, side: THREE.DoubleSide })));
    }

    // ---- event markers ----
    const markers = []; // { i, period, objs: [] }
    const mat = {
      home: new THREE.MeshStandardMaterial({ color: colors.home, roughness: 0.5 }),
      away: new THREE.MeshStandardMaterial({ color: colors.away, roughness: 0.5 }),
      homeHi: new THREE.MeshStandardMaterial({ color: colors.home, emissive: colors.home, emissiveIntensity: 0.55 }),
      awayHi: new THREE.MeshStandardMaterial({ color: colors.away, emissive: colors.away, emissiveIntensity: 0.55 }),
      lineHome: new THREE.LineBasicMaterial({ color: colors.home, transparent: true, opacity: 0.85 }),
      lineAway: new THREE.LineBasicMaterial({ color: colors.away, transparent: true, opacity: 0.85 }),
      neutral: new THREE.MeshStandardMaterial({ color: 0xb8b8b0, roughness: 0.6 }),
      ghost: new THREE.MeshStandardMaterial({ color: 0xdddddd, transparent: true, opacity: 0.4 }),
      dimHome: new THREE.MeshStandardMaterial({ color: colors.home, transparent: true, opacity: 0.22 }),
      dimAway: new THREE.MeshStandardMaterial({ color: colors.away, transparent: true, opacity: 0.22 }),
      dimNeutral: new THREE.MeshStandardMaterial({ color: 0xb8b8b0, transparent: true, opacity: 0.22 }),
      pBall: new THREE.MeshBasicMaterial({ color: css("--mlb") || "#1baf7a" }),
      pStrike: new THREE.MeshBasicMaterial({ color: css("--nba") || "#eb6834" }),
      pPlay: new THREE.MeshBasicMaterial({ color: css("--nfl") || "#2a78d6" }),
    };
    const geo = {
      ball: new THREE.SphereGeometry(unit, 16, 12),
      ring: new THREE.TorusGeometry(unit * 0.9, unit * 0.25, 8, 20),
      star: new THREE.OctahedronGeometry(unit * 1.9),
      disc: new THREE.CylinderGeometry(unit * 0.55, unit * 0.55, unit * 0.15, 16),
      post: new THREE.CylinderGeometry(unit * 0.45, unit * 0.45, unit * 3, 12),
      cap: new THREE.SphereGeometry(unit * 0.6, 12, 8),
      bead: new THREE.SphereGeometry(unit * 0.55, 10, 8),
      pitch: new THREE.SphereGeometry(3, 12, 8),
      runner: new THREE.SphereGeometry(5, 14, 10),
    };
    const pickable = [];
    let zoneGroup = null;
    if (sport === "mlb") {
      zoneGroup = new THREE.Group();
      zoneGroup.position.set(0, 55, 30.5);
      zoneGroup.rotation.x = -0.75; // face the default camera
      scene.add(zoneGroup);
    }
    const arc = (x0, z0_, x1, z1, hgt, lmat, y0 = 0.3, y1 = 0.3) => {
      const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(x0, y0, z0_), new THREE.Vector3((x0 + x1) / 2, hgt, (z0_ + z1) / 2), new THREE.Vector3(x1, y1, z1));
      return new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(24)), lmat);
    };
    const tube = (x0, z0_, x1, z1, hgt, m, r, y0 = 0.3, y1 = 0.3) => {
      const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(x0, y0, z0_), new THREE.Vector3((x0 + x1) / 2, hgt, (z0_ + z1) / 2), new THREE.Vector3(x1, y1, z1));
      return new THREE.Mesh(new THREE.TubeGeometry(curve, 24, r, 6, false), m);
    };
    const own = []; // geometries created per marker, disposed on rebuild
    const nDrives = sport === "nfl" ? Math.max(1, ...data.events.filter((e) => e.draw && e.draw.kind === "drive").map((e) => e.draw.drive + 1)) : 1;
    const laneGap = (S.W - 6) / Math.max(1, nDrives - 1);
    const barW = Math.min(1.3, laneGap * 0.7);
    for (const e of data.events) {
      const dr = e.draw;
      if (!dr) continue;
      const home = e.side === "home", neutral = !e.side;
      const m = neutral ? mat.neutral : home ? mat.home : mat.away, mh = neutral ? mat.neutral : home ? mat.homeHi : mat.awayHi, lm = home ? mat.lineHome : mat.lineAway;
      const objs = [];
      const put = (o, x, y, z) => { o.position.set(x, y, z); objs.push(o); };
      if (dr.kind === "shot") {
        const y = sport === "nba" ? 0.4 : 0.5;
        if (dr.highlight) { const s = new THREE.Mesh(geo.star, mh); put(s, dr.X, unit * 2, dr.Z); }
        else if (dr.made || dr.sub === "on") put(new THREE.Mesh(geo.ball, m), dr.X, unit, dr.Z);
        else { const r = new THREE.Mesh(geo.ring, m); r.rotation.x = Math.PI / 2; put(r, dr.X, y, dr.Z); }
        if (sport === "nba" && dr.made) { const a = arc(dr.X, dr.Z, dr.hoop[0], dr.hoop[1], 14, lm, 7, 10); own.push(a.geometry); objs.push(a); }
        if (sport === "nhl" && dr.highlight) { const a = arc(dr.X, dr.Z, dr.hoop[0], dr.hoop[1], 3, lm, 0.3, 1); own.push(a.geometry); objs.push(a); }
        if (sport === "epl" && dr.to) {
          const hgt = dr.sub === "goal" ? 1.6 : dr.sub === "on" ? 1.4 : dr.sub === "blocked" ? 0.6 : 3;
          if (dr.highlight) { const t = tube(dr.X, dr.Z, dr.to[0], dr.to[1], hgt, mh, 0.12, 0.3, 1); own.push(t.geometry); objs.push(t); }
          else { const a = arc(dr.X, dr.Z, dr.to[0], dr.to[1], hgt, lm, 0.3, 1); own.push(a.geometry); objs.push(a); }
        }
      } else if (dr.kind === "hit") {
        const hgt = { G: 4, B: 2, L: 35, F: 110, P: 140 }[dr.traj] || 40;
        const dist = Math.hypot(dr.X, dr.Z);
        const h = dr.traj === "F" || dr.traj === "P" ? Math.min(hgt, dist * 0.6 + 20) : hgt;
        if (dr.highlight) { const t = tube(0, 0, dr.X, dr.Z, h, mh, 1.6, 3, 1); own.push(t.geometry); objs.push(t); const s = new THREE.Mesh(geo.star, mh); put(s, dr.X, unit * 2, dr.Z); }
        else {
          const a = arc(0, 0, dr.X, dr.Z, h, lm, 3, 1); own.push(a.geometry); objs.push(a);
          if (dr.made) put(new THREE.Mesh(geo.ball, m), dr.X, unit, dr.Z);
          else { const r = new THREE.Mesh(geo.ring, m); r.rotation.x = Math.PI / 2; put(r, dr.X, 1, dr.Z); }
        }
      } else if (dr.kind === "dot") {
        // another recorded event (rebound, hit, foul, faceoff, turnover): flat disc at its spot
        put(new THREE.Mesh(geo.disc, m), dr.X, unit * 0.1, dr.Z);
      } else if (dr.kind === "spot") {
        // fixed rule spot (free-throw line, home plate, penalty spot, center): a post, capped if made
        put(new THREE.Mesh(geo.post, m), dr.X, unit * 1.5, dr.Z);
        if (dr.made) put(new THREE.Mesh(geo.cap, mh), dr.X, unit * 3.2, dr.Z);
      } else if (dr.kind === "los") {
        const lane = -S.W / 2 + 3 + dr.drive * laneGap;
        if (dr.highlight) put(new THREE.Mesh(geo.star, mh), dr.X, 1.8, lane);
        else put(new THREE.Mesh(geo.post, dr.carried ? mat.ghost : m), dr.X, unit * 1.5, lane);
      } else if (dr.kind === "pitch") {
        // pitch location on the 3D strike-zone board behind home plate (current at-bat only)
        const bx = ((dr.px - 117.5) / 95) * 40, by = 55 + ((171.5 - dr.py) / 85) * 35;
        const t = dr.ptype || "";
        const pm = /ball|pitchout|intent/.test(t) ? mat.pBall : /strike|foul/.test(t) ? mat.pStrike : mat.pPlay;
        const pm3 = new THREE.Mesh(geo.pitch, pm);
        pm3.position.set(bx, by - 55, 0.6);
        zoneGroup.add(pm3);
        objs.push(pm3);
      } else if (dr.kind === "drive") {
        const lane = -S.W / 2 + 3 + dr.drive * laneGap; // one lane per drive, in game order from the far sideline
        const x0 = dr.X0, x1 = dr.X1, len = Math.abs(x1 - x0);
        if (len > 0.01) {
          const bar = new THREE.Mesh(new THREE.BoxGeometry(len, 0.35, barW), dr.highlight ? mh : m);
          own.push(bar.geometry);
          put(bar, (x0 + x1) / 2, 0.3, lane);
        }
        if (dr.highlight) put(new THREE.Mesh(geo.star, mh), x1, 1.8, lane);
        else if (dr.turnover) { const r = new THREE.Mesh(geo.ring, m); r.rotation.x = Math.PI / 2; put(r, x1, 0.5, lane); }
        else { const cone = new THREE.Mesh(new THREE.ConeGeometry(0.8, 1.6, 12), m); own.push(cone.geometry); cone.rotation.z = x1 >= x0 ? -Math.PI / 2 : Math.PI / 2; put(cone, x1, 0.5, lane); }
      }
      objs.forEach((o) => { if (!o.parent) scene.add(o); });
      objs.forEach((o) => { o.userData.i = e.i; pickable.push(o); });
      markers.push({ i: e.i, period: e.period, objs, atBat: dr.kind === "pitch" ? e.atBat : null });
    }

    // ---- time-order rail: every play without a location, ordered by game time along the near side ----
    const railZ = { nba: 29, nhl: 50, nfl: S.W / 2 + 3, epl: 38, mlb: 45 }[sport];
    const railX0 = sport === "mlb" ? -300 : -S.L * 0.48, railX1 = sport === "mlb" ? 300 : S.L * 0.48;
    const N = Math.max(1, data.events.length - 1);
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(railX0, 0.2, railZ), new THREE.Vector3(railX1, 0.2, railZ)]), new THREE.LineBasicMaterial({ color: 0x888888 })));
    const rail = [];
    for (const e of data.events) {
      if (e.cat !== "rail") continue;
      const b = new THREE.Mesh(geo.bead, mat.dimNeutral);
      b.position.set(railX0 + ((railX1 - railX0) * e.i) / N, unit * 0.6, railZ);
      b.userData.i = e.i;
      scene.add(b);
      pickable.push(b);
      rail.push({ i: e.i, period: e.period, obj: b, lit: e.side === "home" ? mat.home : e.side === "away" ? mat.away : mat.neutral, dim: e.side === "home" ? mat.dimHome : e.side === "away" ? mat.dimAway : mat.dimNeutral });
    }

    // ---- MLB: strike-zone board and base runners ----
    const runners = [];
    if (sport === "mlb") {
      if (data.events.some((e) => e.draw && e.draw.kind === "pitch")) {
        zoneGroup.add(new THREE.Mesh(new THREE.PlaneGeometry(90, 50), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, side: THREE.DoubleSide })));
        const zx = ((90 - 117.5) / 95) * 40, zx2 = ((145 - 117.5) / 95) * 40, zy = ((171.5 - 195) / 85) * 35, zy2 = ((171.5 - 148) / 85) * 35;
        zoneGroup.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([[zx, zy], [zx2, zy], [zx2, zy2], [zx, zy2]].map(([x, y]) => new THREE.Vector3(x, y, 0.3))), new THREE.LineBasicMaterial({ color: 0xffffff })));
      }
      const d90 = 90 / Math.SQRT2;
      [[d90, -d90], [0, -2 * d90], [-d90, -d90]].forEach(([x, z]) => { const r = new THREE.Mesh(geo.runner, mat.neutral); r.position.set(x, 5, z); r.visible = false; scene.add(r); runners.push(r); });
    }

    // ---- scoring-flow ribbon for games without any recorded positions ----
    let ribbon = null;
    if (!data.counts.real) {
      const k = { nba: 0.6, nhl: 7, nfl: 0.7, epl: 7, mlb: 9 }[sport], base = { nba: 16, nhl: 26, nfl: 18, epl: 18, mlb: 45 }[sport];
      const rz = sport === "mlb" ? -300 : 0;
      const pts = data.events.map((e) => new THREE.Vector3(railX0 + ((railX1 - railX0) * e.i) / N, base + (e.h - e.a) * k, rz));
      const g = new THREE.BufferGeometry().setFromPoints(pts);
      const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: css("--accent") || "#6da7ec" }));
      // filled band between the tied line and the running margin, so the flow reads at a glance
      const band = new THREE.BufferGeometry();
      const pos = [];
      for (let q = 1; q < pts.length; q++) {
        const a0 = pts[q - 1], a1 = pts[q];
        pos.push(a0.x, base, rz, a1.x, base, rz, a1.x, a0.y, rz, a0.x, base, rz, a1.x, a0.y, rz, a0.x, a0.y, rz); // step shape: margin holds until the next play
      }
      band.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      const bandMesh = new THREE.Mesh(band, new THREE.MeshBasicMaterial({ color: css("--accent") || "#6da7ec", transparent: true, opacity: 0.45, side: THREE.DoubleSide }));
      scene.add(bandMesh);
      const zero = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(railX0, base, rz), new THREE.Vector3(railX1, base, rz)]), new THREE.LineBasicMaterial({ color: 0x999999, transparent: true, opacity: 0.6 }));
      const head = new THREE.Mesh(geo.runner, mat.neutral);
      head.scale.setScalar(sport === "mlb" ? 1.5 : unit / 5 * 2);
      scene.add(line, zero, head);
      ribbon = { g, pts, head, band };
    }

    let raf = 0, pulseI = -1, alive = true;
    const clock = new THREE.Clock();
    function frame() {
      if (!alive) return;
      raf = requestAnimationFrame(frame);
      controls.update();
      const t = clock.getElapsedTime();
      for (const mk of markers) {
        const s = mk.i === pulseI && !reducedMotion() ? 1 + 0.35 * Math.abs(Math.sin(t * 4)) : 1;
        for (const o of mk.objs) if (o.isMesh && o.geometry !== undefined && !o.geometry.type.startsWith("Box") && !o.geometry.type.startsWith("Tube")) o.scale.setScalar(s);
      }
      renderer.render(scene, camera);
    }
    frame();

    // click or tap a marker or rail bead to read that play (a drag rotates instead)
    const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
    let downAt = null;
    const onDown = (ev) => { downAt = [ev.clientX, ev.clientY]; };
    const onUp = (ev) => {
      if (!downAt || Math.hypot(ev.clientX - downAt[0], ev.clientY - downAt[1]) > 6) return;
      const r = renderer.domElement.getBoundingClientRect();
      ptr.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ptr, camera);
      const hit = ray.intersectObjects(pickable.filter((o) => o.visible), false)[0];
      if (hit && onPick) onPick(hit.object.userData.i);
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);

    const ro = new ResizeObserver(() => {
      const w = mount.clientWidth, h = mount.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      home = homeFor(w / h);
    });
    ro.observe(mount);
    const onTheme = () => bg();
    document.addEventListener("themechange", onTheme);
    const mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
    if (mq && mq.addEventListener) mq.addEventListener("change", onTheme);

    return {
      markers,
      setVisible(step, period, cur) {
        const ab = cur && cur.atBat;
        for (const mk of markers) {
          let v = mk.i <= step && (!period || mk.period === period);
          if (mk.atBat) v = v && mk.atBat === ab; // pitches: only the at-bat in progress
          mk.objs.forEach((o) => { o.visible = v; });
        }
        for (const r of rail) { r.obj.visible = !period || r.period === period; r.obj.material = r.i <= step ? r.lit : r.dim; r.obj.scale.setScalar(r.i === step ? 1.8 : 1); }
        if (runners.length) {
          const rs = (cur && cur.runners) || [false, false, false];
          const rm = cur && cur.side === "home" ? mat.home : cur && cur.side === "away" ? mat.away : mat.neutral;
          runners.forEach((o, k) => { o.visible = !!rs[k]; o.material = rm; });
        }
        if (ribbon) { ribbon.g.setDrawRange(0, step + 1); ribbon.band.setDrawRange(0, step * 6); ribbon.head.position.copy(ribbon.pts[Math.min(step, ribbon.pts.length - 1)]); }
      },
      setPulse(i) { pulseI = i; },
      resetView() { camera.position.copy(home); controls.target.copy(target); controls.update(); },
      dispose() {
        alive = false;
        cancelAnimationFrame(raf);
        ro.disconnect();
        document.removeEventListener("themechange", onTheme);
        if (mq && mq.removeEventListener) mq.removeEventListener("change", onTheme);
        controls.dispose();
        scene.traverse((o) => {
          if (o.geometry) o.geometry.dispose();
          const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
          ms.forEach((mm) => { if (mm.map) mm.map.dispose(); mm.dispose(); });
        });
        own.forEach((g) => g.dispose());
        renderer.dispose();
        if (renderer.forceContextLoss) renderer.forceContextLoss();
        renderer.domElement.remove();
      },
    };
  }

  // ---------------- MLB strike-zone inset (SVG, 2D) ----------------
  function strikeZone(box, events, step) {
    box.textContent = "";
    const cur = events[Math.min(step, events.length - 1)];
    const ab = cur && cur.atBat;
    const pitches = events.filter((e) => e.i <= step && e.pitch && ab && e.atBat === ab);
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "25 90 200 175");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Pitch locations for the current at-bat");
    const zone = document.createElementNS(NS, "rect");
    zone.setAttribute("x", 90); zone.setAttribute("y", 148); zone.setAttribute("width", 55); zone.setAttribute("height", 47);
    zone.setAttribute("class", "sz-zone");
    svg.appendChild(zone);
    pitches.forEach((e, k) => {
      const c = document.createElementNS(NS, "circle");
      c.setAttribute("cx", e.pitch.x); c.setAttribute("cy", e.pitch.y); c.setAttribute("r", 7);
      const t = e.pitch.type;
      c.setAttribute("class", /ball|pitchout|intent/.test(t) ? "sz-ball" : /strike|foul/.test(t) ? "sz-strike" : "sz-play");
      svg.appendChild(c);
      const n = document.createElementNS(NS, "text");
      n.setAttribute("x", e.pitch.x); n.setAttribute("y", e.pitch.y + 3); n.setAttribute("text-anchor", "middle"); n.setAttribute("class", "sz-num");
      n.textContent = String(k + 1);
      svg.appendChild(n);
    });
    box.appendChild(el("div", "sz-title", "Pitches this at-bat" + (pitches.length ? "" : ": none yet")));
    box.appendChild(svg);
    const last = pitches[pitches.length - 1];
    if (last && (last.pitch.name || last.pitch.mph)) box.appendChild(el("div", "sz-cap", "Last pitch: " + [last.pitch.name, last.pitch.mph ? last.pitch.mph + " mph" : ""].filter(Boolean).join(" ")));
    box.appendChild(el("div", "sz-key", "green = ball · orange = strike or foul · blue = in play. Numbers are pitch order; the box is an approximate zone."));
  }

  // ---------------- public: open a replay into a container ----------------
  async function open(container, sport, eventId, opts) {
    opts = opts || {};
    container.textContent = "";
    const wrap = el("div", "replay");
    container.appendChild(wrap);
    wrap.appendChild(el("p", "muted small replay-note", "Reconstructed from ESPN play-by-play locations (not video or player tracking). Loading…"));
    let data;
    try {
      const r = await fetch(ESPN + LEAGUE[sport] + "/summary?event=" + encodeURIComponent(eventId), { cache: "no-store" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      data = parse(sport, await r.json());
    } catch (e) {
      wrap.textContent = "";
      wrap.appendChild(el("p", "muted", "3D replay unavailable: ESPN play-by-play could not be loaded (" + e.message + ")."));
      return { close() {} };
    }
    wrap.textContent = "";
    if (!data.events.length) {
      wrap.appendChild(el("p", "muted", "No play-by-play has been published for this game yet."));
      return { close() {} };
    }

    // toolbar
    const bar = el("div", "replay-bar");
    const play = el("button", "btn", "▶ Play");
    play.type = "button";
    const speed = el("select");
    speed.setAttribute("aria-label", "Replay speed");
    [["1", "1×"], ["2", "2×"], ["4", "4×"], ["10", "10×"]].forEach(([v, t]) => { const o = el("option", null, t); o.value = v; speed.appendChild(o); });
    const range = el("input");
    range.type = "range"; range.min = "0"; range.max = String(data.events.length - 1); range.value = range.max;
    range.setAttribute("aria-label", "Replay position (play number)");
    const per = el("select");
    per.setAttribute("aria-label", "Period filter");
    const periods = [];
    data.events.forEach((e) => { if (e.period != null && !periods.some((p) => p[0] === e.period)) periods.push([e.period, e.plabel.replace(/^(Top|Bottom) /, "")]); });
    const allLbl = sport === "mlb" ? "All innings" : sport === "epl" ? "Both halves" : sport === "nhl" ? "All periods" : "All quarters";
    [["", allLbl]].concat(periods.map(([n, l]) => [String(n), l])).forEach(([v, t]) => { const o = el("option", null, t); o.value = v; per.appendChild(o); });
    const reset = el("button", "btn ghost", "Reset view");
    reset.type = "button";
    bar.append(play, speed, range, per, reset);
    wrap.appendChild(bar);

    const board = el("div", "replay-board");
    const score = el("div", "replay-score");
    const caption = el("div", "replay-caption");
    caption.setAttribute("aria-live", "polite");
    board.append(score, caption);
    wrap.appendChild(board);

    const stage = el("div", "replay-stage");
    const mount = el("div", "replay-canvas");
    stage.appendChild(mount);
    let szBox = null;
    if (sport === "mlb" && data.events.some((e) => e.pitch)) { szBox = el("div", "replay-sz"); stage.appendChild(szBox); }
    wrap.appendChild(stage);

    const colors = teamColors({ home: data.teams.home, away: data.teams.away }, SURFACE[sport].base);
    const legend = el("div", "replay-legend small");
    const sw = (c, t) => { const s = el("span", "lg-item"); const d = el("i", "lg-dot"); d.style.background = c; s.append(d, document.createTextNode(t)); return s; };
    legend.append(sw(colors.away, data.teams.away.abbr + " (away)"), sw(colors.home, data.teams.home.abbr + " (home)"));
    const shapes = {
      nba: "Filled ball = made shot (with its arc to the rim) · ring = missed shot · home shoots at the right basket, away at the left.",
      nhl: "Star = goal · filled ball = shot on goal · ring = missed or blocked shot · positions are real rink spots; teams switch ends each period.",
      mlb: "Arc = batted ball from home plate to where ESPN charted it (height from ground ball / line drive / fly ball) · filled ball = hit · ring = out · star = home run.",
      nfl: "Each drive is one lane across the field; bars are plays from snap spot to where they ended · arrow = drive continues · star = scoring play · ring = turnover.",
      epl: "Lines run from where each shot was struck to where it ended · star with thick line = goal · filled ball = on target · ring = off target or blocked.",
    }[sport];
    legend.appendChild(el("span", "lg-shapes", shapes));
    const extra = {
      nba: "Flat disc = rebound, foul or turnover at its recorded spot · post = free throw on the free-throw line (sphere on top = made) or jump ball at center.",
      nhl: "Flat disc = hit, faceoff, giveaway, takeaway or penalty at its recorded rink spot.",
      mlb: "Board behind home plate = pitch locations for the at-bat in progress (green ball, orange strike or foul, blue in play) · large spheres on the bases = runners at that moment · post at home plate = strikeout or walk with no pitch location.",
      nfl: "Post = play with no yardage change (incompletion, penalty, kneel) at its line of scrimmage · faded post = position carried from the previous play because ESPN gave no yard line.",
      epl: "Flat disc = foul, corner, offside or other event at its recorded spot · post = penalty on the penalty spot or kickoff at the center spot.",
    }[sport];
    legend.appendChild(el("span", "lg-shapes", extra));
    legend.appendChild(el("span", "lg-shapes", "Beads on the grey line along the near side = plays with no location, placed in game-time order from left (start) to right (end). The rail is time order, not a field position; beads light up as playback reaches them. Click any marker or bead to read that play." +
      (data.counts.real ? "" : " The raised band above the " + (sport === "epl" ? "pitch" : sport === "nhl" ? "rink" : sport === "nba" ? "court" : "field") + " is the scoring flow: its height is the home lead (above the grey tied line) or the away lead (below), in the same time order.")));
    wrap.appendChild(legend);
    const C = data.counts;
    wrap.appendChild(el("p", "muted small replay-note", "Reconstructed from ESPN play-by-play (not video or player tracking). All " + data.events.length + " plays are shown: " +
      C.real + " at real recorded positions, " + (C.fixed + C.carried) + " on fixed rule spots" + (C.carried ? " (including " + C.carried + " carried from the previous play)" : "") + ", and " + C.rail + " on the time-order rail."));
    if (!C.real) {
      const why = {
        nba: "ESPN published this game's plays without shot locations",
        nhl: "ESPN published this game's plays without rink locations",
        mlb: "ESPN published this game's plays without batted-ball locations",
        nfl: "ESPN published this game's plays without yard-line positions",
        epl: "ESPN published this match's commentary without shot positions",
      }[sport];
      wrap.appendChild(el("p", "replay-empty", why + " (yet, if the game is in progress), so no play sits at a real position. The view shows every play on the time-order rail and the scoring flow above the surface instead."));
    }

    // accessible list
    const det = el("details", "data-table replay-list");
    det.appendChild(el("summary", null, "Play-by-play list (" + data.events.length + " plays)"));
    const tw = el("div", "table-wrap");
    tw.style.maxHeight = "320px"; tw.style.overflow = "auto";
    det.appendChild(tw);
    const fillList = () => {
      tw.textContent = "";
      const t = el("table");
      const hr = t.createTHead().insertRow();
      ["#", sport === "mlb" ? "Inning" : "Period", "Clock", "Team", "Play", "Score", "Shown as"].forEach((h) => hr.appendChild(el("th", null, h)));
      const tb = t.createTBody();
      data.events.forEach((e) => {
        const r = tb.insertRow();
        [e.i + 1, e.plabel, e.clock || "", e.side ? data.teams[e.side].abbr : "", e.text, data.teams.away.abbr + " " + e.a + " – " + data.teams.home.abbr + " " + e.h, { real: "real position", fixed: "fixed spot", carried: "carried spot", rail: "time rail" }[e.cat]].forEach((v, k) => {
          const c = r.insertCell(); c.textContent = v; if (k === 4) { c.style.whiteSpace = "normal"; c.style.textAlign = "left"; c.style.minWidth = "16rem"; }
        });
      });
      tw.appendChild(t);
    };
    det.addEventListener("toggle", () => { if (det.open && !tw.firstChild) fillList(); });
    wrap.appendChild(det);


    let three = null;
    try {
      const L = await loadThree();
      three = buildScene(L, sport, data, colors, mount, (i) => showPick(i));
    } catch (e) {
      mount.appendChild(el("p", "muted", "3D view unavailable in this browser (" + (e && e.message ? e.message : "WebGL or the 3D library could not load") + "). The play list below still has every play."));
    }

    let step = data.events.length - 1, timer = null, alive = true;
    function showPick(i) {
      const e = data.events[i];
      if (!e) return;
      caption.textContent = "Selected play " + (i + 1) + ": " + [e.plabel, e.clock, e.side ? data.teams[e.side].abbr : "", e.text].filter(Boolean).join(" · ");
      if (three) three.setPulse(i);
    }
    function render() {
      const e = data.events[step];
      const pf = per.value ? Number(per.value) : null;
      if (three) { three.setVisible(step, pf, e); three.setPulse(e.i); }
      score.textContent = data.teams.away.abbr + " " + e.a + "  –  " + e.h + " " + data.teams.home.abbr;
      caption.textContent = [e.plabel, e.clock, e.text].filter(Boolean).join(" · ");
      range.value = String(step);
      if (szBox) strikeZone(szBox, data.events, step);
    }
    function stop() { clearInterval(timer); timer = null; play.textContent = "▶ Play"; }
    play.addEventListener("click", () => {
      if (timer) { stop(); return; }
      if (step >= data.events.length - 1) step = 0;
      play.textContent = "❚❚ Pause";
      const tickMs = () => 250 / Number(speed.value);
      const go = () => {
        if (step >= data.events.length - 1) { stop(); return; }
        step++;
        render();
        timer = setTimeout(go, tickMs());
      };
      render();
      timer = setTimeout(go, tickMs());
    });
    range.addEventListener("input", () => { step = Number(range.value); render(); });
    per.addEventListener("change", render);
    reset.addEventListener("click", () => { if (three) three.resetView(); });
    render();

    // live games: refresh the play-by-play every 60 s while open
    let liveTimer = null;
    if (opts.live) {
      liveTimer = setInterval(async () => {
        if (!alive || timer) return;
        try {
          const r = await fetch(ESPN + LEAGUE[sport] + "/summary?event=" + encodeURIComponent(eventId), { cache: "no-store" });
          if (!r.ok) return;
          const fresh = parse(sport, await r.json());
          if (!alive || fresh.events.length === data.events.length) return;
          const atEnd = step >= data.events.length - 1;
          data = fresh;
          range.max = String(data.events.length - 1);
          if (three) { three.dispose(); three = buildScene(await loadThree(), sport, data, colors, mount, (i) => showPick(i)); }
          if (atEnd) step = data.events.length - 1;
          if (det.open) fillList(); else tw.textContent = "";
          render();
        } catch (e) { /* keep the current view */ }
      }, 60 * 1000);
    }

    return {
      close() {
        alive = false;
        stop();
        clearInterval(liveTimer);
        if (three) three.dispose();
        three = null;
      },
    };
  }

  window.Replay3D = { open, _parse: parse, _teamColors: teamColors };

  // Debug/testing only: dashboard.html?replayTest=nba:401859967 opens that game's replay directly.
  document.addEventListener("DOMContentLoaded", () => {
    const q = new URLSearchParams(location.search).get("replayTest");
    if (!q || !window.Site || !window.Site.showGame) return;
    const [sp, id] = q.split(":");
    if (!LEAGUE[sp] || !/^\d+$/.test(id || "")) return;
    const box = document.createElement("div");
    window.Site.showGame({ title: "3D replay", subtitle: sp.toUpperCase() + " · ESPN game " + id, node: box });
    open(box, sp, id, {}).then((ctl) => { if (window.Site.onGameClose) window.Site.onGameClose(() => ctl.close()); });
  });
})();
