import { useEffect, useState } from "react";
import { T, card, label, monoText, page, btn } from "../theme.js";
import { fmtCents, fmtTimestamp, fmtVolume } from "../utils.js";
import { fetchScreener, lookupEvent, trackSelected } from "../api/client.js";
import ScreenerPanel from "../components/ScreenerPanel.jsx";

const SPORTS = ["Soccer"]; // more sports are a paid follow-on
const DATE_RANGES = ["Any", "Today", "Tomorrow", "This week", "Custom"];
const REFRESH_OPTIONS = [
  { label: "Off", seconds: 0 },
  { label: "30s", seconds: 30 },
  { label: "1m", seconds: 60 },
  { label: "5m", seconds: 300 },
];
const EMPTY_FILTERS = {
  minVolume: "",
  homeMin: "",
  homeMax: "",
  drawMin: "",
  drawMax: "",
  awayMin: "",
  awayMax: "",
  dateRange: "Any",
  customFrom: "",
  customTo: "",
};

const chipBtn = (active) => ({
  ...(active ? btn.primary : btn.outline),
  fontSize: 12,
  padding: "6px 12px",
});

const input = {
  ...monoText,
  fontSize: 13,
  padding: "7px 10px",
  border: `1px solid ${T.border}`,
  borderRadius: 8,
  color: T.ink,
  width: 90,
};

