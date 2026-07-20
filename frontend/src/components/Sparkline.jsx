import { T } from "../theme.js";

const W = 96;
const H = 26;

// Tiny inline price line for a market row; dimmed when the market is paused.
export default function Sparkline({ points, dimmed }) {
  if (!points || points.length < 2) {
    return <svg width={W} height={H} />;
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const coords = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * W;
      const y = H - 3 - ((p - min) / span) * (H - 6);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg width={W} height={H} style={{ opacity: dimmed ? 0.35 : 1 }}>
      <polyline
        points={coords}
        fill="none"
        stroke={T.series[0]}
        strokeWidth="1.5"
      />
    </svg>
  );
}
