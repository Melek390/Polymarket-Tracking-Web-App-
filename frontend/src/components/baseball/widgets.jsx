import { T } from "../../theme.js";

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

