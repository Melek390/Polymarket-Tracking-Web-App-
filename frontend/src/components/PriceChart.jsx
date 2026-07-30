import { useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Brush,
  CartesianGrid,
  ReferenceLine,
  ReferenceDot,
} from "recharts";
import { T, card, monoText, btn } from "../theme.js";
import { fmtCents, fmtDate, fmtTime, fmtTimestamp } from "../utils.js";

const LEVELS = [10, 15, 20, 25, 30, 40, 50]; // cents
const MAX_LEVEL_DOTS = 300;

// The play that was happening at time `ts` (last play that had started by then).
function stateAt(timeline, ts) {
  if (!timeline || !timeline.length || ts == null) return null;
  let found = null;
  for (const p of timeline) {
    if (p.start <= ts) found = p;
    else break;
  }
  return found;
}

// Tooltip: the prices at the hovered point, plus (for MLB) the inning and who
// was pitching / batting at that moment.
function ChartTooltip({ active, payload, label, timeline }) {
  if (!active || !payload || !payload.length) return null;
  const play = stateAt(timeline, label);
  return (
    <div style={{ ...monoText, fontSize: 12, background: "#fff",
      border: `1px solid ${T.border}`, borderRadius: 8, padding: "8px 10px" }}>
      <div style={{ color: T.sub, marginBottom: 4 }}>{fmtTimestamp(label)}</div>
      {payload.map((p) => (
        <div key={p.dataKey} style={{ color: p.color }}>
          {p.dataKey}: {p.value != null ? fmtCents(p.value) : "—"}
        </div>
      ))}
      {play && (
        <div style={{ marginTop: 6, paddingTop: 5, borderTop: `1px solid ${T.border}` }}>
          <div style={{ fontWeight: 700, color: T.ink }}>
            {play.half === "top" ? "▲ Top" : "▼ Bot"} {play.inning}
          </div>
          {play.pitcher && <div style={{ color: T.sub }}>Pitching: {play.pitcher}</div>}
          {play.batter && <div style={{ color: T.sub }}>At bat: {play.batter}</div>}
        </div>
      )}
    </div>
  );
}

