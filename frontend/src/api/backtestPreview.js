// Field labels for the backtesting params dialog. The strategies, their
// saved parameters and the defaults all live SERVER-SIDE now (the Aug 5
// localStorage lessons: presets must be shared and multi-window safe) —
// this file keeps only the display strings.

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

// factors the v1 backfill stores as honestly-unknown (they score 0 and are
// reported as coverage, never invented) — the dialog marks them
export const UNKNOWN_IN_V1 = new Set(["teamQualityForm", "priceVsHistory"]);
