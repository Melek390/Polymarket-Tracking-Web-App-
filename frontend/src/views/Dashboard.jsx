import { useState } from "react";
import StatsRow from "../components/StatsRow.jsx";
import AddEventBar from "../components/AddEventBar.jsx";
import EventPanel from "../components/EventPanel.jsx";
import ScreenerPanel from "../components/ScreenerPanel.jsx";
import MarketList from "../components/MarketList.jsx";
import { lookupEvent, screenMarkets, trackSelected } from "../api/client.js";
import { T, page } from "../theme.js";

export default function Dashboard({
  stats,
  markets,
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

  // several URLs/IDs at once, ";"-separated — pooled into one selection panel
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

  // ";" = multiple URLs/IDs, "," = screener query, else single event lookup
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

  // screener picks can span several events — one track call per event
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

      <MarketList
        markets={markets}
        onToggle={onToggle}
        onHistory={onOpenHistory}
        onDelete={onDelete}
      />
    </main>
  );
}
