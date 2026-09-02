import { useState } from "react";
import { T, card, btn, monoText } from "../../theme.js";

// Favorite Lost Set One — slams 2020-2026. A frozen study written by
// backend/backtest/tennis.py: every match where a de-vigged 60c+ favorite
// dropped the FIRST SET, and whether they still won. ATP and WTA are the
// two worlds of this strategy (best-of-5 recovers, best-of-3 mostly
// doesn't), so the tour toggle is the main control. Shaped like the other
// study cards: collapsed by default, +/- to expand, ⚙ for settings.

const th = {
  textAlign: "right", padding: "6px 10px", fontSize: 11, fontWeight: 600,
  color: T.sub, borderBottom: `1px solid ${T.line}`, whiteSpace: "nowrap",
};
const td = { ...monoText, textAlign: "right", padding: "5px 10px", fontSize: 13, whiteSpace: "nowrap" };
const money = (v) => (
  <span style={{ color: v >= 0 ? T.green : T.red }}>
    {v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(0)}
  </span>
);

function Row({ name, b, onClick, opened, total }) {
  if (!b || !b.spots) return null;
  return (
    <tr
      onClick={onClick}
      style={{
        ...(onClick ? { cursor: "pointer" } : null),
        ...(total ? { borderTop: `2px solid ${T.line}` } : null),
      }}
      title={onClick ? "Show the matches" : undefined}>
      <td style={{ ...td, textAlign: "left", fontWeight: 600 }}>
        {onClick && <span style={{ color: T.faint }}>{opened ? "−" : "+"}</span>} {name}
      </td>
      <td style={td}>{b.spots}</td>
      <td style={{ ...td, color: T.green }}>{b.fav_won}</td>
      <td style={{ ...td, color: T.red }}>{b.spots - b.fav_won}</td>
      <td style={td}>{b.win_rate != null ? `${b.win_rate}%` : "—"}</td>
      <td style={td}>{b.avg_fav_p != null ? `${b.avg_fav_p}¢` : "—"}</td>
      <td style={td}>{b.priced || 0}</td>
      <td style={td}>{b.avg_at45 != null ? `${b.avg_at45}¢` : "—"}</td>
      <td style={td}>{b.priced ? money(b.pnl100_fees) : "—"}</td>
    </tr>
  );
}

