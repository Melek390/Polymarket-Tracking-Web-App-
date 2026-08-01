// MOCK DATA for the V3 accounts-tracker design preview — same approach the
// screener used before real data fed it (screenerPreview.js). Every shape here
// mirrors what the real endpoints will return, so wiring the backend later is a
// swap of this import, not a rewrite of the view.
//
// Field origins, so the backend knows what it owes:
//   direct   — comes straight from data-api.polymarket.com
//   computed — derived from the trade log
//   ours     — stored by us (tags, alerts)

export const TAGS = [
  "Bounce", "Average Down", "One Run Behind", "Two Runs Behind",
  "Three Runs Behind", "First Innings Bet", "2nd Innings Bet",
  "Bottom Innings", "Favorite", "Underdog", "AFG",
];

export const ACCOUNTS = [
  { id: "me", label: "My account", wallet: "0x2c335066fe58fe9237c3d3dc7b275c2a034a0563" },
  { id: "bro", label: "Brother", wallet: "0x9d84ce0306f8551e02efef1680475fc0f1dc1344" },
  { id: "friend", label: "Friend", wallet: "0x204f72f35326db932158cba6adff0b9a1da95e14" },
];

const H = 3600_000;
const now = Date.now();

// --- stat cards -----------------------------------------------------------
export const SUMMARY = {
  portfolioValue: 4218.55,   // direct   /value
  unrealizedPnl: 312.40,     // direct   sum positions[].cashPnl
  realizedPnl: 1864.20,      // computed from closed round trips
  openPositions: 6,          // direct
  closedTrades: 41,          // computed
  winRate: 0.634,            // computed
  avgHoldMinutes: 74,        // computed
};

// --- open positions -------------------------------------------------------
// avgEntry / current / shares / cost / value / pnl / roi are all direct fields.
// lowSinceEntry is computed from price history (ours, where we have ticks).
export const OPEN = [
  { id: "o1", market: "Yankees vs Red Sox", side: "YES Yankees", category: "MLB",
    avgEntry: 23, current: 31, shares: 500, cost: 115, value: 155,
    lowSinceEntry: 19, openedAt: now - 2.4 * H, tags: ["Two Runs Behind", "Underdog"] },
  { id: "o2", market: "Dodgers vs Giants", side: "YES Dodgers", category: "MLB",
    avgEntry: 62, current: 58, shares: 400, cost: 248, value: 232,
    lowSinceEntry: 54, openedAt: now - 1.1 * H, tags: ["Favorite"] },
  { id: "o3", market: "Blue Jays vs Rays", side: "YES Blue Jays", category: "MLB",
    avgEntry: 41, current: 47, shares: 300, cost: 123, value: 141,
    lowSinceEntry: 33, openedAt: now - 0.6 * H, tags: ["Bounce", "One Run Behind"],
    averagedDown: [{ price: 48, shares: 150 }, { price: 34, shares: 150 }] },
  { id: "o4", market: "Arsenal vs Chelsea", side: "YES Arsenal", category: "Soccer",
    avgEntry: 55, current: 51, shares: 200, cost: 110, value: 102,
    lowSinceEntry: 49, openedAt: now - 5.2 * H, tags: [] },
  { id: "o5", market: "Mariners vs Twins", side: "NO Twins", category: "MLB",
    avgEntry: 71, current: 78, shares: 260, cost: 184.6, value: 202.8,
    lowSinceEntry: 68, openedAt: now - 0.3 * H, tags: ["AFG", "First Innings Bet"] },
  { id: "o6", market: "Fed cuts rates in September", side: "YES", category: "Finance",
    avgEntry: 34, current: 29, shares: 900, cost: 306, value: 261,
    lowSinceEntry: 27, openedAt: now - 96 * H, tags: [] },
];

// --- closed trades --------------------------------------------------------
// peakAfterExit is the metric the client cares most about: where the price got
// to AFTER he sold, so he can see whether he is selling too early.
export const CLOSED = [
  { id: "c1", closedAt: now - 3 * H, market: "Astros vs Mariners", side: "YES Astros",
    category: "MLB", buy: 22, sell: 30, shares: 250, cost: 55, proceeds: 75,
    peakAfterExit: 44, heldMinutes: 38, tags: ["Bounce"] },
  { id: "c2", closedAt: now - 7 * H, market: "Phillies vs Braves", side: "YES Phillies",
    category: "MLB", buy: 47, sell: 39, shares: 300, cost: 141, proceeds: 117,
    peakAfterExit: 41, heldMinutes: 96, tags: ["Average Down", "Two Runs Behind"] },
  { id: "c3", closedAt: now - 26 * H, market: "Padres vs Rockies", side: "YES Padres",
    category: "MLB", buy: 58, sell: 74, shares: 180, cost: 104.4, proceeds: 133.2,
    peakAfterExit: 76, heldMinutes: 51, tags: ["Favorite"] },
  { id: "c4", closedAt: now - 30 * H, market: "Man City vs Liverpool", side: "YES Draw",
    category: "Soccer", buy: 26, sell: 21, shares: 400, cost: 104, proceeds: 84,
    peakAfterExit: 33, heldMinutes: 145, tags: [] },
  { id: "c5", closedAt: now - 52 * H, market: "Guardians vs Tigers", side: "NO Tigers",
    category: "MLB", buy: 64, sell: 88, shares: 220, cost: 140.8, proceeds: 193.6,
    peakAfterExit: 100, heldMinutes: 132, tags: ["Three Runs Behind", "Underdog"] },
  { id: "c6", closedAt: now - 74 * H, market: "Cubs vs Cardinals", side: "YES Cubs",
    category: "MLB", buy: 35, sell: 33, shares: 500, cost: 175, proceeds: 165,
    peakAfterExit: 38, heldMinutes: 64, tags: ["Bottom Innings"] },
];

// --- recent activity ------------------------------------------------------
export const ACTIVITY = [
  { id: "a1", ts: now - 4 * 60_000, type: "BUY", market: "Mariners vs Twins", side: "NO Twins", shares: 260, price: 71 },
  { id: "a2", ts: now - 19 * 60_000, type: "SELL", market: "Astros vs Mariners", side: "YES Astros", shares: 250, price: 30 },
  { id: "a3", ts: now - 34 * 60_000, type: "BUY", market: "Blue Jays vs Rays", side: "YES Blue Jays", shares: 150, price: 34 },
  { id: "a4", ts: now - 51 * 60_000, type: "BUY", market: "Blue Jays vs Rays", side: "YES Blue Jays", shares: 150, price: 48 },
  { id: "a5", ts: now - 88 * 60_000, type: "REDEEM", market: "Guardians vs Tigers", side: "NO Tigers", shares: 220, price: 100 },
  { id: "a6", ts: now - 121 * 60_000, type: "BUY", market: "Dodgers vs Giants", side: "YES Dodgers", shares: 400, price: 62 },
];
