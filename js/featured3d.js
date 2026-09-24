/* Dashboard "3D game replay" section: always shows a 3D replay on the page, without clicking.
   For the selected sport it finds the most recent finished games on ESPN's public scoreboard
   (today and earlier; for a sport in its offseason it searches back to its last games),
   opens the newest one with Replay3D and lets the viewer switch between recent games. */
(function () {
  "use strict";
  const ESPN = "https://site.api.espn.com/apis/site/v2/sports/";
  const LEAGUE = { nfl: "football/nfl", nba: "basketball/nba", mlb: "baseball/mlb", nhl: "hockey/nhl", epl: "soccer/eng.1" };
  const $ = (id) => document.getElementById(id);
  const cache = {};
  let token = 0, ctl = null;

  function ymd(d) { return d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0"); }
  async function board(sport, day) {
    const r = await fetch(ESPN + LEAGUE[sport] + "/scoreboard?dates=" + ymd(day), { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const d = await r.json();
    return (d.events || []).filter((e) => e.status && e.status.type && e.status.type.state === "post").map((e) => ({
      id: e.id, date: e.date, name: e.shortName || e.name,
      score: ((e.competitions || [])[0] || { competitors: [] }).competitors
        .slice().sort((a, b) => (a.homeAway === "away" ? -1 : 1) - (b.homeAway === "away" ? -1 : 1))
        .map((c) => (c.team ? c.team.abbreviation : "?") + " " + (c.score != null ? c.score : "")).join(" – "),
    }));
  }
  // Newest finished games: days 0..-13 one by one, then every 3rd day back to ~5 months (offseason).
  async function recentFinals(sport) {
    if (cache[sport]) return cache[sport];
    const today = new Date();
    const days = [];
    for (let k = 0; k < 14; k++) days.push(k);
    for (let k = 14; k <= 160; k += 3) days.push(k);
    let found = [];
    for (let i = 0; i < days.length && found.length < 8; i += 7) {
      const batch = days.slice(i, i + 7).map((k) => { const d = new Date(today); d.setDate(today.getDate() - k); return d; });
      const res = await Promise.all(batch.map((d) => board(sport, d).catch(() => [])));
      res.forEach((list) => { found = found.concat(list); });
    }
    const seen = new Set();
    found = found.filter((g) => (seen.has(g.id) ? false : (seen.add(g.id), true)))
      .sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 15);
    cache[sport] = found;
    return found;
  }

  async function openGame(sport, id) {
    const box = $("f3d-view");
    if (ctl && ctl.close) { try { ctl.close(); } catch (e) { /* ignore */ } }
    ctl = null;
    if (!window.Replay3D) { box.textContent = "3D replay unavailable: the replay script did not load."; return; }
    ctl = await window.Replay3D.open(box, sport, id, {});
  }

  async function show(sport) {
    const my = ++token;
    const box = $("f3d-view"), sel = $("f3d-game"), note = $("f3d-note");
    if (!box) return;
    if (ctl && ctl.close) { try { ctl.close(); } catch (e) { /* ignore */ } }
    ctl = null;
    sel.textContent = "";
    box.textContent = "Finding the latest finished " + window.Site.SPORTS[sport].name + " games…";
    let games = [];
    try { games = await recentFinals(sport); } catch (e) { games = []; }
    if (my !== token) return;
    if (!games.length) {
      box.textContent = "No finished " + window.Site.SPORTS[sport].name + " games found on ESPN in the last five months, or ESPN could not be reached.";
      note.textContent = "";
      return;
    }
    games.forEach((g) => {
      const o = document.createElement("option");
      o.value = g.id;
      o.textContent = new Date(g.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) + " · " + g.score;
      sel.appendChild(o);
    });
    note.textContent = games.length + " recent finished games. Pick one, then drag to rotate, scroll or pinch to zoom, and press Play to watch it unfold.";
    await openGame(sport, games[0].id);
  }

  document.addEventListener("DOMContentLoaded", function () {
    const sel = $("f3d-game");
    if (sel) sel.addEventListener("change", () => {
      const sport = (location.hash || "#nfl").slice(1);
      openGame(window.Site.SPORTS[sport] ? sport : "nfl", sel.value);
    });
  });

  window.Featured3D = { show };
})();
