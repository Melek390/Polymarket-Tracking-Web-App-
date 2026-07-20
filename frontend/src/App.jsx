import { useEffect, useState } from "react";
import Header from "./components/Header.jsx";
import Dashboard from "./views/Dashboard.jsx";
import MarketHistory from "./views/MarketHistory.jsx";
import {
  deleteMarket,
  fetchDashboard,
  fetchMarkets,
  setTracking,
} from "./api/client.js";
import { T } from "./theme.js";

// Hash routing so every page has its own shareable URL:
//   #/                     dashboard (optionally ?page=2&per=50&status=open)
//   #/market/12            history page for market 12
function parseHash() {
  const hash = window.location.hash.slice(1) || "/";
  const [path, query] = hash.split("?");
  const params = new URLSearchParams(query || "");
  const match = path.match(/^\/market\/(\d+)$/);
  if (match) return { view: "market", id: Number(match[1]), params };
  return { view: "dashboard", params };
}

// Change the URL hash; the hashchange listener re-renders the right view.
function navigate(path) {
  window.location.hash = path;
}

// Root component: owns shared data and switches between dashboard and history.
export default function App() {
  const [route, setRoute] = useState(parseHash);
  const [stats, setStats] = useState(null);
  const [markets, setMarkets] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const onHashChange = () => setRoute(parseHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  async function refresh() {
    setRefreshing(true);
    setError(null);
    try {
      const [s, m] = await Promise.all([fetchDashboard(), fetchMarkets()]);
      setStats(s);
      setMarkets(m);
    } catch (e) {
      setError(String(e.message ?? e));
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleDelete(id) {
    await deleteMarket(id);
    refresh();
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
      />

      {error && (
        <div style={{ padding: "16px 32px 0", fontSize: 13, color: T.red }}>
          ⚠ {error}
        </div>
      )}

      {openMarket ? (
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
