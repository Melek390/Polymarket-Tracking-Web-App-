// API layer — fetch() calls to the FastAPI backend (backend/api/routes.py).
// All mapping from backend field names to UI shapes happens here and
// nowhere else, so backend changes never touch the components.

async function request(path, options = {}, retry = true) {
  let r;
  try {
    r = await fetch(path, options);
  } catch (e) {
    // network hiccup (some proxies drop the first POST on a plain-HTTP link):
    // retry once before giving up
    if (retry) return request(path, options, false);
    throw e;
  }
  if (!r.ok) {
    let detail;
    try {
      detail = (await r.json()).detail;
    } catch {
      /* non-JSON error body */
    }
    // a 4xx with no message is not our API talking — it's something on the
    // network (proxy/antivirus) rejecting the first request; retry once. Our
    // writes are idempotent, so a repeat is harmless.
    if (retry && !detail && r.status >= 400 && r.status < 500) {
      return request(path, options, false);
    }
    throw new Error(detail || `HTTP ${r.status}`);
  }
  return r.json();
}

const post = (path, body) =>
  request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });

// backend market row -> the shape all components were built against
function toMarket(m) {
  return {
    id: m.id,
    conditionId: m.condition_id, // to mark already-tracked props in the screener
    category: m.category || null, // MLB / Soccer / Politics / Crypto …
    // Teams in a series play on consecutive days, so two markets can share a
    // title and differ only by date — surface the date from the event slug.
    gameDate: (m.event_slug || "").match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? null,
    // the "- More Markets" twin holds a match's extra props; show the
    // match name, not the twin's technical title
    event: m.event_title.replace(/ - More Markets$/i, ""),
    eventSlug: m.event_slug,
    question: m.question,
    kind: m.kind,
    tracking: Boolean(m.tracking),
    closed: Boolean(m.closed),
    closedAt: m.closed_at ? Date.parse(m.closed_at) : null,
    pollInterval: m.poll_interval,
    records: m.records,
    lastUpdate: m.last_update ? Date.parse(m.last_update) : null,
    createdAt: Date.parse(m.created_at),
    outcomes: m.outcomes.map((o) => o.label),
    spark: m.spark,
  };
}

// GET /api/dashboard
export async function fetchDashboard() {
  const s = await request("/api/dashboard");
  return {
    active: s.active,
    total: s.total,
    dbSizeBytes: s.db_size_bytes,
    lastUpdate: s.last_update ? Date.parse(s.last_update) : null,
    recordsToday: s.records_today,
  };
}

// GET /api/markets
export async function fetchMarkets() {
  return (await request("/api/markets")).map(toMarket);
}

// POST /api/events/lookup
export async function lookupEvent(urlOrSlug) {
  const e = await post("/api/events/lookup", { url_or_slug: urlOrSlug });
  return {
    slug: e.slug,
    title: e.title,
    markets: e.markets.map((m) => ({
      conditionId: m.condition_id,
      question: m.question,
      kind: m.kind,
      outcomes: m.outcomes.map((o) => o.label),
    })),
  };
}

// POST /api/screener — query like "soccer, o/u 3.5, over < 0.40"
export async function screenMarkets(query) {
  const rows = await post("/api/screener", { query });
  return rows.map((r) => ({
    eventSlug: r.event_slug,
    eventTitle: r.event_title,
    conditionId: r.condition_id,
    question: r.question,
    kind: r.kind,
    outcomes: r.outcomes, // [{label, token_id, price}]
  }));
}

// GET /api/screener/markets — cached matches for the screener page
export async function fetchScreener(sport = "soccer") {
  const data = await request(`/api/screener/markets?sport=${sport}`);
  return {
    rows: data.rows.map((r) => ({
      slug: r.event_slug,
      league: r.league,
      home: r.home_team,
      away: r.away_team,
      kickoff: r.kickoff ? Date.parse(r.kickoff) : null,
      volume: r.volume,
      homePrice: r.home_price,
      drawPrice: r.draw_price,
      awayPrice: r.away_price,
      gamePk: r.game_pk ?? null,
    })),
    leagues: data.leagues,
    updatedAt: data.updated_at ? Date.parse(data.updated_at) : null,
  };
}

// GET /api/mlb/game/{pk} — live baseball game state (inning, score, bases…).
// full=true also brings season stats (ERA/OPS) for the expand panel.
// The _ param busts any intermediate cache so live data is never stale.
export async function fetchMlbGame(gamePk, full = false) {
  return request(`/api/mlb/game/${gamePk}?_=${Date.now()}${full ? "&full=1" : ""}`);
}

