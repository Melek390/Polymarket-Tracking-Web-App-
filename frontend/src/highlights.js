// Row highlighting: the user marks the games they want to keep an eye on with
// a colour, so they can spot them at a glance in a long table. Saved in the
// browser (like alerts and presets), keyed by match slug so a highlight sticks
// across refreshes and across sports.

const KEY = "screenerHighlights";

// Deliberately no amber in here: a matching alert paints the row #FEF3C7, and
// a highlight must stay distinguishable from that.
export const HIGHLIGHT_COLORS = [
  { key: "blue", label: "Blue", bg: "#DBEAFE", dot: "#2563EB" },
  { key: "green", label: "Green", bg: "#DCFCE7", dot: "#16A34A" },
  { key: "purple", label: "Purple", bg: "#EDE9FE", dot: "#7C3AED" },
  { key: "pink", label: "Pink", bg: "#FCE7F3", dot: "#DB2777" },
  { key: "orange", label: "Orange", bg: "#FFEDD5", dot: "#EA580C" },
  { key: "teal", label: "Teal", bg: "#CCFBF1", dot: "#0D9488" },
];

export function loadHighlights() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}");
  } catch {
    return {};
  }
}

export function persistHighlights(highlights) {
  localStorage.setItem(KEY, JSON.stringify(highlights));
}

// The palette entry for a stored key, or null when the row isn't highlighted.
export function highlightColor(key) {
  return HIGHLIGHT_COLORS.find((c) => c.key === key) || null;
}
