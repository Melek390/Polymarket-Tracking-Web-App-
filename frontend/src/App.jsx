import { useEffect, useRef, useState } from "react";
import Header from "./components/Header.jsx";
import Dashboard from "./views/Dashboard.jsx";
import MarketHistory from "./views/MarketHistory.jsx";
import Screener from "./views/Screener.jsx";
import {
  deleteMarket,
  fetchDashboard,
  fetchMarkets,
  setTracking,
} from "./api/client.js";
import { T } from "./theme.js";

// Real-path routing so every page has its own clean, shareable URL:
//   /                      dashboard (optionally ?page=2&per=50&status=open)
//   /screener              the market screener (soccer by default)
//   /screener/football     the screener on a specific sport
//   /market/12             history page for market 12
function parseRoute() {
  const path = window.location.pathname;
  const params = new URLSearchParams(window.location.search);
  const screener = path.match(/^\/screener(?:\/([a-z]+))?$/);
  if (screener) return { view: "screener", sport: screener[1] || "soccer", params };
  const match = path.match(/^\/market\/(\d+)$/);
  if (match) return { view: "market", id: Number(match[1]), params };
  return { view: "dashboard", params };
}

// Navigate without a full reload; the popstate listener re-renders the view.
function navigate(path) {
  window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

// Root component: owns shared data and switches between dashboard and history.
export default function App() {
  const [route, setRoute] = useState(parseRoute);
  const [stats, setStats] = useState(null);
  const [markets, setMarkets] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const onNav = () => setRoute(parseRoute());
    window.addEventListener("popstate", onNav);
    return () => window.removeEventListener("popstate", onNav);
  }, []);

  // deletes still being purged server-side, and a counter that lets a newer
  // refresh invalidate a slower older one — both stop deleted rows from
  // being resurrected when deletes and reloads overlap
  const pendingDeletes = useRef(new Set());
  const refreshSeq = useRef(0);

  async function refresh() {
    const seq = ++refreshSeq.current;
    setRefreshing(true);
    setError(null);
    try {
      const [s, m] = await Promise.all([fetchDashboard(), fetchMarkets()]);
      if (seq !== refreshSeq.current) return; // superseded by a newer refresh
      setStats(s);
      setMarkets(m.filter((x) => !pendingDeletes.current.has(x.id)));
    } catch (e) {
      if (seq === refreshSeq.current) setError(String(e.message ?? e));
    } finally {
      if (seq === refreshSeq.current) setRefreshing(false);
    }
  }

  // initial load, then a quiet refresh every 15s while the tab is visible —
  // backfills grow the database for a while after tracking, and the stats
  // should follow without anyone pressing Refresh
  useEffect(() => {
    refresh();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 15_000);
    return () => clearInterval(id);
  }, []);

  async function handleDelete(id) {
    // drop the row right away — the server erase of a big history can take
    // seconds, and waiting for it made the page feel stuck
    pendingDeletes.current.add(id);
    setMarkets((prev) => prev.filter((m) => m.id !== id));
    try {
      await deleteMarket(id);
    } catch (e) {
      setError(`Delete failed: ${e.message}`);
    } finally {
      pendingDeletes.current.delete(id);
    }
    refresh(); // sync stats, and bring the row back if the delete failed
  }

  async function handleToggle(id, shouldTrack) {
    setMarkets((prev) =>
      prev.map((m) => (m.id === id ? { ...m, tracking: shouldTrack } : m)),
    );
    await setTracking(id, shouldTrack);
  }

  const openMarket =
    route.view === "market" && markets.find((m) => m.id === route.id);

  return (
    <div>
      <Header
        collectorRunning={stats !== null}
        refreshing={refreshing}
        onRefresh={refresh}
        onNavigate={navigate}
      />

      {error && (
        <div style={{ padding: "16px 32px 0", fontSize: 13, color: T.red }}>
          ⚠ {error}
        </div>
      )}

      {route.view === "screener" ? (
        <Screener
          sport={route.sport}
          onSport={(s) => navigate(`/screener/${s}`)}
          onTracked={refresh}
          markets={markets}
        />
      ) : openMarket ? (
        <MarketHistory
          market={openMarket}
          onBack={() => navigate("/")}
          onToggle={handleToggle}
        />
      ) : (
        <Dashboard
          stats={stats}
          markets={markets}
          params={route.params}
          onNavigate={navigate}
          onToggle={handleToggle}
          onOpenHistory={(id) => navigate(`/market/${id}`)}
          onTracked={refresh}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}
