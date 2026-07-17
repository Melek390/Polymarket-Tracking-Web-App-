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

export default function App() {
  const [route, setRoute] = useState({ view: "dashboard" });
  const [stats, setStats] = useState(null);
  const [markets, setMarkets] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

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
          onBack={() => setRoute({ view: "dashboard" })}
          onToggle={handleToggle}
        />
      ) : (
        <Dashboard
          stats={stats}
          markets={markets}
          onToggle={handleToggle}
          onOpenHistory={(id) => setRoute({ view: "market", id })}
          onTracked={refresh}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}
