// MLB's Stats API stamps a play when the scorer finalises it, while the market
// reacts as the play happens. So a price move comes BEFORE the play appears in
// the feed, and we can measure by how much.
//
// A reaction is not an instant: on a scoring play the price bleeds in over
// ~10 seconds (ball hit → first run → second run → play recorded). Measuring
// against 1-second price data on a real game showed the reaction starting ~13s
// before MLB's stamp and finishing ~2s before it. So we report two numbers:
//
//   lagMs  — the typical (median) offset, used to shift the chart's game state
//   leadMs — how early the reaction STARTS on the biggest moves
//
// Method: group consecutive price moves into "reactions", match each to the
// play whose stamp it sits nearest, and take the distribution of offsets. This
// is simpler and more interpretable than a blind cross-correlation, and the
// 1s sampling on live MLB games makes it accurate.

const MIN_MOVE_CENTS = 1.0;    // below this is quantisation noise
const GAP_MS = 4_000;          // moves this close belong to one reaction
const MATCH_BEFORE_MS = 30_000; // a price may lead the stamp by at most this
const MATCH_AFTER_MS = 8_000;   // ...or trail it slightly
const MIN_SAMPLES = 5;          // fewer matched reactions than this: don't guess

const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const percentile = (xs, p) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};

// Consecutive price movement grouped into one reaction per burst.
function reactions(ticks, keys) {
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
  const out = [];
  for (const m of moves) {
    const last = out[out.length - 1];
    if (last && m.ts - last.end <= GAP_MS) {
      last.end = m.ts;
      last.total += m.delta;
      last.weighted += m.ts * m.delta;
    } else {
      out.push({ start: m.ts, end: m.ts, total: m.delta, weighted: m.ts * m.delta });
    }
  }
  // centroid = where the bulk of the money actually moved
  return out.map((r) => ({ ...r, centre: r.weighted / r.total }));
}

// Nearest play stamp to a moment, by binary search over sorted end times.
function nearestIndex(ends, ts) {
  let lo = 0, hi = ends.length - 1, best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (best < 0 || Math.abs(ends[mid] - ts) < Math.abs(ends[best] - ts)) best = mid;
    if (ends[mid] < ts) lo = mid + 1; else hi = mid - 1;
  }
  return best;
}

/**
 * Attribute price moves to the plays that caused them.
 *
 * Each burst of price movement is matched to the play whose stamp it sits
 * nearest (the market moves BEFORE the feed records the play, so a burst
 * normally precedes its stamp). Returns the bursts in time order, each with
 * the play it was caused by, so the chart can name the reason for a move.
 *
 * @returns {Array<{start:number,end:number,total:number,play:object,lead:number}>}
 */
export function attributeMoves(ticks, plays, outcomes) {
  if (!ticks?.length || !plays?.length || !outcomes?.length) return [];
  const sorted = [...plays].sort((a, b) => a.end - b.end);
  const ends = sorted.map((p) => p.end);
  const out = [];
  for (const r of reactions(ticks, outcomes)) {
    const i = nearestIndex(ends, r.centre);
    if (i < 0) continue;
    const play = sorted[i];
    const lead = play.end - r.centre;
    if (lead > MATCH_BEFORE_MS || lead < -MATCH_AFTER_MS) continue;
    out.push({ start: r.start, end: r.end, centre: r.centre, total: r.total, play, lead });
  }
  return out;
}

/** The attributed move covering (or just around) a moment, if any. */
export function moveAt(attributed, ts, slackMs = 3000) {
  if (!attributed?.length || ts == null) return null;
  for (const m of attributed) {
    if (ts >= m.start - slackMs && ts <= m.end + slackMs) return m;
  }
  return null;
}

/**
 * @returns {{lagMs:number, leadMs:number, samples:number, moves:number,
 *            biggest:number}|null} null when there isn't enough to measure.
 */
export function estimateLag(ticks, plays, outcomes) {
  if (!ticks?.length || !plays?.length || !outcomes?.length) return null;
  const bursts = reactions(ticks, outcomes);
  if (!bursts.length) return null;

  const ends = plays.map((p) => p.end).sort((a, b) => a - b);
  const nearest = (ts) => {
    let lo = 0, hi = ends.length - 1, best = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (best === null || Math.abs(ends[mid] - ts) < Math.abs(best - ts)) best = ends[mid];
      if (ends[mid] < ts) lo = mid + 1; else hi = mid - 1;
    }
    return best;
  };

  const matched = [];
  for (const r of bursts) {
    const end = nearest(r.centre);
    if (end === null) continue;
    const lead = end - r.centre;
    if (lead > MATCH_BEFORE_MS || lead < -MATCH_AFTER_MS) continue; // unrelated
    matched.push({ ...r, lead, leadStart: end - r.start });
  }
  if (matched.length < MIN_SAMPLES) return null;

  // Typical lag: where the bulk of a reaction sits, across every reaction.
  const lagMs = Math.max(0, Math.round(median(matched.map((m) => m.lead))));

  // Leading edge: how early the reaction STARTS on the moves that matter —
  // the big ones (runs, home runs). Averaged over all reactions this gets
  // inflated by slow drifts, which is not what the number is describing.
  const cutoff = percentile(matched.map((m) => m.total), 0.75);
  const big = matched.filter((m) => m.total >= Math.max(cutoff, 3));
  const leadMs = Math.max(
    lagMs,
    Math.round(median((big.length >= 3 ? big : matched).map((m) => m.leadStart))),
  );

  return {
    lagMs,
    leadMs,
    samples: matched.length,
    bigSamples: big.length,
    moves: bursts.length,
    biggest: Math.round(Math.max(...matched.map((m) => m.total))),
  };
}
