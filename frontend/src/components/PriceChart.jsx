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
} from "recharts";
import { T, card, monoText } from "../theme.js";
import { fmtDate, fmtTime, fmtTimestamp } from "../utils.js";

export default function PriceChart({ ticks, outcomes, trackedSince }) {
  return (
    <div style={{ ...card, padding: 18 }}>
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
            domain={[0, 1]}
            ticks={[0, 0.25, 0.5, 0.75, 1]}
            tickFormatter={(v) => v.toFixed(2)}
            tick={{ fontFamily: T.mono, fontSize: 11, fill: T.sub }}
            stroke={T.border}
          />
          <Tooltip
            labelFormatter={fmtTimestamp}
            formatter={(value) => (value != null ? value.toFixed(3) : "—")}
            contentStyle={{
              ...monoText,
              fontSize: 12,
              border: `1px solid ${T.border}`,
              borderRadius: 8,
            }}
          />
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
          <Brush
            dataKey="ts"
            height={26}
            travellerWidth={8}
            stroke={T.border}
            tickFormatter={fmtTime}
          />
        </LineChart>
      </ResponsiveContainer>
      <div style={{ fontSize: 12, color: T.faint, marginTop: 8 }}>
        Hover the chart for exact prices · drag the strip below the plot to
        zoom · left of the dashed line is backfilled 1-min history, right of
        it is live polling.
      </div>
    </div>
  );
}