const th = {
  ...label,
  position: "sticky",
  top: 0,
  background: T.soft,
  padding: "9px 14px",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const td = { ...monoText, fontSize: 13, padding: "9px 14px" };

// Is a kickoff inside the selected date range?
function inDateRange(kickoff, f) {
  if (f.dateRange === "Any") return true;
  if (kickoff == null) return false;
  const day = 24 * 3600 * 1000;
  const midnight = new Date().setHours(0, 0, 0, 0);
  if (f.dateRange === "Today") return kickoff < midnight + day;
  if (f.dateRange === "Tomorrow")
    return kickoff >= midnight + day && kickoff < midnight + 2 * day;
  if (f.dateRange === "This week") return kickoff < midnight + 7 * day;
  const from = f.customFrom ? Date.parse(f.customFrom) : -Infinity;
  const to = f.customTo ? Date.parse(f.customTo) + day : Infinity;
  return kickoff >= from && kickoff <= to;
}

// A price passes when it is inside the bounds; unquoted prices only pass
// when no bound is set for that column.
function between(value, min, max) {
  if (value == null) return !min && !max;
  return (!min || value >= Number(min)) && (!max || value <= Number(max));
}

function matchesFilters(m, f, league) {
  if (league && m.league !== league) return false;
  if (f.minVolume && m.volume < Number(f.minVolume)) return false;
  if (!between(m.homePrice, f.homeMin, f.homeMax)) return false;
  if (!between(m.drawPrice, f.drawMin, f.drawMax)) return false;
  if (!between(m.awayPrice, f.awayMin, f.awayMax)) return false;
  return inDateRange(m.kickoff, f);
}

export default function Screener({ onTracked }) {
  const [data, setData] = useState(null); // {rows, leagues, updatedAt}
  const [error, setError] = useState(null);
  const [league, setLeague] = useState(null); // one league, null = all
  const [draft, setDraft] = useState(EMPTY_FILTERS); // what the user is typing
  const [applied, setApplied] = useState(EMPTY_FILTERS); // what the table uses
  const [sort, setSort] = useState({ key: "volume", dir: "desc" });
  const [refreshSecs, setRefreshSecs] = useState(0);
  const [tracked, setTracked] = useState(new Set()); // slugs tracked just now
  const [trackBusy, setTrackBusy] = useState(null); // slug whose props are loading
  const [picker, setPicker] = useState(null); // {row, results} chooser state
  const [pickerBusy, setPickerBusy] = useState(false);
  const [presets, setPresets] = useState(() =>
    JSON.parse(localStorage.getItem("screenerPresets") || "[]"),
  );

  async function load() {
    try {
      setData(await fetchScreener("soccer"));
      setError(null);
    } catch (e) {
      setError(`Could not load markets: ${e.message}`);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // auto-refresh pulls fresh prices on the chosen interval
  useEffect(() => {
    if (!refreshSecs) return;
    const id = setInterval(load, refreshSecs * 1000);
    return () => clearInterval(id);
  }, [refreshSecs]);

  // Track opens a chooser with every prop of the match. The extra props
  // (spreads, totals) live in a twin event whose slug is always the match
  // slug plus "-more-markets"; if that twin does not exist we just show
  // the winner and draw props.
  async function openPicker(row) {
    setTrackBusy(row.slug);
    try {
      const settled = await Promise.allSettled([
        lookupEvent(row.slug),
        lookupEvent(`${row.slug}-more-markets`),
      ]);
      const results = [];
      for (const s of settled) {
        if (s.status !== "fulfilled") continue;
        for (const m of s.value.markets) {
          results.push({
            eventSlug: s.value.slug,
            eventTitle: s.value.title,
            conditionId: m.conditionId,
            question: m.question,
            kind: m.kind,
            outcomes: m.outcomes.map((name) => ({ label: name })),
          });
        }
      }
      if (results.length === 0) throw new Error("no props found");
      setPicker({ row, results });
      window.scrollTo(0, 0); // the chooser opens at the top of the page
    } catch (e) {
      setError(`Could not load props: ${e.message}`);
    } finally {
      setTrackBusy(null);
    }
  }

  async function trackPicked(conditionIds) {
    setPickerBusy(true);
    try {
      const bySlug = {};
      for (const r of picker.results) {
        if (conditionIds.includes(r.conditionId)) {
          (bySlug[r.eventSlug] ??= []).push(r.conditionId);
        }
      }
      for (const [slug, ids] of Object.entries(bySlug)) {
        await trackSelected(slug, ids);
      }
      setTracked((prev) => new Set(prev).add(picker.row.slug));
      onTracked?.(); // dashboard picks the new markets up right away
      setPicker(null);
    } catch (e) {
      setError(`Tracking failed: ${e.message}`);
    } finally {
      setPickerBusy(false);
    }
  }

  function sortBy(key) {
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "desc" },
    );
  }

  function savePreset() {
    const name = prompt("Name this filter preset:");
    if (!name) return;
    const next = [
      ...presets.filter((p) => p.name !== name),
      { name, filters: draft, league },
    ];
    setPresets(next);
    localStorage.setItem("screenerPresets", JSON.stringify(next));
  }

  function loadPreset(p) {
    setDraft(p.filters);
    setApplied(p.filters);
    // p.leagues covers presets saved before leagues became single-select
    setLeague(p.league ?? p.leagues?.[0] ?? null);
  }

  function removePreset(name) {
    const next = presets.filter((p) => p.name !== name);
    setPresets(next);
    localStorage.setItem("screenerPresets", JSON.stringify(next));
  }

  const rows = data?.rows ?? [];
  const visible = rows
    .filter((m) => matchesFilters(m, applied, league))
    .sort((a, b) => {
      const dir = sort.dir === "asc" ? 1 : -1;
      if (sort.key === "match") return dir * a.home.localeCompare(b.home);
      if (sort.key === "league") return dir * a.league.localeCompare(b.league);
      return dir * ((a[sort.key] ?? -Infinity) - (b[sort.key] ?? -Infinity));
    });

  const arrow = (key) =>
    sort.key === key ? (sort.dir === "asc" ? " ↑" : " ↓") : "";

  const field = (key, placeholder) => (
    <input
      value={draft[key]}
      onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
      placeholder={placeholder}
      style={input}
    />
  );

  return (
    <main style={page}>
      <div>
        <div style={{ fontSize: 20, fontWeight: 600 }}>Market screener</div>
        <div style={{ fontSize: 13, color: T.sub, marginTop: 2 }}>
          Browse every match on Polymarket and filter down to the ones worth
          tracking.
        </div>
      </div>

      {error && <div style={{ fontSize: 13, color: T.red }}>⚠ {error}</div>}

      {picker && (
        <ScreenerPanel
          results={picker.results}
          onTrack={trackPicked}
          onCancel={() => setPicker(null)}
          busy={pickerBusy}
          title={`${picker.row.home} vs ${picker.row.away} — choose the props to track`}
          emptyText="No props found for this match."
        />
      )}

      {/* sport, then leagues discovered from the live data */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: T.sub }}>Sport:</span>
        {SPORTS.map((s) => (
          <button key={s} style={chipBtn(true)}>
            {s}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: T.sub }}>League:</span>
        <button onClick={() => setLeague(null)} style={chipBtn(league === null)}>
          All leagues
        </button>
        {(data?.leagues ?? []).map((l) => (
          <button
            key={l}
            onClick={() => setLeague(l === league ? null : l)}
            style={chipBtn(league === l)}
          >
            {l}
          </button>
        ))}
      </div>

      {/* filters */}
      <div style={{ ...card, background: T.soft, padding: 18 }}>
        <div style={label}>Filters</div>
        <div
          style={{
            display: "flex",
            gap: 22,
            flexWrap: "wrap",
            alignItems: "flex-end",
            marginTop: 12,
          }}
        >
          <div>
            <div style={{ fontSize: 12, color: T.sub, marginBottom: 5 }}>
              Minimum volume ($)
            </div>
            {field("minVolume", "50000")}
          </div>
          {[
            ["Home price (¢)", "homeMin", "homeMax"],
            ["Draw price (¢)", "drawMin", "drawMax"],
            ["Away price (¢)", "awayMin", "awayMax"],
          ].map(([title, minKey, maxKey]) => (
            <div key={minKey}>
              <div style={{ fontSize: 12, color: T.sub, marginBottom: 5 }}>
                {title}
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                {field(minKey, "min")}
                <span style={{ color: T.faint }}>to</span>
                {field(maxKey, "max")}
              </div>
            </div>
          ))}
          <div>
            <div style={{ fontSize: 12, color: T.sub, marginBottom: 5 }}>
              Kickoff
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {DATE_RANGES.map((d) => (
                <button
                  key={d}
                  onClick={() => setDraft({ ...draft, dateRange: d })}
                  style={chipBtn(draft.dateRange === d)}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
          {draft.dateRange === "Custom" && (
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="date"
                value={draft.customFrom}
                onChange={(e) => setDraft({ ...draft, customFrom: e.target.value })}
                style={{ ...input, width: 150 }}
              />
              <span style={{ color: T.faint }}>to</span>
              <input
                type="date"
                value={draft.customTo}
                onChange={(e) => setDraft({ ...draft, customTo: e.target.value })}
                style={{ ...input, width: 150 }}
              />
            </div>
          )}
        </div>

        <div
          style={{
            display: "flex",
            gap: 10,
            marginTop: 16,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <button
            onClick={() => setApplied(draft)}
            style={{ ...btn.primary, fontSize: 13, padding: "9px 18px" }}
          >
            Apply filters
          </button>
          <button
            onClick={() => {
              setDraft(EMPTY_FILTERS);
              setApplied(EMPTY_FILTERS);
              setLeague(null);
            }}
            style={{ ...btn.ghost, fontSize: 13, padding: "9px 14px" }}
          >
            Reset
          </button>
          <button
            onClick={savePreset}
            style={{ ...btn.outline, fontSize: 13, padding: "9px 14px" }}
          >
            Save as preset
          </button>
          {presets.map((p) => (
            <span
              key={p.name}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                border: `1px solid ${T.border}`,
                background: "#fff",
                borderRadius: 999,
                padding: "5px 6px 5px 12px",
                fontSize: 12,
              }}
            >
              <span onClick={() => loadPreset(p)} style={{ cursor: "pointer" }}>
                {p.name}
              </span>
              <button
                onClick={() => removePreset(p.name)}
                title="Delete preset"
                style={{ ...btn.ghost, fontSize: 12, padding: "0 4px", color: T.faint }}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      </div>

      {/* result count + auto refresh */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, color: T.sub }}>
          <strong style={{ color: T.ink }}>{visible.length}</strong> of{" "}
          {rows.length} matches
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: T.sub }}>Auto-refresh:</span>
        {REFRESH_OPTIONS.map((o) => (
          <button
            key={o.label}
            onClick={() => setRefreshSecs(o.seconds)}
            style={chipBtn(refreshSecs === o.seconds)}
          >
            {o.label}
          </button>
        ))}
        {data?.updatedAt && (
          <span style={{ ...monoText, fontSize: 12, color: T.faint }}>
            prices updated {fmtTimestamp(data.updatedAt).slice(11)} UTC
          </span>
        )}
      </div>

      {/* results */}
      <div style={{ ...card, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: "left" }} onClick={() => sortBy("match")}>
                  Match{arrow("match")}
                </th>
                <th style={{ ...th, textAlign: "left" }} onClick={() => sortBy("league")}>
                  League{arrow("league")}
                </th>
                <th style={{ ...th, textAlign: "left" }} onClick={() => sortBy("kickoff")}>
                  Kickoff (UTC){arrow("kickoff")}
                </th>
                <th style={{ ...th, textAlign: "right" }} onClick={() => sortBy("volume")}>
                  Volume{arrow("volume")}
                </th>
                <th
                  style={{ ...th, textAlign: "right", color: T.series[0] }}
                  onClick={() => sortBy("homePrice")}
                >
                  Home{arrow("homePrice")}
                </th>
                <th
                  style={{ ...th, textAlign: "right", color: T.series[1] }}
                  onClick={() => sortBy("drawPrice")}
                >
                  Draw{arrow("drawPrice")}
                </th>
                <th
                  style={{ ...th, textAlign: "right", color: T.series[2] }}
                  onClick={() => sortBy("awayPrice")}
                >
                  Away{arrow("awayPrice")}
                </th>
                <th style={{ ...th, textAlign: "right" }} />
              </tr>
            </thead>
            <tbody>
              {visible.map((m) => (
                <tr key={m.slug} className="mkt-row" style={{ borderTop: `1px solid ${T.border}` }}>
                  <td style={{ ...td, fontFamily: T.ui, fontWeight: 500 }}>
                    {m.home} vs {m.away}
                  </td>
                  <td style={{ ...td, fontFamily: T.ui, color: T.sub, fontSize: 13 }}>
                    {m.league}
                  </td>
                  <td style={{ ...td, color: T.sub }}>
                    {m.kickoff ? fmtTimestamp(m.kickoff) : "—"}
                  </td>
                  <td style={{ ...td, textAlign: "right" }}>{fmtVolume(m.volume)}</td>
                  {[
                    ["homePrice", T.series[0]],
                    ["drawPrice", T.series[1]],
                    ["awayPrice", T.series[2]],
                  ].map(([key, color]) => (
                    <td key={key} style={{ ...td, textAlign: "right", color }}>
                      {m[key] != null ? fmtCents(m[key]) : "—"}
                    </td>
                  ))}
                  <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                    {tracked.has(m.slug) ? (
                      <button disabled style={{ ...btn.outline, fontSize: 12, padding: "6px 10px" }}>
                        Tracked ✓
                      </button>
                    ) : (
                      <button
                        onClick={() => openPicker(m)}
                        disabled={trackBusy === m.slug}
                        title="Choose which props of this match to track"
                        style={{ ...btn.green, fontSize: 12, padding: "6px 10px" }}
                      >
                        {trackBusy === m.slug ? "…" : "Track"}
                      </button>
                    )}{" "}
                    <a
                      href={`https://polymarket.com/event/${m.slug}`}
                      target="_blank"
                      rel="noreferrer"
                      style={{ ...btn.outline, fontSize: 12, padding: "6px 10px", textDecoration: "none" }}
                    >
                      Web ↗
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {data === null && !error && (
          <div style={{ padding: "28px 16px", fontSize: 13, color: T.faint }}>
            Loading markets…
          </div>
        )}
        {data !== null && visible.length === 0 && (
          <div style={{ padding: "28px 16px", fontSize: 13, color: T.faint }}>
            No markets match these filters. Widen the price ranges or lower the
            minimum volume.
          </div>
        )}
      </div>

      <div style={{ fontSize: 12, color: T.faint }}>
        Click any column heading to sort. Track opens the full list of the
        match's props so you choose exactly which ones to collect.
      </div>
    </main>
  );
}
