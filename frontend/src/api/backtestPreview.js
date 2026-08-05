// MOCK DATA for the backtesting design preview — same approach the screener
// and the accounts tracker used before real data fed them. Numbers are
// invented; the SHAPES mirror what the real simulator will produce, so wiring
// it later is an import swap, not a rewrite.
//
// The parameter set mirrors .claude/V2-BACKTESTING.md: hard filters first,
// then the checklist weights, then the bounce (exit) definition. Values below
// are the client's stated defaults; "Restore defaults" reverts to these.

export const DEFAULT_PARAMS = {
  hardFilters: {
    maxPriceCents: 25,     // trailing team must cost at most this
    minInningsLeft: 4,     // TO CONFIRM with the client — spec never fixed it
  },
  bounce: {
    targetCents: 5,        // TO CONFIRM — what price move counts as a win
    horizonHalfInnings: 4, // TO CONFIRM — how long the trade has to work
  },
  minScore: 7,             // checklist total needed before a spot "fires"
  weights: {
    remainingInnings: 2,
    scoreDeficit: 2,
    trailingTeamHome: 1.5,
    teamQualityForm: 2,
    leadingPitcher: 1.5,
    trailingPitcher: 1.5,
    dueUpOrder: 1,
    parkWeather: 1,
    priceVsHistory: 1,
    contactBonus: 0.5,
  },
};

export const WEIGHT_LABELS = {
  remainingInnings: "Remaining innings",
  scoreDeficit: "Score deficit",
  trailingTeamHome: "Trailing team is home",
  teamQualityForm: "Team quality / last-6 form",
  leadingPitcher: "Leading team's pitcher (tired/wild)",
  trailingPitcher: "Trailing team's pitcher",
  dueUpOrder: "Due-up batting order",
  parkWeather: "Ballpark + weather",
  priceVsHistory: "Price vs historical win expectancy",
  contactBonus: "Contact bonus (hits so far)",
};

// sample equity curves (cumulative P&L in $, one point per simulated spot)
const eq = (steps) => {
  const out = [0];
  for (const s of steps) out.push(out[out.length - 1] + s);
  return out;
};

export const STRATEGIES = [
  {
    id: "comeback-default",
    name: "Trailing-team comeback — default",
    description:
      "Buy the trailing side ≤25¢ right after a half-inning ends, checklist score ≥7; exit on a +5¢ bounce.",
    params: DEFAULT_PARAMS,
    stats: {
      spots: 148, wins: 95, winRate: 0.642, pnl: 412.5,
      avgBounceCents: 6.2, avgHoldHalfInnings: 1.8, maxDrawdown: -86,
      equity: eq([12,-9,22,15,-14,31,8,-22,40,12,19,-11,28,33,-18,24,41,-9,17,29,-31,38,22,14]),
      bySituation: [
        { label: "Trailing team at HOME", spots: 61, winRate: 0.72, pnl: 241.0 },
        { label: "Trailing by 1 run", spots: 84, winRate: 0.69, pnl: 302.5 },
        { label: "Score 8+", spots: 33, winRate: 0.79, pnl: 195.0 },
        { label: "Trailing by 2 runs", spots: 47, winRate: 0.55, pnl: 88.0 },
        { label: "6+ innings left", spots: 52, winRate: 0.67, pnl: 176.5 },
        { label: "Boston Red Sox (picked)", spots: 11, winRate: 0.65, pnl: 41.0 },
      ],
    },
  },
  {
    id: "comeback-loose",
    name: "Looser gate — ≤35¢, score ≥5",
    description: "Same checklist with a wider entry: more spots, weaker hit rate.",
    params: {
      ...DEFAULT_PARAMS,
      hardFilters: { maxPriceCents: 35, minInningsLeft: 3 },
      minScore: 5,
    },
    stats: {
      spots: 297, wins: 154, winRate: 0.519, pnl: 148.0,
      avgBounceCents: 4.1, avgHoldHalfInnings: 2.3, maxDrawdown: -164,
      equity: eq([8,-14,11,-9,16,-21,13,9,-17,22,-12,7,14,-19,11,16,-8,-13,21,9,-16,12,8,-11,14,19,-9,7]),
      bySituation: [
        { label: "Trailing team at HOME", spots: 118, winRate: 0.58, pnl: 121.0 },
        { label: "Trailing by 1 run", spots: 139, winRate: 0.57, pnl: 132.5 },
        { label: "Trailing by 3 runs", spots: 58, winRate: 0.36, pnl: -74.0 },
        { label: "Bottom of order due up", spots: 71, winRate: 0.42, pnl: -38.0 },
      ],
    },
  },
];