// GET /api/screener/live-price — fresh CLOB ask prices for a live game
export async function fetchLivePrice(slug) {
  return request(`/api/screener/live-price?slug=${encodeURIComponent(slug)}&_=${Date.now()}`);
}

// GET /api/mlb/analyze/{pk} — ready-to-paste game snapshot for the Analyze button
export async function fetchMlbAnalyze(gamePk) {
  return request(`/api/mlb/analyze/${gamePk}?_=${Date.now()}`);
}

// GET /api/favorite/{pk} — the Clear Favorite verdict + factor breakdown
export async function fetchFavorite(gamePk) {
  return request(`/api/favorite/${gamePk}`);
}

// GET /api/mlb/matchup/{pk} — standings, season series and probable starters
export async function fetchMlbMatchup(gamePk) {
  return request(`/api/mlb/matchup/${gamePk}`);
}

// GET /api/mlb/teams — every club, for the team-tag picker. [{name, abbr}]
export async function fetchMlbTeams() {
  return request("/api/mlb/teams");
}

// GET /api/mlb/timeline?slug= — play-by-play (inning/pitcher/batter per ms) for
// the price chart tooltip. {game_pk, plays:[{start,end,inning,half,pitcher,batter}]}
export async function fetchMlbTimeline(slug) {
  return request(`/api/mlb/timeline?slug=${encodeURIComponent(slug)}`);
}

// POST /api/events/track — backend persists and starts polling + backfill;
// the caller re-fetches the market list afterwards.
export async function trackSelected(slug, conditionIds) {
  return post("/api/events/track", {
    slug,
    market_condition_ids: conditionIds,
  });
}

// POST /api/markets/{id}/start | /api/markets/{id}/stop
export async function setTracking(id, shouldTrack) {
  return post(`/api/markets/${id}/${shouldTrack ? "start" : "stop"}`);
}

// DELETE /api/markets/{id} — permanent, removes all stored data
export async function deleteMarket(id) {
  return request(`/api/markets/${id}`, { method: "DELETE" });
}

// GET /api/markets/{id}/ticks — ISO timestamps become ms epoch numbers
export async function fetchTicks(market, limit = 2000, before = null) {
  const q = before ? `&before=${encodeURIComponent(before)}` : "";
  const rows = await request(`/api/markets/${market.id}/ticks?limit=${limit}${q}`);
  // iso kept for the "load older" paging cursor
  return rows.map((r) => ({ ts: Date.parse(r.ts), iso: r.ts, ...r.prices }));
}

// GET /api/markets/{id}/chart — the WHOLE history, downsampled server-side
export async function fetchChart(market, points = 1500) {
  const rows = await request(`/api/markets/${market.id}/chart?points=${points}`);
  return rows.map((r) => ({ ts: Date.parse(r.ts), ...r.prices }));
}

// GET /api/markets/{id}/export.csv — direct download; the server names
// the file after the market via its Content-Disposition header
export function exportCsvFor(market) {
  const a = document.createElement("a");
  a.href = `/api/markets/${market.id}/export.csv`;
  a.download = "";
  a.click();
}

// --- accounts tracker (backend/traders) ------------------------------------

export async function traderList() {
  return request("/api/traders");
}

export async function traderAdd(input, label = "") {
  return request("/api/traders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input, label }),
  });
}

export async function traderDelete(id) {
  return request(`/api/traders/${id}`, { method: "DELETE" });
}

export async function traderSummary(id) {
  return request(`/api/traders/${id}/summary`);
}

export async function traderOpen(id) {
  return request(`/api/traders/${id}/open`);
}

export async function traderClosed(id) {
  return request(`/api/traders/${id}/closed`);
}

export async function traderActivity(id) {
  return request(`/api/traders/${id}/activity`);
}

export async function traderTagToggle(id, asset, tag) {
  return request(`/api/traders/${id}/tags`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ asset, tag }),
  });
}

// GET /api/traders/peak — max price after a moment (sold-too-early check)
export async function traderPeak(asset, afterTs) {
  return request(`/api/traders/peak?asset=${encodeURIComponent(asset)}&after_ts=${afterTs}`);
}

// GET /api/traders/{id}/tags — the account's custom tag vocabulary
export async function traderTagVocab(id) {
  return request(`/api/traders/${id}/tags`);
}
