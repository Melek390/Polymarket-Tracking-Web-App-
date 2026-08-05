import { T } from "../../theme.js";

// Wide cumulative-P&L line for a strategy card. Purely presentational —
// green when the curve ends above zero, red below, zero line dashed.
export default function EquityLine({ points, height = 64 }) {
  if (!points || points.length < 2) return null;
  const W = 640;
  const min = Math.min(...points, 0);
  const max = Math.max(...points, 0);
  const span = max - min || 1;
  const x = (i) => (i / (points.length - 1)) * W;
  const y = (v) => height - 4 - ((v - min) / span) * (height - 8);
  const line = points.map((p, i) => `${x(i).toFixed(1)},${y(p).toFixed(1)}`).join(" ");
  const up = points[points.length - 1] >= 0;
  return (
    <svg
      viewBox={`0 0 ${W} ${height}`}
      preserveAspectRatio="none"
      style={{ width: "100%", height, display: "block" }}
    >
      <line x1="0" x2={W} y1={y(0)} y2={y(0)} stroke={T.border} strokeDasharray="4 4" />
      <polyline points={line} fill="none" stroke={up ? T.green : T.red} strokeWidth="2" />
    </svg>
  );
}
