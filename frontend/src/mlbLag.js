// MLB's Stats API records a play a few seconds AFTER it happened on the field
// (scorer entry + feed propagation), while the market reacts the instant the
// play is seen. So a price move at time T is caused by a play the feed stamps
// at roughly T + lag.
//
// We can't close that gap, but we can measure it: cross-correlate the biggest
// price moves against the play timestamps for THIS game and take the shift that
// lines them up best. The chart then shifts the timeline back by that lag, so
// hovering a price move shows the play that actually caused it.

const MIN_MOVE_CENTS = 0.5;  // ignore noise ticks
const MAX_LAG_MS = 25_000;   // search 0..25s of feed delay
const STEP_MS = 500;         // resolution of the estimate
const WINDOW_MS = 2_500;     // how long a reaction takes to show in the price
const BUCKET_MS = 250;       // resolution of the price-movement histogram
const MIN_MOVES = 6;         // too few moves to say anything
const MIN_CONFIDENCE = 1.15; // best shift must beat the average shift by this

// Total absolute price movement per time bucket, as a prefix sum so any window
// can be summed in O(1).
function movementHistogram(ticks, keys) {
  const moves = [];
  const prev = {};
  for (const t of ticks) {
    let delta = 0;
    for (const k of keys) {
      const v = t[k];
      if (v == null) continue;
      if (prev[k] != null) delta += Math.abs(v - prev[k]);
      prev[k] = v;
    }
    if (delta >= MIN_MOVE_CENTS) moves.push({ ts: t.ts, delta });
  }
  if (moves.length < MIN_MOVES) return null;

  const t0 = ticks[0].ts;
  const t1 = ticks[ticks.length - 1].ts;
  const n = Math.max(1, Math.ceil((t1 - t0) / BUCKET_MS) + 1);
  const bins = new Float64Array(n + 1);
  for (const m of moves) {
    const i = Math.floor((m.ts - t0) / BUCKET_MS);
    if (i >= 0 && i < n) bins[i] += m.delta;
  }
  const prefix = new Float64Array(n + 2);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + bins[i];
  return { t0, n, prefix, count: moves.length };
}

// Sum of price movement in [from, from + WINDOW_MS).
function windowSum(h, from) {
  const a = Math.floor((from - h.t0) / BUCKET_MS);
  const b = Math.floor((from + WINDOW_MS - h.t0) / BUCKET_MS);
  const lo = Math.min(Math.max(a, 0), h.n);
  const hi = Math.min(Math.max(b, 0), h.n);
  return h.prefix[hi] - h.prefix[lo];
}

/**
 * Estimate the feed lag for one game.
 * @returns {{lagMs:number, confidence:number, moves:number}|null}
 *          null when there isn't enough signal to say.
 */
export function estimateLag(ticks, plays, outcomes) {
  if (!ticks?.length || !plays?.length || !outcomes?.length) return null;
  const h = movementHistogram(ticks, outcomes);
  if (!h) return null;

  // Only plays that overlap the price history can tell us anything.
  const from = ticks[0].ts;
  const to = ticks[ticks.length - 1].ts;
  const usable = plays.filter((p) => p.end >= from && p.end <= to + MAX_LAG_MS);
  if (usable.length < 4) return null;

  let best = { lag: 0, score: -1 };
  let total = 0;
  let steps = 0;
  for (let lag = 0; lag <= MAX_LAG_MS; lag += STEP_MS) {
    let score = 0;
    // a play stamped at p.end was really seen by the market at p.end - lag
    for (const p of usable) score += windowSum(h, p.end - lag);
    total += score;
    steps++;
    if (score > best.score) best = { lag, score };
  }

  const mean = steps ? total / steps : 0;
  const confidence = mean > 0 ? best.score / mean : 0;
  if (confidence < MIN_CONFIDENCE) return null; // no clear alignment — don't guess
  return { lagMs: best.lag, confidence, moves: h.count };
}
