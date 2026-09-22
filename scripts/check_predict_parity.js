// Checks that js/predict.js reproduces the Python model exactly.
// Usage: node scripts/check_predict_parity.js
// For each sport with a model_<sport>.json it replays:
//   parity_samples: holdout feature vectors -> probabilities / margin / total
//   state_samples:  team codes + date (+ starter)  -> the full Predict.game() path
// and fails if any value differs by more than 1e-6.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
globalThis.window = globalThis;
require(path.join(root, "js", "predict.js"));
const P = globalThis.Predict;

const TOL = 1e-6;
let worst = 0, checked = 0, failed = 0;

for (const sport of ["nfl", "nba", "mlb", "nhl", "epl"]) {
  const mp = path.join(root, `model_${sport}.json`);
  const bp = path.join(root, `backtest_${sport}.json`);
  if (!fs.existsSync(mp) || !fs.existsSync(bp)) { console.log(`${sport}: no model, skipped`); continue; }
  const model = JSON.parse(fs.readFileSync(mp, "utf8"));
  const bt = JSON.parse(fs.readFileSync(bp, "utf8"));
  let sw = 0;
  const cmp = (got, exp, label) => {
    for (const k of Object.keys(exp)) {
      const d = Math.abs(got[k] - exp[k]);
      if (!(d <= TOL)) { failed++; console.log(`  FAIL ${sport} ${label} ${k}: js ${got[k]} vs py ${exp[k]}`); }
      sw = Math.max(sw, d || 0);
      checked++;
    }
  };
  bt.parity_samples.forEach((s, i) => cmp(P.fromFeatures(sport, model, s.features), s.expected, `parity#${i}`));
  bt.state_samples.forEach((s, i) => {
    const g = P.game(sport, model, { home: s.home, away: s.away, date: s.date, neutral: s.neutral,
      homeStarter: s.homeStarter, awayStarter: s.awayStarter });
    const got = sport === "epl" ? { pH: g.pHome, pD: g.pDraw, pA: g.pAway, margin: g.margin, total: g.total }
      : { pH: g.pHome, margin: g.margin, total: g.total };
    cmp(got, s.expected, `state#${i}`);
  });
  worst = Math.max(worst, sw);
  console.log(`${sport}: ${bt.parity_samples.length} feature samples + ${bt.state_samples.length} state samples, max |diff| ${sw.toExponential(2)}`);
}
console.log(`checked ${checked} values, max |diff| ${worst.toExponential(2)}, ${failed} failures`);
process.exit(failed ? 1 : 0);
