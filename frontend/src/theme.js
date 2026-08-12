export const T = {
  ink: "#1A1D23",
  sub: "#3F4854", // darkened on client request — readability over subtlety
  faint: "#646B76",
  border: "#E5E7EB",
  soft: "#F8F9FB",
  green: "#0E9F6E",
  red: "#D64545",
  series: ["#2563EB", "#D97706", "#7C3AED", "#0E9F6E"],
  ui: `"Inter", system-ui, sans-serif`,
  mono: `"IBM Plex Mono", ui-monospace, Consolas, monospace`,
};

// Neutral meter greys (client, Aug 12: "too many colours, too bright").
// Bars, badges and state pills default to these. Colour is reserved for the
// few things that carry meaning on their own — away/home prices, a blocked
// state, an armed alert, the Clear Favorite tag — so when something IS
// coloured it means something.
export const meter = {
  track: "#E8EAEE",
  fill: "#B6BCC5",
  fillStrong: "#5B6470",
};

export const card = {
  border: `1px solid ${T.border}`,
  borderRadius: 8,
  background: "#fff",
};

export const monoText = {
  fontFamily: T.mono,
  fontVariantNumeric: "tabular-nums",
};

export const label = {
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: 0.6,
  color: T.sub,
};

export const page = {
  width: "100%",
  padding: "24px 32px 48px",
  display: "flex",
  flexDirection: "column",
  gap: 20,
};

const btnBase = {
  fontFamily: T.ui,
  fontWeight: 600,
  borderRadius: 8,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

export const btn = {
  primary: { ...btnBase, border: "none", background: T.ink, color: "#fff" },
  outline: {
    ...btnBase,
    border: `1px solid ${T.border}`,
    background: "#fff",
    color: T.ink,
  },
  ghost: {
    ...btnBase,
    fontWeight: 400,
    border: "none",
    background: "transparent",
    color: T.sub,
  },
  green: { ...btnBase, border: "none", background: T.green, color: "#fff" },
  redOutline: {
    ...btnBase,
    border: `1px solid ${T.red}`,
    background: "#fff",
    color: T.red,
  },
};
