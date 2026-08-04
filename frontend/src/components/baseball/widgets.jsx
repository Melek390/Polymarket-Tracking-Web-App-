import { T } from "../../theme.js";

// HOME / AWAY pill for the batting team, so the Batting column can be read on
// its own without cross-referencing the "Away @ Home" game column.
// Keeps the colours the old bare dot used (blue = home, purple = away) so the
// mapping is unchanged — the word is now just spelled out. The label carries
// the meaning, which is also why colour alone is never the only cue.
const SIDE = {
  home: { label: "HOME", bg: T.series[0] },
  away: { label: "AWAY", bg: T.series[2] },
};

export function HomeAwayTag({ side }) {
  const s = SIDE[side];
  if (!s) return null;
  return (
    <span
      title={side === "home" ? "Home team batting" : "Away team batting"}
      style={{
        fontFamily: T.ui, fontSize: 9, fontWeight: 700, letterSpacing: 0.5,
        color: "#fff", background: s.bg, borderRadius: 4,
        padding: "2px 6px", lineHeight: 1.4,
      }}
    >
      {s.label}
    </span>
  );
}

// A small baseball diamond: filled when a runner is on the base.
export function Bases({ bases }) {
  const dot = (on) => ({
    width: 9, height: 9, transform: "rotate(45deg)",
    background: on ? T.ink : "transparent",
    border: `1px solid ${on ? T.ink : T.faint}`,
  });
  return (
    <span style={{ display: "inline-grid", gridTemplateColumns: "repeat(3, 11px)", gap: 2 }}>
      <span /><span style={dot(bases?.second)} /><span />
      <span style={dot(bases?.third)} /><span /><span style={dot(bases?.first)} />
    </span>
  );
}

// Three out indicators, filled by the number of outs — the MLB.com-style
// visual cue (0/1/2 filled; 3 ends the inning).
export function OutDots({ outs, size = 11 }) {
  const n = outs ?? 0;
  return (
    <span style={{ display: "inline-flex", gap: Math.round(size * 0.55) }}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: size, height: size, borderRadius: "50%",
            background: i < n ? T.ink : "transparent",
            border: `1.5px solid ${i < n ? T.ink : T.faint}`,
          }}
        />
      ))}
    </span>
  );
}

