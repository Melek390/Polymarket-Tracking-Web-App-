import { useEffect, useRef, useState } from "react";
import Header from "./components/Header.jsx";
import Dashboard from "./views/Dashboard.jsx";
import MarketHistory from "./views/MarketHistory.jsx";
import Screener from "./views/Screener.jsx";
import AccountsTracker from "./views/AccountsTracker.jsx";
import Backtesting from "./views/Backtesting.jsx";
import {
  deleteMarket,
  fetchDashboard,
  fetchMarkets,
  setTracking,
} from "./api/client.js";
import { T } from "./theme.js";
import { fetchMe } from "./api/auth.js";
import Login from "./views/auth/Login.jsx";
import Register from "./views/auth/Register.jsx";
import ForgotPassword from "./views/auth/ForgotPassword.jsx";
import ResetPassword from "./views/auth/ResetPassword.jsx";
import Admin from "./views/Admin.jsx";

// The four pages a signed-out visitor is allowed to see. Everything else
// redirects to /login until /api/auth/me says who they are.
const PUBLIC_VIEWS = new Set(["login", "register", "forgot", "reset"]);

// Real-path routing so every page has its own clean, shareable URL:
//   /                      dashboard (optionally ?page=2&per=50&status=open)
//   /screener              the market screener (soccer by default)
//   /screener/football     the screener on a specific sport
//   /market/12             history page for market 12
//   /accounts_tracker      V3 trader portfolio tracker
//   /login /register /forgot /reset   signed-out pages (no header, no data)
//   /admin                 user and invitation management (admins only)
function parseRoute() {
  const path = window.location.pathname;
  const params = new URLSearchParams(window.location.search);
  if (path === "/login") return { view: "login", params };
  if (path === "/register") return { view: "register", params };
  if (path === "/forgot") return { view: "forgot", params };
  if (path === "/reset") return { view: "reset", params };
  if (path === "/admin") return { view: "admin", params };
  if (path === "/accounts_tracker") return { view: "accounts", params };
  if (path === "/backtesting") return { view: "backtesting", params };
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
  // undefined = still asking the server, null = signed out, object = signed in.
  // The three states matter: rendering the login page during the check would
  // flash it at someone who is already signed in on every page load.
  const [me, setMe] = useState(undefined);
  // false = this server has no auth API yet (the bundle shipped ahead of the
  // backend). Skip the gate entirely and behave as the app did before auth.
  const [authInstalled, setAuthInstalled] = useState(true);
  const [stats, setStats] = useState(null);
  const [markets, setMarkets] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  // Content zoom (persisted). Scales only the content area, not the header, so
  // it stays readable on a big screen without browser zoom breaking the layout.
  const [scale, setScale] = useState(() => {
    const s = Number(localStorage.getItem("uiScale"));
    return s >= 0.8 && s <= 2 ? s : 1;
  });
  function changeScale(delta, reset) {
    setScale((prev) => {
      const next = reset ? 1 : Math.min(2, Math.max(0.8, Math.round((prev + delta) * 10) / 10));
      localStorage.setItem("uiScale", String(next));
      return next;
    });
  }

  useEffect(() => {
    const onNav = () => setRoute(parseRoute());
    window.addEventListener("popstate", onNav);
    return () => window.removeEventListener("popstate", onNav);
  }, []);

  // Who is signed in? Asked once on load; every data fetch waits for it.
  useEffect(() => {
    fetchMe()
      .then((r) => {
        setAuthInstalled(r.installed);
        setMe(r.user);
      })
      .catch(() => setMe(null));
  }, []);

  // A signed-out visitor on a private page goes to /login. Doing this as an
  // effect (not during render) keeps it out of the render path and lets the
  // public pages render normally.
  useEffect(() => {
    if (authInstalled && me === null && !PUBLIC_VIEWS.has(route.view)) navigate("/login");
  }, [authInstalled, me, route.view]);

  function onSignedIn(user) {
    setMe(user);
    navigate("/");
  }

  async function signOut() {
    try {
      await (await import("./api/auth.js")).logout();
    } catch {
      /* the cookie is dead either way */
    }
    setMe(null);
    navigate("/login");
  }

  // Browser-tab title follows the view — with several tabs open, "Market
  // Tracker" x4 told the client nothing (his request, Aug 7).
  useEffect(() => {
    const names = {
      dashboard: "Dashboard", screener: "Screener", accounts: "Accounts",
      backtesting: "Backtesting", market: "Chart",
    };
    const label = route.view === "screener"
      ? `Screener · ${route.sport[0].toUpperCase()}${route.sport.slice(1)}`
      : names[route.view] || "Dashboard";
    document.title = `${label} — Market Tracker`;
  }, [route]);

  // The dashboard keeps its filters in the query string (?status=closed&page=2…).
  // Remember them while we're there so "Back to markets" returns to the same
  // filtered list instead of resetting to everything.
  const dashboardQuery = useRef("");
  useEffect(() => {
    if (route.view === "dashboard") dashboardQuery.current = window.location.search;
  }, [route]);
  const backToMarkets = () => navigate(`/${dashboardQuery.current || ""}`);

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
  // ...but only once we know there is a session: firing these while signed
  // out just produces 401s and a red error banner behind the login page.
  useEffect(() => {
    // wait for a session, unless this server has no auth at all
    if (authInstalled && !me) return undefined;
    refresh();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 15_000);
    return () => clearInterval(id);
  }, [authInstalled, me]);

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

  // --- auth gate ---------------------------------------------------------
  // Still asking the server: render nothing rather than flashing the login
  // page at a signed-in user on every load.
  if (me === undefined) {
    return <div style={{ minHeight: "100vh", background: T.soft }} />;
  }
  // The signed-out pages own the whole window — no header, no polling.
  // Skipped entirely when the server has no auth API: there is nothing to
  // sign in to, and gating here would lock everyone out of a working app.
  if (authInstalled && !me) {
    if (route.view === "register") {
      return <Register onSignedIn={onSignedIn} navigate={navigate} params={route.params} />;
    }
    if (route.view === "forgot") return <ForgotPassword navigate={navigate} />;
    if (route.view === "reset") {
      return <ResetPassword navigate={navigate} params={route.params} />;
    }
    // login, plus anything private while the redirect effect runs
    return <Login onSignedIn={onSignedIn} navigate={navigate} />;
  }
  // A signed-in user who lands on /login or /register belongs in the app.
  if (PUBLIC_VIEWS.has(route.view) || (!authInstalled && route.view === "admin")) {
    navigate("/");
    return <div style={{ minHeight: "100vh", background: T.soft }} />;
  }

  return (
    <div>
      <Header
        collectorRunning={stats !== null}
        refreshing={refreshing}
        onRefresh={refresh}
        onNavigate={navigate}
        scale={scale}
        onScale={changeScale}
        user={me}
        onSignOut={signOut}
      />

      {error && (
        <div style={{ padding: "16px 32px 0", fontSize: 13, color: T.red }}>
          ⚠ {error}
        </div>
      )}

      <div style={{ zoom: scale }}>
      {route.view === "admin" ? (
        <Admin me={me} navigate={navigate} />
      ) : route.view === "accounts" ? (
        <AccountsTracker />
      ) : route.view === "backtesting" ? (
        <Backtesting />
      ) : route.view === "screener" ? (
        <Screener
          sport={route.sport}
          onSport={(s) => navigate(`/screener/${s}`)}
          onTracked={refresh}
          markets={markets}
        />
      ) : openMarket ? (
        <MarketHistory
          market={openMarket}
          onBack={backToMarkets}
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
    </div>
  );
}
