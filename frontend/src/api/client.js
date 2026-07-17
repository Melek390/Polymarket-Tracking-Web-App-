// API layer — fetch() calls to the FastAPI backend (backend/api/routes.py).
// All mapping from backend field names to UI shapes happens here and
// nowhere else, so backend changes never touch the components.

async function request(path, options = {}) {
  const r = await fetch(path, options);
  if (!r.ok) {
    let detail;
    try {
      detail = (await r.json()).detail;
    } catch {
      /* non-JSON error body */
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

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

// backend market row -> the shape all components were built against
function toMarket(m) {
  return {
    id: m.id,
    event: m.event_title,
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
    dbSize: formatBytes(s.db_size_bytes),
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
export async function fetchTicks(market, limit = 2000) {
  const rows = await request(`/api/markets/${market.id}/ticks?limit=${limit}`);
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
