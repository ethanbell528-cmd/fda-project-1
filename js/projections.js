/* Dashboard "Player projections" table.
   Reads the featured players stored in model_<sport>.json (via Predict.load /
   Predict.players) and shows every projection with how it was built.
   Formula (from the model file): projection = w * last-n average
   + (1 - w) * base-window average * usage adjustment, with w = n / (n + 5). */
(function () {
  "use strict";
  const S = window.Site;
  const $ = (id) => document.getElementById(id);

  const LABEL = {
    pts: "Points", reb: "Rebounds", ast: "Assists",
    pass_yds: "Pass yds", pass_td: "Pass TD", int: "INT", rush_yds: "Rush yds", rush_td: "Rush TD",
    rec: "Receptions", rec_yds: "Rec yds", rec_td: "Rec TD",
    h: "Hits", hr: "HR", rbi: "RBI", sb: "SB", ip: "Innings", k_p: "Strikeouts", er: "Earned runs",
    goals: "Goals", assists: "Assists", points: "Points", save_pct: "Save %",
  };
  const ROLE_LABEL = { all: "All players", QB: "Quarterbacks", RB: "Running backs", "WR/TE": "Receivers (WR/TE)",
    batter: "Batters", pitcher: "Pitchers", skater: "Skaters", goalie: "Goalies" };

  let sport = null, model = null, token = 0;

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function fmtStat(k, v) {
    if (v == null || !Number.isFinite(v)) return "n/a";
    if (k === "save_pct") return v.toFixed(3);
    return v.toFixed(Math.abs(v) >= 10 ? 1 : 2);
  }

  function allRows() {
    const rows = [];
    const names = {};
    try { window.Predict.teamCodes(model).forEach((t) => { names[t.code] = t.name; }); } catch (e) { /* codes only */ }
    Object.keys(model.players || {}).sort().forEach((code) => {
      window.Predict.players(sport, model, code).forEach((p, i) => {
        const raw = model.players[code][i] || {};
        rows.push({ team: code, teamName: names[code] || code, player: p.player, position: p.position, role: p.role || raw.role || "all",
          stats: p.stats, n: raw.games_last, w: raw.w, u: raw.usage_adj });
      });
    });
    return rows;
  }

  function fillSelect(sel, pairs, keep) {
    const prev = keep ? sel.value : "";
    sel.textContent = "";
    pairs.forEach(([v, t]) => { const o = el("option", null, t); o.value = v; sel.appendChild(o); });
    if (prev && pairs.some(([v]) => v === prev)) sel.value = prev;
  }

  function openPlayer(r) {
    const rows = Object.keys(r.stats).map((k) => [LABEL[k] || k, fmtStat(k, r.stats[k])]);
    rows.push(["Recent games used (n)", r.n == null ? "n/a" : String(r.n)]);
    rows.push(["Recent weight w = n ÷ (n + 5)", r.w == null ? "n/a" : r.w.toFixed(2)]);
    rows.push(["Usage adjustment u", r.u == null ? "n/a" : "×" + r.u.toFixed(2)]);
    S.showPlayer({
      title: r.player,
      subtitle: [r.position, r.teamName && r.teamName !== r.team ? r.teamName + " (" + r.team + ")" : r.team, S.SPORTS[sport].name].filter(Boolean).join(" · "),
      headers: ["Projection per game", "Value"],
      rows,
      notes: [
        "Projection = w × average of the last n games (n ≤ 10) + (1 − w) × base-season average × u. " +
        "The base window is the reference season (" + model.player_reference_season + ") plus the season before. " +
        "u compares recent playing time with the base window, clipped to 0.5–1.5.",
        "Sportsbook lines for this player appear on the game cards above when the player has an upcoming game with posted lines.",
      ],
    });
  }

  function render() {
    const box = $("proj-table");
    if (!model) return;
    const rows = allRows();
    const team = $("p-team").value, role = $("p-role").value, q = $("p-search").value.trim().toLowerCase();
    const view = rows.filter((r) => (!team || r.team === team) && (!role || r.role === role) && (!q || r.player.toLowerCase().includes(q)));
    // stat columns: union over the visible roles, in the order they first appear
    const cols = [];
    view.forEach((r) => Object.keys(r.stats).forEach((k) => { if (!cols.includes(k)) cols.push(k); }));
    const sortKey = cols[0];
    view.sort((a, b) => ((b.stats[sortKey] ?? -1) - (a.stats[sortKey] ?? -1)) || a.player.localeCompare(b.player));

    const headers = ["Player", "Team", "Pos"].concat(cols.map((k) => LABEL[k] || k));
    const body = view.map((r) => [r.player, r.team, r.position || ""]
      .concat(cols.map((k) => (k in r.stats ? fmtStat(k, r.stats[k]) : "–"))));
    S.renderTable(box, headers, body);
    // player names become buttons that open that player's detail pop-up
    box.querySelectorAll("tbody tr").forEach((tr, i) => {
      const r = view[i], cell = tr.cells[0];
      cell.textContent = "";
      const b = el("button", "link-btn", r.player);
      b.type = "button";
      b.setAttribute("aria-haspopup", "dialog");
      b.addEventListener("click", () => openPlayer(r));
      cell.appendChild(b);
    });
    $("proj-count").textContent = view.length + " player" + (view.length === 1 ? "" : "s") + " shown, sorted by " + (LABEL[sortKey] || sortKey || "name") + ". Values are per game.";
  }

  async function show(s) {
    sport = s;
    const my = ++token;
    const box = $("proj-table"), cap = $("proj-cap");
    if (!box) return;
    box.classList.add("stale");
    if (!window.Predict) { box.textContent = "Player projections unavailable: the model script did not load."; return; }
    try {
      const m = await window.Predict.load(s);
      if (my !== token) return;
      model = m;
    } catch (e) {
      if (my !== token) return;
      model = null;
      box.classList.remove("stale");
      box.textContent = "Player projections unavailable for " + S.SPORTS[s].name + ": " + e.message;
      return;
    }
    box.classList.remove("stale");
    const teams = Object.keys(model.players || {}).sort();
    let names = {};
    try { window.Predict.teamCodes(model).forEach((t) => { names[t.code] = t.name; }); } catch (e) { /* ignore */ }
    fillSelect($("p-team"), [["", "All teams"]].concat(teams.map((c) => [c, names[c] && names[c] !== c ? c + " · " + names[c] : c])), false);
    const roles = [];
    teams.forEach((c) => (model.players[c] || []).forEach((p) => { const r = p.role || "all"; if (!roles.includes(r)) roles.push(r); }));
    const rolePairs = roles.length > 1 ? [["", "All roles"]].concat(roles.map((r) => [r, ROLE_LABEL[r] || r])) : [["", ROLE_LABEL[roles[0]] || "All players"]];
    fillSelect($("p-role"), rolePairs, false);
    if (roles.length > 1) $("p-role").value = roles[0];
    $("p-search").value = "";
    cap.textContent = "Featured players per team from the " + S.SPORTS[s].name + " model, as of games through " +
      (model.trained_at || "the last pipeline run") + " (player stats reference season " + model.player_reference_season + "). " +
      "Projection = w × average of the last n games (n ≤ 10) + (1 − w) × base-season average × usage adjustment, with w = n ÷ (n + 5). " +
      "The usage adjustment compares recent playing time (minutes, touches, plate appearances or ice time) with the base window, clipped to 0.5–1.5.";
    render();
  }

  document.addEventListener("DOMContentLoaded", function () {
    ["p-team", "p-role"].forEach((id) => $(id) && $(id).addEventListener("change", render));
    const search = $("p-search");
    let t = null;
    if (search) search.addEventListener("input", () => { clearTimeout(t); t = setTimeout(render, 150); });
    const reset = $("p-reset");
    if (reset) reset.addEventListener("click", () => {
      $("p-team").value = ""; $("p-search").value = "";
      const r = $("p-role"); if (r.options.length > 1) r.selectedIndex = 1; else r.selectedIndex = 0;
      render();
    });
  });

  window.Projections = { show };
})();
