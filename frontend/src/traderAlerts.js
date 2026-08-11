// Alert storage for the accounts tracker: price targets on positions, and the
// per-account watermark for "new trade" notifications.
//
// Same rules every localStorage feature here has learned the hard way
// (V2.md, Aug 5): every write reads fresh from disk first, and the view adds a
// storage listener — otherwise a second window silently erases or ignores it.

const PRICE_KEY = "traderPriceAlerts";  // { "acctId|asset": {above, below, title} }
const SEEN_KEY = "traderLastSeen";      // { acctId: newest activity ts handled }

export const alertKey = (acctId, asset) => `${acctId}|${asset}`;

export function loadPriceAlerts() {
  try {
    return JSON.parse(localStorage.getItem(PRICE_KEY) || "{}");
  } catch {
    return {};
  }
}

// above/below are cents (0..100) or null. Both null = remove the alert.
export function setPriceAlert(acctId, asset, above, below, title) {
  const all = loadPriceAlerts();
  const key = alertKey(acctId, asset);
  if (above == null && below == null) delete all[key];
  else all[key] = { above, below, title: title || "" };
  localStorage.setItem(PRICE_KEY, JSON.stringify(all));
  return all;
}

export function loadLastSeen() {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) || "{}");
  } catch {
    return {};
  }
}

export function setLastSeen(acctId, ts) {
  const all = loadLastSeen();
  if ((all[acctId] || 0) < ts) {
    all[acctId] = ts;
    localStorage.setItem(SEEN_KEY, JSON.stringify(all));
  }
  return all;
}

export function alertSummaryText(a) {
  const bits = [];
  if (a.above != null) bits.push(`≥ ${a.above}¢`);
  if (a.below != null) bits.push(`≤ ${a.below}¢`);
  return bits.join(" or ");
}

// Account-wide price rule (client request, Aug 11): "I exit at 70c on every
// single open position" — one target pair per ACCOUNT that applies to all of
// its open positions, current and future. A position's own alert overrides it.
const ACCT_KEY = "traderAccountAlerts"; // { acctId: {above, below} }

export function loadAccountAlerts() {
  try {
    return JSON.parse(localStorage.getItem(ACCT_KEY) || "{}");
  } catch {
    return {};
  }
}

export function setAccountAlert(acctId, above, below) {
  const all = loadAccountAlerts();
  if (above == null && below == null) delete all[acctId];
  else all[acctId] = { above, below };
  localStorage.setItem(ACCT_KEY, JSON.stringify(all));
  return all;
}

// Per-account mute (client request, Aug 7): he follows his own wallets, so
// every trade he makes on another machine came back at him as an alert.
// Muted accounts fire NO alerts — neither entry/exit toasts nor price alerts.
const MUTE_KEY = "traderAlertMute"; // { acctId: true }

export function loadMuted() {
  try {
    return JSON.parse(localStorage.getItem(MUTE_KEY) || "{}");
  } catch {
    return {};
  }
}

export function toggleMuted(acctId) {
  const all = loadMuted();
  if (all[acctId]) delete all[acctId];
  else all[acctId] = true;
  localStorage.setItem(MUTE_KEY, JSON.stringify(all));
  return all;
}
