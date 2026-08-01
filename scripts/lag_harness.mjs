// Re-creation of the synthetic-game harness V2.md asks for whenever mlbLag is
// touched. Builds a game with a KNOWN lead, checks estimateLag recovers it and
// still refuses to guess on noise.
import { estimateLag } from "file:///c:/Users/slsks/OneDrive/Desktop/Polymarket%20web%20app/frontend/src/mlbLag.js";

const T0 = 1_750_000_000_000;

// A game where the market starts reacting `leadS` seconds before each play
// stamp and bleeds in over ~6s, sampled at 1s like real live MLB markets.
function game(leadS, nPlays = 12, moveCents = 6) {
  const plays = [];
  const ticks = [];
  let price = 50;
  for (let i = 0; i < 600; i++) ticks.push({ ts: T0 + i * 1000, home: price, away: 100 - price });
  for (let p = 0; p < nPlays; p++) {
    const stamp = T0 + (30 + p * 40) * 1000;
    plays.push({ start: stamp - 12_000, end: stamp });
    const begin = stamp - leadS * 1000;
    for (let s = 0; s < 6; s++) {
      const idx = ticks.findIndex((t) => t.ts === begin + s * 1000);
      if (idx < 0) continue;
      price += moveCents / 6;
      for (let j = idx; j < ticks.length; j++) {
        ticks[j] = { ...ticks[j], home: price, away: 100 - price };
      }
    }
  }
  return { ticks, plays };
}

let pass = 0, fail = 0;
const check = (name, got, want, tol) => {
  const ok = Math.abs(got - want) <= tol;
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}: got ${got}, want ~${want} (+/-${tol})`);
};

console.log("recovers a known lead:");
for (const lead of [0, 5, 8, 12]) {
  const { ticks, plays } = game(lead);
  const r = estimateLag(ticks, plays, ["home", "away"]);
  if (!r) { fail++; console.log(`  FAIL  lead=${lead}s -> returned null`); continue; }
  check(`lead=${lead}s leadMs`, Math.round(r.leadMs / 1000), lead, 2);
}

console.log("\nreturn shape is exactly {lagMs, leadMs, samples}:");
const { ticks, plays } = game(8);
const r = estimateLag(ticks, plays, ["home", "away"]);
const keys = Object.keys(r).sort().join(",");
const wantKeys = "lagMs,leadMs,samples";
keys === wantKeys ? pass++ : fail++;
console.log(`  ${keys === wantKeys ? "PASS" : "FAIL"}  keys = ${keys}`);
console.log(`  values: lagMs=${r.lagMs} leadMs=${r.leadMs} samples=${r.samples}`);

console.log("\nrefuses to guess when there is nothing to measure:");
const flat = { ticks: [], plays: [] };
for (const [name, args] of [
  ["no ticks", [[], plays, ["home", "away"]]],
  ["no plays", [ticks, [], ["home", "away"]]],
  ["no outcomes", [ticks, plays, []]],
  ["flat prices", [Array.from({ length: 600 }, (_, i) => ({ ts: T0 + i * 1000, home: 50, away: 50 })), plays, ["home", "away"]]],
]) {
  const out = estimateLag(...args);
  out === null ? pass++ : fail++;
  console.log(`  ${out === null ? "PASS" : "FAIL"}  ${name} -> ${JSON.stringify(out)}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