function SlamGames({ games }) {
  return (
    <tr>
      <td colSpan={9} style={{ padding: "2px 10px 10px 26px" }}>
        <table style={{ borderCollapse: "collapse" }}>
          <tbody>
            {games.map((g, i) => (
              <tr key={i} style={{ color: T.sub, fontSize: 12 }}>
                <td style={{ ...monoText, padding: "1px 10px 1px 0", fontSize: 12 }}>{g.date}</td>
                <td style={{ padding: "1px 10px 1px 0" }}>{g.fav} <span style={{ color: T.faint }}>vs</span> {g.opp}</td>
                <td style={{ ...monoText, padding: "1px 10px 1px 0", fontSize: 12, color: T.faint }}>{g.round}</td>
                <td style={{ ...monoText, padding: "1px 10px 1px 0", fontSize: 12 }}>
                  {Math.round(g.fav_p * 100)}¢ pre
                </td>
                <td style={{ ...monoText, padding: "1px 10px 1px 0", fontSize: 12 }}>set 1: {g.score_s1}</td>
                <td style={{
                  ...monoText, padding: "1px 10px 1px 0", fontSize: 12, fontWeight: 700,
                  color: g.fav_won ? T.green : T.red,
                }}>{g.fav_won ? "WON" : "LOST"}</td>
                <td style={{ ...monoText, padding: "1px 0", fontSize: 12 }}>
                  {g.poly && g.poly.at45 != null ? `${g.poly.at45}¢ @+45'` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </td>
    </tr>
  );
}

export default function TennisSetOne({ data }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [tour, setTour] = useState("ATP");
  const [slamOpen, setSlamOpen] = useState({});
  const { meta, byTour } = data;
  const d = byTour[tour];
  if (!d) return null;
  const o = d.overall;

  return (
    <div style={{ ...card, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px" }}>
        <button
          onClick={() => setOpen((x) => !x)}
          title={open ? "Collapse" : "Expand"}
          style={{ ...btn.outline, fontSize: 14, padding: "1px 8px", lineHeight: 1.4 }}
        >
          {open ? "−" : "+"}
        </button>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontFamily: T.ui, fontSize: 15, fontWeight: 600 }}>
            Favorite Lost Set One — Slams
            <span style={{ fontWeight: 400, color: T.sub, fontSize: 12, marginLeft: 8 }}>
              {tour} · {o.spots} spots · favorite recovered {o.win_rate}%
            </span>
          </div>
          <div style={{ fontSize: 12, color: T.sub, marginTop: 2 }}>
            {meta.years[0]}–{meta.years[1]} · {meta.slams.join(" / ")} · 60¢+
            favorites (de-vigged odds) who dropped the first set · frozen study
          </div>
        </div>
        <button
          onClick={() => setEditing((e) => !e)}
          style={{ ...btn.outline, fontSize: 13, padding: "7px 14px", whiteSpace: "nowrap" }}
        >
          ⚙ Adjust settings
        </button>
      </div>

      {editing && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "0 16px 12px" }}>
          <span style={{ fontSize: 12, color: T.sub }}>Tour:</span>
          {["ATP", "WTA"].map((t) => (
            <button
              key={t}
              onClick={() => { setTour(t); setOpen(true); }}
              style={{ ...(t === tour ? btn.green : btn.outline), fontSize: 13, padding: "4px 12px" }}
            >
              {t}
            </button>
          ))}
          <span style={{ fontSize: 11, color: T.faint }}>
            ATP is best-of-5 (room to recover) · WTA is best-of-3 (one set from elimination)
          </span>
        </div>
      )}

      {open && (
        <div style={{ padding: "0 16px 14px" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", minWidth: 640 }}>
              <thead>
                <tr>
                  <th style={{ ...th, textAlign: "left" }}>{tour}</th>
                  <th style={th}>Spots</th>
                  <th style={th}>Recovered</th>
                  <th style={th}>Lost</th>
                  <th style={th}>Win rate</th>
                  <th style={th} title="average de-vigged pre-match strength of the favorite">Avg pre-match</th>
                  <th style={th} title="2024+ matches with a usable Polymarket price">Priced</th>
                  <th style={th} title="favorite's price ~45min after the scheduled start — approximate, see the note">Avg @+45'</th>
                  <th style={th} title="$100 flat at the +45' price, taker fee charged — see the note before trusting this">P&amp;L (approx)</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(d.bySlam).map(([slam, b]) => [
                  <Row key={slam} name={slam} b={b} opened={slamOpen[slam]}
                    onClick={() => setSlamOpen((s) => ({ ...s, [slam]: !s[slam] }))} />,
                  slamOpen[slam] && (
                    <SlamGames key={slam + ":games"}
                      games={d.games.filter((g) => g.slam === slam)} />
                  ),
                ])}
                <Row name="Total" b={o} total />
              </tbody>
            </table>
          </div>
          <div style={{ overflowX: "auto", marginTop: 10 }}>
            <table style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ ...th, textAlign: "left" }}>Year</th>
                  {Object.keys(d.byYear).map((y) => <th key={y} style={th}>{y}</th>)}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ ...td, textAlign: "left", color: T.sub }}>win rate</td>
                  {Object.values(d.byYear).map((b, i) => (
                    <td key={i} style={td}>{b.win_rate}%</td>
                  ))}
                </tr>
                <tr>
                  <td style={{ ...td, textAlign: "left", color: T.sub }}>spots</td>
                  {Object.values(d.byYear).map((b, i) => (
                    <td key={i} style={{ ...td, color: T.faint }}>{b.spots}</td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 11, color: T.faint, marginTop: 8 }}>
            Win rates come from complete match data (tennis-data.co.uk, de-vigged
            average odds define the 60¢+ favorite) and are solid. The priced columns
            are approximate and thin: Polymarket only lists slams from 2024 (late
            rounds only that year), and {meta.price_note}. Tennis courts run late,
            so some +45&apos; samples predate the set-one loss — treat the P&amp;L as
            indicative, not settled. Break-even price for backing the favorite after
            a set-one loss ≈ their recovery rate: ~52¢ ATP, ~36¢ WTA.
          </div>
        </div>
      )}
    </div>
  );
}
