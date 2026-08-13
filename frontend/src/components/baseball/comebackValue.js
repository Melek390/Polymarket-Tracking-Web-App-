// The client's value bands for the home team's LIVE price in the comeback
// window (Aug 13 — this is the "text next to the team" his spec cut off).
//
// Two situations, both requiring the game live and the home side batting (or
// about to bat) in the 8th inning or later:
//   home trailing by exactly 1:  <=20c Strong value · 21-25 Decent value ·
//                                26-30 Marginal / fair · >=31 No edge or negative
//   scores tied:                 <=50c Strong value · 51-55 Decent value ·
//                                56-60 Marginal / fair · >=61 No edge or negative
//
// The client wrote "Bottom 8th inning"; inning >= 8 is used so the 9th and
// extras — where the same comeback logic holds at least as strongly — keep
// the label rather than it vanishing after one half-inning.
//
// The bands are read with <= on each upper edge so decimal prices land where
// a person would put them (20.5c is "21-25" -> Decent value).

const DOWN_ONE = [
  [20, "Strong value"],
  [25, "Decent value"],
  [30, "Marginal / fair"],
  [Infinity, "No edge or negative"],
];
const TIED = [
  [50, "Strong value"],
  [55, "Decent value"],
  [60, "Marginal / fair"],
  [Infinity, "No edge or negative"],
];

// tier index 0..3 doubles as the display strength (0 = strongest signal)
export function comebackValue(live, homePriceCents) {
  if (!live || live.status !== "Live" || homePriceCents == null) return null;
  if ((live.inning ?? 0) < 8) return null;
  // "batting: home" covers the bottom half AND the Middle break before it —
  // the same window the Comeback Setup trigger uses.
  if (live.batting !== "home") return null;
  const away = live.away?.runs;
  const home = live.home?.runs;
  if (away == null || home == null) return null;
  const diff = away - home;
  const bands = diff === 1 ? DOWN_ONE : diff === 0 ? TIED : null;
  if (!bands) return null;
  const tier = bands.findIndex(([max]) => homePriceCents <= max);
  return {
    label: bands[tier][1],
    tier,
    situation: diff === 1 ? "down 1" : "tied",
  };
}
