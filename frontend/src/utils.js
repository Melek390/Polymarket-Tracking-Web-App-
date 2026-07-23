// Turn a past timestamp into a short "4s ago" / "3m ago" / "2h ago" label.
export function timeAgo(ts) {
  if (!ts) return "never";
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

// All display times are UTC so the UI, the database and the CSV always agree.
// Clock time only, e.g. "14:03:27".
export function fmtTime(ts) {
  return new Date(ts).toISOString().slice(11, 19);
}

// Date only, e.g. "2026-07-21".
export function fmtDate(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

// Full date and time, e.g. "2026-07-21 14:03:27".
export function fmtTimestamp(ts) {
  return new Date(ts).toISOString().slice(0, 19).replace("T", " ");
}

// A market is open (tracking), paused (stopped), or closed (resolved).
export function marketStatus(m) {
  return m.closed ? "closed" : m.tracking ? "open" : "paused";
}

// One group per EVENT (keyed by slug, never by title — two different games
// can share the exact same title, e.g. repeat baseball fixtures). A match's
// extra props live in a twin "-more-markets" event on Polymarket; fold those
// into the same box as the match itself.
export function groupByEvent(markets) {
  const groups = [];
  for (const m of markets) {
    const slug = m.eventSlug.replace(/-more-markets$/, "");
    let g = groups.find((g) => g.slug === slug);
    if (!g) {
      g = { slug, event: m.event, createdAt: m.createdAt, markets: [] };
      groups.push(g);
    }
    g.markets.push(m);
    g.createdAt = Math.min(g.createdAt, m.createdAt);
  }
  return groups;
}

// 2400000 -> "$2.4M", 845000 -> "$845K" for the screener volume column
export function fmtVolume(usd) {
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(1)}M`;
  if (usd >= 1_000) return `$${Math.round(usd / 1_000)}K`;
  return `$${usd}`;
}

// Prices are stored AND displayed in cents; this only trims noise:
// 40.5 -> "40.5¢", 99.95 -> "99.95¢", 50 -> "50¢"
export function fmtCents(cents) {
  return `${cents.toFixed(2).replace(/\.?0+$/, "")}¢`;
}
