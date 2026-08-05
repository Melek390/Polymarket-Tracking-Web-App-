import { T, card, monoText } from "../../theme.js";
import EquityLine from "./EquityLine.jsx";

// The stats block under an expanded strategy: KPI row, equity curve, and the
// per-situation breakdown the client asked for ("79% on home teams at score X").
// Presentational only — numbers come in as props (mock for now).

const usd = (n) =>
  `${n < 0 ? "−" : "+"}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
const pct = (n) => `${(n * 100).toFixed(1)}%`;
const lbl = { fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, color: T.sub };

function Kpi({ title, value, color }) {
  return (
    <div style={{ minWidth: 110 }}>
      <div style={lbl}>{title}</div>
      <div style={{ ...monoText, fontSize: 20, fontWeight: 700, color: color || T.ink }}>{value}</div>
    </div>
  );
}

export default function StrategyStats({ stats }) {
  const s = stats;
  return (
    <div style={{ padding: "14px 16px", borderTop: `1px solid ${T.border}`, background: T.soft }}>
      <div style={{ display: "flex", gap: 28, flexWrap: "wrap" }}>
        <Kpi title="Win rate" value={pct(s.winRate)} color={s.winRate >= 0.5 ? T.green : T.red} />
        <Kpi title="P&L" value={usd(s.pnl)} color={s.pnl >= 0 ? T.green : T.red} />
        <Kpi title="Spots" value={s.spots} />
        <Kpi title="Wins" value={s.wins} />
        <Kpi title="Avg bounce" value={`${s.avgBounceCents}¢`} />
        <Kpi title="Avg hold" value={`${s.avgHoldHalfInnings} half-inn`} />
        <Kpi title="Max drawdown" value={usd(s.maxDrawdown)} color={T.red} />
      </div>

      <div style={{ ...lbl, margin: "14px 0 4px" }}>Equity curve (cumulative P&L)</div>
      <div style={{ ...card, padding: "8px 10px" }}>
        <EquityLine points={s.equity} />
      </div>

      <div style={{ ...lbl, margin: "14px 0 4px" }}>Where it wins — by situation</div>
      <div style={{ ...card, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["Situation", "Spots", "Win rate", "P&L"].map((h, i) => (
                <th key={h} style={{ ...lbl, padding: "8px 12px",
                  textAlign: i === 0 ? "left" : "right" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {s.bySituation.map((row) => (
              <tr key={row.label} style={{ borderTop: `1px solid ${T.border}` }}>
                <td style={{ fontFamily: T.ui, fontSize: 13, padding: "7px 12px" }}>{row.label}</td>
                <td style={{ ...monoText, fontSize: 13, padding: "7px 12px", textAlign: "right" }}>{row.spots}</td>
                <td style={{ ...monoText, fontSize: 13, padding: "7px 12px", textAlign: "right",
                  fontWeight: 700, color: row.winRate >= 0.5 ? T.green : T.red }}>
                  {pct(row.winRate)}
                </td>
                <td style={{ ...monoText, fontSize: 13, padding: "7px 12px", textAlign: "right",
                  color: row.pnl >= 0 ? T.green : T.red }}>
                  {usd(row.pnl)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
