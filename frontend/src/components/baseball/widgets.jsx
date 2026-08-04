import { T } from "../../theme.js";

// The small label pills used across the baseball row. The WORD always carries
// the meaning; colour only makes it scannable, so none of these depend on
// colour alone being readable.
function Pill({ label, bg, title }) {
  return (
    <span
      title={title}
      style={{
        display: "inline-block",
        fontFamily: T.ui, fontSize: 9, fontWeight: 700, letterSpacing: 0.5,
        color: "#fff", background: bg, borderRadius: 4,
        padding: "2px 6px", lineHeight: 1.4,
      }}
    >
      {label}
    </span>
  );
}

// HOME / AWAY for the batting team, so the Batting column can be read on its
// own without cross-referencing the "Away @ Home" game column. Keeps the
// colours the old bare dot used (blue = home, purple = away), so the mapping
// the client already knows is unchanged — just spelled out.
const SIDE = {
  home: { label: "HOME", bg: T.series[0] },
  away: { label: "AWAY", bg: T.series[2] },
};

export function HomeAwayTag({ side }) {
  const s = SIDE[side];
  if (!s) return null;
  return <Pill label={s.label} bg={s.bg}
    title={side === "home" ? "Home team batting" : "Away team batting"} />;
}

// Marks which of the two price columns is currently at bat. Deliberately
// NEUTRAL dark: green and red are already spoken for in those columns (they
// mark the favourite and the underdog), so a coloured pill there would read as
// a price signal rather than a game state.
export function BattingTag() {
  return <Pill label="BATTING" bg={T.ink} title="This team is at bat" />;
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