// The price line chart: outcome lines, current-price dots, zoom slider and price levels.
export default function PriceChart({
  ticks,
  outcomes,
  trackedSince,
  window: win,
  onWindowChange,
  timeline,
}) {
  const [level, setLevel] = useState(null);

  // translate the remembered time window into data indexes for the slider
  let startIndex = 0;
  let endIndex = Math.max(0, ticks.length - 1);
  if (win && ticks.length) {
    const from = ticks.findIndex((t) => t.ts >= win[0]);
    startIndex = from < 0 ? 0 : from;
    for (let i = ticks.length - 1; i >= 0; i--) {
      if (ticks[i].ts <= win[1]) {
        endIndex = i;
        break;
      }
    }
    if (endIndex <= startIndex) {
      startIndex = 0;
      endIndex = ticks.length - 1;
    }
  }

  // last known price of every outcome, for the highlight dots
  const latest = {};
  for (const o of outcomes) {
    for (let i = ticks.length - 1; i >= 0; i--) {
      if (ticks[i][o] != null) {
        latest[o] = { ts: ticks[i].ts, price: ticks[i][o] };
        break;
      }
    }
  }

  // every point where a price touched or crossed the selected level
  const touches = [];
  if (level != null) {
    outer: for (const [oi, o] of outcomes.entries()) {
      for (let i = 1; i < ticks.length; i++) {
        const a = ticks[i - 1][o];
        const b = ticks[i][o];
        if (a == null || b == null) continue;
        if ((a - level) * (b - level) <= 0) {
          touches.push({ ts: ticks[i].ts, price: b, color: T.series[oi % T.series.length] });
          if (touches.length >= MAX_LEVEL_DOTS) break outer;
        }
      }
    }
  }

  return (
    <div style={{ ...card, padding: 18 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginBottom: 10,
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: 12, color: T.sub, marginRight: 4 }}>
          Price levels:
        </span>
        {LEVELS.map((l) => (
          <button
            key={l}
            onClick={() => setLevel(level === l ? null : l)}
            style={{
              ...(level === l ? btn.primary : btn.outline),
              ...monoText,
              fontSize: 11,
              padding: "3px 9px",
            }}
          >
            {fmtCents(l)}
          </button>
        ))}
        {level != null && (
          <span style={{ ...monoText, fontSize: 12, color: T.sub }}>
            {touches.length}
            {touches.length >= MAX_LEVEL_DOTS ? "+" : ""} touches of{" "}
            {fmtCents(level)}
          </span>
        )}
      </div>

      <ResponsiveContainer width="100%" height={360}>
        <LineChart
          data={ticks}
          margin={{ top: 8, right: 12, bottom: 0, left: -12 }}
        >
          <CartesianGrid
            stroke={T.border}
            strokeOpacity={0.6}
            vertical={false}
          />
          <XAxis
            dataKey="ts"
            type="number"
            domain={["dataMin", "dataMax"]}
            tickFormatter={fmtTime}
            tick={{ fontFamily: T.mono, fontSize: 11, fill: T.sub }}
            stroke={T.border}
            minTickGap={48}
          />
          <YAxis
            domain={[0, 100]}
            ticks={[0, 10, 15, 20, 25, 30, 40, 50, 75, 100]}
            tickFormatter={(v) => `${v}¢`}
            tick={{ fontFamily: T.mono, fontSize: 11, fill: T.sub }}
            stroke={T.border}
          />
          <Tooltip content={<ChartTooltip timeline={timeline} />} />
          {LEVELS.map((l) => (
            <ReferenceLine
              key={l}
              y={l}
              stroke={l === level ? T.ink : "#8B929E"}
              strokeWidth={l === level ? 1.8 : 1}
              strokeDasharray="4 4"
            />
          ))}
          {trackedSince && (
            <ReferenceLine
              x={trackedSince}
              stroke={T.faint}
              strokeDasharray="4 3"
              label={{
                value: `tracking started ${fmtDate(trackedSince)}`,
                position: "insideTopLeft",
                fontFamily: T.mono,
                fontSize: 10,
                fill: T.sub,
              }}
            />
          )}
          {outcomes.map((label, i) => (
            <Line
              key={label}
              type="monotone"
              dataKey={label}
              stroke={T.series[i % T.series.length]}
              strokeWidth={1.8}
              dot={false}
              isAnimationActive={false}
            />
          ))}
          {touches.map((t, i) => (
            <ReferenceDot
              key={`touch-${i}`}
              x={t.ts}
              y={t.price}
              r={3}
              fill={t.color}
              stroke="#fff"
              strokeWidth={1}
            />
          ))}
          {outcomes.map(
            (o, i) =>
              latest[o] && (
                <ReferenceDot
                  key={`latest-${o}`}
                  x={latest[o].ts}
                  y={latest[o].price}
                  r={5}
                  fill={T.series[i % T.series.length]}
                  stroke="#fff"
                  strokeWidth={2}
                />
              ),
          )}
          <Brush
            key={`${ticks.length}-${ticks[0]?.ts ?? 0}`}
            dataKey="ts"
            height={28}
            travellerWidth={12}
            stroke={T.series[0]}
            fill="#EFF6FF"
            startIndex={startIndex}
            endIndex={endIndex}
            tickFormatter={fmtTime}
            onChange={(e) => {
              if (onWindowChange && ticks[e.startIndex] && ticks[e.endIndex]) {
                onWindowChange([ticks[e.startIndex].ts, ticks[e.endIndex].ts]);
              }
            }}
          />
        </LineChart>
      </ResponsiveContainer>
      <div style={{ fontSize: 12, color: T.faint, marginTop: 8 }}>
        Hover for exact prices · drag the blue slider edges to zoom a time
        range · click a price level above to mark every touch of that line ·
        the big dots are the current price.
      </div>
    </div>
  );
}
