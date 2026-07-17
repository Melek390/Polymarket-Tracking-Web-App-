export function timeAgo(ts) {
  if (!ts) return "never";
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

// All display times are UTC so the UI, the database and the CSV always agree.
export function fmtTime(ts) {
  return new Date(ts).toISOString().slice(11, 19);
}

export function fmtDate(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

export function fmtTimestamp(ts) {
  return new Date(ts).toISOString().slice(0, 19).replace("T", " ");
}
