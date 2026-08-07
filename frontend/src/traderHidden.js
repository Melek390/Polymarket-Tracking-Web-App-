// Hidden-row storage for the accounts tracker (client request, Aug 7):
// hide a position or closed trade from the tables without deleting anything.
//
// Same rules every localStorage feature here has learned the hard way
// (V2.md, Aug 5): every write reads fresh from disk first, and the view adds
// a storage listener — otherwise a second window silently erases or ignores it.

const KEY = "traderHiddenRows"; // { "acctId|rowKey": true }

export const hiddenKey = (acctId, rowKey) => `${acctId}|${rowKey}`;

export function loadHidden() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}");
  } catch {
    return {};
  }
}

export function toggleHidden(acctId, rowKey) {
  const all = loadHidden();
  const key = hiddenKey(acctId, rowKey);
  if (all[key]) delete all[key];
  else all[key] = true;
  localStorage.setItem(KEY, JSON.stringify(all));
  return all;
}
