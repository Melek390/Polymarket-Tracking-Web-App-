// Per-match notes for the screener (client request, Aug 11): free text the
// user writes to remember his thinking about a specific game, shown under
// the match name. Keyed by slug, so a note follows the match, not the row.
//
// Same rules every localStorage feature here has learned the hard way
// (V2.md, Aug 5): every write reads fresh from disk first, and the view adds
// a storage listener — otherwise a second window silently erases or ignores it.

const KEY = "matchNotes"; // { slug: "text" }

export function loadNotes() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}");
  } catch {
    return {};
  }
}

export function setNote(slug, text) {
  const all = loadNotes();
  const t = (text || "").trim();
  if (t) all[slug] = t;
  else delete all[slug];
  localStorage.setItem(KEY, JSON.stringify(all));
  return all;
}
