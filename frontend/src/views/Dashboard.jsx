import { useState } from "react";
import StatsRow from "../components/StatsRow.jsx";
import AddEventBar from "../components/AddEventBar.jsx";
import EventPanel from "../components/EventPanel.jsx";
import ScreenerPanel from "../components/ScreenerPanel.jsx";
import MarketList from "../components/MarketList.jsx";
import { lookupEvent, screenMarkets, trackSelected } from "../api/client.js";
import { T, page, btn, monoText } from "../theme.js";
import { groupByEvent, marketStatus } from "../utils.js";

const PER_PAGE_OPTIONS = [10, 20, 30, 40, 50, 100];
const STATUS_FILTERS = ["all", "open", "paused", "closed"];
const VIEW_FILTERS = ["all", "single", "events"];
const VIEW_LABELS = { all: "All", single: "Single props", events: "Events only" };

// The home view: stats, search, filters, and the paginated market list.
export default function Dashboard({
  stats,
  markets,
  params,
  onNavigate,
  onToggle,
  onOpenHistory,
  onTracked,
  onDelete,
}) {
  const [eventResult, setEventResult] = useState(null);
  const [screenerResult, setScreenerResult] = useState(null);
  const [multiMode, setMultiMode] = useState(false);
  const [findBusy, setFindBusy] = useState(false);
  const [trackBusy, setTrackBusy] = useState(false);
  const [error, setError] = useState(null);

  // list controls live in the URL so pages and filters are shareable
  const status = STATUS_FILTERS.includes(params.get("status"))
    ? params.get("status")
    : "all";
  const view = VIEW_FILTERS.includes(params.get("view"))
    ? params.get("view")
    : "all";
  const perPage = PER_PAGE_OPTIONS.includes(Number(params.get("per")))
    ? Number(params.get("per"))
    : 20;
  const pageNum = Math.max(1, Number(params.get("page")) || 1);

  function setParams(patch) {
    const p = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      const isDefault =
        (key === "status" && value === "all") ||
        (key === "view" && value === "all") ||
        (key === "per" && value === 20) ||
        (key === "page" && value === 1);
      if (value == null || isDefault) p.delete(key);
      else p.set(key, value);
    }
    const query = p.toString();
    onNavigate(query ? `/?${query}` : "/");
    // a new page can be much shorter/taller than the old one — always start
    // it from the top instead of inheriting the previous scroll position
    window.scrollTo(0, 0);
  }

  const filtered =
    status === "all" ? markets : markets.filter((m) => marketStatus(m) === status);
  let groups = groupByEvent(filtered);
  // view filter: single-prop events vs multi-prop events
  if (view === "single") groups = groups.filter((g) => g.markets.length === 1);
  else if (view === "events") groups = groups.filter((g) => g.markets.length > 1);

  // open before paused before closed; within each band, newest-added on top
  const RANK = { open: 0, paused: 1, closed: 2 };
  for (const g of groups) {
    g.markets.sort((a, b) => {
      const byStatus = RANK[marketStatus(a)] - RANK[marketStatus(b)];
      if (byStatus) return byStatus;
      return b.createdAt - a.createdAt; // most recently added first
    });
  }
  groups.sort((a, b) => {
    const rankOf = (g) => Math.min(...g.markets.map((m) => RANK[marketStatus(m)]));
    const byRank = rankOf(a) - rankOf(b);
    if (byRank) return byRank;
    // newest-added group on top of its band
    const added = (g) => Math.max(...g.markets.map((m) => m.createdAt));
    return added(b) - added(a);
  });
  const totalPages = Math.max(1, Math.ceil(groups.length / perPage));
  const currentPage = Math.min(pageNum, totalPages);
  const pagedGroups = groups.slice(
    (currentPage - 1) * perPage,
    currentPage * perPage,
  );

  const counts = { all: markets.length };
  for (const s of ["open", "paused", "closed"]) {
    counts[s] = markets.filter((m) => marketStatus(m) === s).length;
  }

  // Look up several event URLs/IDs at once and pool all their props into one list.
  async function multiLookup(input) {
    const parts = input.split(";").map((s) => s.trim()).filter(Boolean);
    const settled = await Promise.allSettled(parts.map(lookupEvent));
    const rows = [];
    const failed = [];
    settled.forEach((s, i) => {
      if (s.status === "fulfilled") {
        for (const m of s.value.markets) {
          rows.push({
            eventSlug: s.value.slug,
            eventTitle: s.value.title,
            conditionId: m.conditionId,
            question: m.question,
            kind: m.kind,
            outcomes: m.outcomes.map((label) => ({ label })),
          });
        }
      } else {
        failed.push(parts[i]);
      }
    });
    if (failed.length) {
      setError(`No event found for: ${failed.join(", ")}`);
    }
    return rows;
  }

  // Route the search box: ";" = several events, "," = screener, else one event.
  async function handleFind(input) {
    setFindBusy(true);
    setError(null);
    try {
      if (input.includes(";")) {
        setEventResult(null);
        setMultiMode(true);
        setScreenerResult(await multiLookup(input));
      } else if (input.includes(",")) {
        setEventResult(null);
        setMultiMode(false);
        setScreenerResult(await screenMarkets(input));
      } else {
        setScreenerResult(null);
        setEventResult(await lookupEvent(input));
      }
    } catch (e) {
      setError(`Search failed: ${e.message}`);
    } finally {
      setFindBusy(false);
    }
  }

  async function handleTrack(slug, conditionIds) {
    setTrackBusy(true);
    try {
      await trackSelected(slug, conditionIds);
      onTracked();
      setEventResult(null);
    } catch (e) {
      setError(`Tracking failed: ${e.message}`);
    } finally {
      setTrackBusy(false);
    }
  }

  // Screener picks can span several events, so track one event's props at a time.
  async function handleTrackScreener(conditionIds) {
    setTrackBusy(true);
    try {
      const bySlug = {};
      for (const r of screenerResult) {
        if (conditionIds.includes(r.conditionId)) {
          (bySlug[r.eventSlug] ??= []).push(r.conditionId);
        }
      }
      for (const [slug, ids] of Object.entries(bySlug)) {
        await trackSelected(slug, ids);
      }
      onTracked();
      setScreenerResult(null);
    } catch (e) {
      setError(`Tracking failed: ${e.message}`);
    } finally {
      setTrackBusy(false);
    }
  }

  const filterBtn = (active) => ({
    ...(active ? btn.primary : btn.outline),
    fontSize: 12,
    padding: "6px 12px",
    textTransform: "capitalize",
  });

  return (
    <main style={page}>
      <StatsRow stats={stats} />

      <AddEventBar onFind={handleFind} busy={findBusy} />

      {eventResult && (
        <EventPanel
          event={eventResult}
          onTrack={handleTrack}
          onCancel={() => setEventResult(null)}
          busy={trackBusy}
        />
      )}

      {screenerResult && (
        <ScreenerPanel
          results={screenerResult}
          onTrack={handleTrackScreener}
          onCancel={() => setScreenerResult(null)}
          busy={trackBusy}
          title={multiMode ? "Events found" : "Screener results"}
          emptyText={
            multiMode
              ? "None of those URLs or IDs matched an event."
              : "No live markets matched that search."
          }
        />
      )}

      {error && <div style={{ fontSize: 13, color: T.red }}>⚠ {error}</div>}

      {/* filters: status + view type */}
      <div
        style={{
          display: "flex",
          gap: 20,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 12, color: T.sub }}>Status:</span>
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              onClick={() => setParams({ status: s, page: 1 })}
              style={filterBtn(status === s)}
            >
              {s} ({counts[s]})
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 12, color: T.sub }}>View:</span>
          {VIEW_FILTERS.map((v) => (
            <button
              key={v}
              onClick={() => setParams({ view: v, page: 1 })}
              style={filterBtn(view === v)}
            >
              {VIEW_LABELS[v]}
            </button>
          ))}
        </div>
      </div>

      <MarketList
        groups={pagedGroups}
        onToggle={onToggle}
        onHistory={onOpenHistory}
        onDelete={onDelete}
      />

      {/* pagination */}
      {groups.length > 0 && (
        <div
          style={{
            display: "flex",
            gap: 14,
            alignItems: "center",
            justifyContent: "flex-end",
            fontSize: 15,
            color: T.sub,
          }}
        >
          <span>
            Show{" "}
            <select
              value={perPage}
              onChange={(e) => setParams({ per: Number(e.target.value), page: 1 })}
              style={{ fontFamily: T.ui, fontSize: 15, padding: "8px 10px" }}
            >
              {PER_PAGE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>{" "}
            per page
          </span>
          <span style={{ ...monoText, fontSize: 15 }}>
            page {currentPage} / {totalPages}
          </span>
          <button
            onClick={() => setParams({ page: currentPage - 1 })}
            disabled={currentPage <= 1}
            style={{ ...btn.primary, fontSize: 15, padding: "12px 22px" }}
          >
            ← Previous
          </button>
          <button
            onClick={() => setParams({ page: currentPage + 1 })}
            disabled={currentPage >= totalPages}
            style={{ ...btn.primary, fontSize: 15, padding: "12px 22px" }}
          >
            Next →
          </button>
        </div>
      )}
    </main>
  );
}
