import { useEffect, useMemo, useRef, useState } from "react";
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
  ReferenceArea,
} from "recharts";
import { T, card, monoText, btn } from "../theme.js";
import { fmtCents, fmtDate, fmtTime, fmtTimestamp } from "../utils.js";
import { estimateLag, attributeMoves, moveAt } from "../mlbLag.js";

const LEVELS = [10, 15, 20, 25, 30, 40, 50]; // cents
const MAX_LEVEL_DOTS = 300;

// The play in effect at time `ts`, corrected for feed lag: the market saw a
// play ~lagMs before the API stamped it, so we compare against p.start - lagMs.
function stateAt(plays, ts, lagMs = 0) {
  if (!plays || !plays.length || ts == null) return null;
  let found = null;
  for (const p of plays) {
    if (p.start - lagMs <= ts) found = p;
    else break;
  }
  return found;
}

// Tooltip: the prices at the hovered point, plus (for MLB) the game state at
// that moment — score, inning, pitcher (with ERA) and batter.
function ChartTooltip({ active, payload, label, timeline, lagMs = 0, attributed }) {
  if (!active || !payload || !payload.length) return null;
  const play = stateAt(timeline?.plays, label, lagMs);
  const cause = moveAt(attributed, label);
  return (
    <div style={{ ...monoText, fontSize: 12, background: "#fff",
      border: `1px solid ${T.border}`, borderRadius: 8, padding: "8px 10px" }}>
      <div style={{ color: T.sub, marginBottom: 4 }}>{fmtTimestamp(label)}</div>
      {payload.map((p) => (
        <div key={p.dataKey} style={{ color: p.color }}>
          {p.dataKey}: {p.value != null ? fmtCents(p.value) : "—"}
        </div>
      ))}
      {cause && (
        <div style={{ marginTop: 6, paddingTop: 5, borderTop: `1px solid ${T.border}`,
          background: "#FFF8E1", margin: "6px -10px 0", padding: "6px 10px" }}>
          <div style={{ ...monoText, fontSize: 10, color: T.sub, textTransform: "uppercase" }}>
            price moved {cause.total.toFixed(1)}¢ — caused by
          </div>
          <div style={{ fontWeight: 800, fontSize: 13, color: T.ink, marginTop: 1 }}>
            {cause.play.event}
            {cause.play.rbi > 0 ? ` · ${cause.play.rbi} RBI` : ""}
          </div>
          {cause.play.desc && (
            <div style={{ fontSize: 11, color: T.sub, marginTop: 2, maxWidth: 300 }}>
              {cause.play.desc}
            </div>
          )}
          <div style={{ ...monoText, fontSize: 10, color: T.faint, marginTop: 2 }}>
            market moved {(cause.lead / 1000).toFixed(1)}s before MLB recorded it
          </div>
        </div>
      )}
      {play && (
        <div style={{ marginTop: 6, paddingTop: 5, borderTop: `1px solid ${T.border}` }}>
          {play.awayScore != null && (
            <div style={{ fontWeight: 700, fontSize: 14, color: T.ink }}>
              {timeline.away} {play.awayScore} – {play.homeScore} {timeline.home}
            </div>
          )}
          <div style={{ fontWeight: 700, color: T.ink }}>
            {play.half === "top" ? "▲ Top" : "▼ Bot"} {play.inning}
          </div>
          {play.pitcher && (
            <div style={{ color: T.sub }}>
              Pitching: {play.pitcher}{play.era ? ` (${play.era} ERA)` : ""}
            </div>
          )}
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
  const lagOverride = null; // the measured value is used as-is
  const [showInnings, setShowInnings] = useState(true);

  // The brush fires on every pixel of a drag. Pushing each one straight into
  // state re-rendered thousands of points and fed the indexes back into the
  // brush mid-drag, which made it feel slow and jumpy — so settle first.
  const brushTimer = useRef(null);
  const dragging = useRef(false);
  useEffect(() => () => clearTimeout(brushTimer.current), []);
  function onBrush(e) {
    if (!onWindowChange || !ticks[e.startIndex] || !ticks[e.endIndex]) return;
    dragging.current = true;
    clearTimeout(brushTimer.current);
    const from = ticks[e.startIndex].ts;
    const to = ticks[e.endIndex].ts;
    brushTimer.current = setTimeout(() => {
      dragging.current = false;
      onWindowChange([from, to]);
    }, 180);
  }

  // How far the MLB feed trails the market for this game (see mlbLag.js).
  const autoLag = useMemo(
    () => estimateLag(ticks, timeline?.plays, outcomes),
    [ticks, timeline, outcomes],
  );
  const lagMs = lagOverride ?? autoLag?.lagMs ?? 0;

  // Which play caused each burst of price movement (see mlbLag.js)
  const attributed = useMemo(
    () => attributeMoves(ticks, timeline?.plays, outcomes),
    [ticks, timeline, outcomes],
  );
  // the meaningful ones get a marker on the line
  const marked = useMemo(() => {
    if (!attributed.length) return [];
    const cut = Math.max(3, [...attributed].sort((a, b) => b.total - a.total)[
      Math.floor(attributed.length * 0.2)
    ]?.total ?? 3);
    return attributed.filter((m) => m.total >= cut).slice(0, 40);
  }, [attributed]);

  // Each half-inning as one band on the time axis, shifted back by the feed lag
  // so it sits over the price movement it actually caused.
  const innings = useMemo(() => {
    const plays = timeline?.plays;
    if (!plays?.length) return [];
    const segs = [];
    for (const p of plays) {
      const last = segs[segs.length - 1];
      if (last && last.inning === p.inning && last.half === p.half) {
        last.end = Math.max(last.end, p.end);
      } else {
        segs.push({ inning: p.inning, half: p.half, start: p.start, end: p.end });
      }
    }
    return segs.map((s) => ({
      ...s,
      key: `${s.inning}-${s.half}`,
      label: (s.half === "top" ? "T" : "B") + s.inning,
      start: s.start - lagMs,
      end: s.end - lagMs,
    }));
  }, [timeline, lagMs]);

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
          {/* half-inning bands sit behind the price lines */}
          {showInnings && innings.map((s, i) => (
            <ReferenceArea
              key={s.key}
              x1={s.start}
              x2={s.end}
              ifOverflow="hidden"
              fill={s.half === "top" ? T.series[0] : T.series[1]}
              fillOpacity={0.07}
              stroke={T.border}
              strokeOpacity={0.5}
              label={{
                value: s.label,
                position: "insideTop",
                fontFamily: T.mono,
                fontSize: 9,
                fill: T.sub,
              }}
            />
          ))}
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
          <Tooltip content={<ChartTooltip timeline={timeline} lagMs={lagMs} attributed={attributed} />} />
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
              // backfilled history stores each outcome a second apart, so a row
              // can hold only one side's price; join across those gaps instead
              // of shattering the line into disconnected segments
              connectNulls
            />
          ))}
          {/* a tick under each price move we can name a cause for */}
          {showInnings && marked.map((m, i) => (
            <ReferenceLine
              key={`cause-${i}`}
              x={m.centre ?? m.start}
              stroke={m.play?.scoring ? T.green : T.faint}
              strokeWidth={m.play?.scoring ? 1.6 : 1}
              strokeDasharray={m.play?.scoring ? undefined : "2 3"}
              ifOverflow="hidden"
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
            // keyed on the series identity only — keying on ticks.length
            // remounted (and re-seated) the brush on every new tick
            key={ticks[0]?.ts ?? 0}
            dataKey="ts"
            height={28}
            travellerWidth={12}
            stroke={T.series[0]}
            fill="#EFF6FF"
            startIndex={startIndex}
            endIndex={endIndex}
            tickFormatter={fmtTime}
            onChange={onBrush}
          />
        </LineChart>
      </ResponsiveContainer>
      {timeline?.game_pk && !timeline?.plays?.length && (
        <div style={{ marginTop: 10, fontSize: 12, color: T.sub }}>
          <span style={{ fontWeight: 600, color: T.ink }}>MLB game state:</span>{" "}
          not started yet — the inning, pitcher and batter appear on hover once
          the game is under way.
        </div>
      )}
      {timeline?.plays?.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10,
          fontSize: 12, color: T.sub, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 600, color: T.ink }}>MLB feed lag:</span>
          <span style={{ ...monoText }}>≈{(lagMs / 1000).toFixed(1)}s typical</span>
          <span style={{ color: T.faint }}>
            {lagOverride != null
              ? "(set by hand)"
              : autoLag
                ? `· big moves start ~${(autoLag.leadMs / 1000).toFixed(0)}s before the play is recorded `
                  + `(measured from ${autoLag.samples} reactions in this game)`
                : "(not enough price movement to measure)"}
          </span>
          <button
            onClick={() => setShowInnings((v) => !v)}
            title="Shade each half-inning on the chart (lag-corrected)"
            style={{ ...(showInnings ? btn.primary : btn.outline), fontSize: 11,
              padding: "2px 10px", marginLeft: 6 }}
          >
            {showInnings ? "✓ Innings" : "Innings"}
          </button>
        </div>
      )}
      <div style={{ fontSize: 12, color: T.faint, marginTop: 8 }}>
        Hover for exact prices · drag the blue slider edges to zoom a time
        range · click a price level above to mark every touch of that line ·
        the big dots are the current price.
        {timeline?.plays?.length > 0 &&
          " The MLB feed reports a play a few seconds after it happens, so the game state is shifted back by the measured lag to line up with the price move it caused."}
      </div>
    </div>
  );
}
