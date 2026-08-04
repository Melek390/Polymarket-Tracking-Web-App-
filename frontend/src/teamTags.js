// Team tags: the user's own labels on MLB clubs ("my teams", "fade", "sharp"),
// so a club can be spotted while scanning without reading every row.
//
// Kept in the browser like alerts, highlights and presets. Deliberately NO
// limits — any number of tags, any number of tags per team, per the brief.
//
// Shape: { tags: [{id, label, color}], byTeam: { "<team name>": [tagId, ...] } }
// Teams are keyed by MLB's full club name, which is what the live feed gives us
// and what /api/mlb/teams returns.

const KEY = "mlbTeamTags";
const EMPTY = { tags: [], byTeam: {} };

// Same palette as the row highlights, so the two features look like one system.
export const TAG_COLORS = [
  { key: "blue", dot: "#2563EB" },
  { key: "green", dot: "#16A34A" },
  { key: "purple", dot: "#7C3AED" },
  { key: "pink", dot: "#DB2777" },
  { key: "orange", dot: "#EA580C" },
  { key: "teal", dot: "#0D9488" },
  { key: "slate", dot: "#475569" },
];

export const colorOf = (key) =>
  (TAG_COLORS.find((c) => c.key === key) || TAG_COLORS[0]).dot;

export function loadTeamTags() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "null");
    if (!v || !Array.isArray(v.tags) || typeof v.byTeam !== "object") return EMPTY;
    return v;
  } catch {
    return EMPTY;
  }
}

export function persistTeamTags(state) {
  localStorage.setItem(KEY, JSON.stringify(state));
}

// Date.now() alone collides when two tags are made in the same millisecond.
const newId = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function addTag(state, label, color) {
  const text = (label || "").trim();
  if (!text) return state;
  return { ...state, tags: [...state.tags, { id: newId(), label: text, color }] };
}

export function removeTag(state, id) {
  const byTeam = {};
  for (const [team, ids] of Object.entries(state.byTeam)) {
    const kept = ids.filter((x) => x !== id);
    if (kept.length) byTeam[team] = kept;
  }
  return { tags: state.tags.filter((t) => t.id !== id), byTeam };
}

export function toggleTeamTag(state, team, id) {
  const has = (state.byTeam[team] || []).includes(id);
  const ids = has
    ? state.byTeam[team].filter((x) => x !== id)
    : [...(state.byTeam[team] || []), id];
  const byTeam = { ...state.byTeam };
  if (ids.length) byTeam[team] = ids;
  else delete byTeam[team];
  return { ...state, byTeam };
}

// The tag objects on a team, in the order they were created.
export function tagsFor(state, team) {
  if (!team) return [];
  const ids = state.byTeam[team];
  if (!ids?.length) return [];
  return state.tags.filter((t) => ids.includes(t.id));
}

// How many clubs carry at least one tag — for the button label.
export const taggedTeamCount = (state) => Object.keys(state.byTeam).length;
