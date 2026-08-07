// Hidden-row storage for the screener (client request, Aug 7): hide a match
// from the list without deleting anything; a toggle reveals them for unhiding.
//
// Same rules every localStorage feature here has learned the hard way
// (V2.md, Aug 5): every write reads fresh from disk first, and the view adds
// a storage listener — otherwise a second window silently erases or ignores it.

const KEY = "screenerHiddenRows"; // { slug: true } — slugs are unique per match

export function loadScreenerHidden() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}");
  } catch {
    return {};
  }
}

export function toggleScreenerHidden(slug) {
  const all = loadScreenerHidden();
  if (all[slug]) delete all[slug];
  else all[slug] = true;
  localStorage.setItem(KEY, JSON.stringify(all));
  return all;
}
