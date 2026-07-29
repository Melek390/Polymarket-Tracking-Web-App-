// Per-match alerts: saved in the browser, evaluated against the live data the
// screener already polls. MLB alerts use price + inning + team + run
// difference; other sports use price only. The sound is chosen automatically
// by the alert's type (a price alert and a game-situation alert sound
// different), per the client's spec.

const KEY = "screenerAlerts";

export function loadAlerts() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}");
  } catch {
    return {};
  }
}

export function persistAlerts(alerts) {
  localStorage.setItem(KEY, JSON.stringify(alerts));
}

// A game-situation alert (inning or run difference) sounds different from a
// plain price alert.
export function soundType(alert) {
  return alert.inningFrom != null ||
    alert.inningTo != null ||
    (alert.runDiff && alert.runDiff !== "any")
    ? "situation"
    : "price";
}

// --- sound (Web Audio, no files to ship) ----------------------------------

let audio;
function beep(freqs, dur = 0.18, gap = 0.15) {
  audio = audio || new (window.AudioContext || window.webkitAudioContext)();
  if (audio.state === "suspended") audio.resume(); // needed after tab-switch/autoplay block
  freqs.forEach((f, i) => {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = "triangle"; // richer/louder than a plain sine at the same gain
    osc.frequency.value = f;
    const t = audio.currentTime + i * gap;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.9, t + 0.02); // was 0.25 — too quiet to hear
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain);
    gain.connect(audio.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  });
}

const TONES = {
  price: () => beep([880, 1320]), // rising two-note
  situation: () => beep([1568, 1245, 1568], 0.2, 0.16), // triad
};

// Play the alert tone three times so it's hard to miss.
export function playSound(type) {
  const play = TONES[type];
  if (!play) return;
  for (let i = 0; i < 3; i++) {
    setTimeout(() => {
      try {
        play();
      } catch {
        /* audio not allowed until the user interacts; ignore */
      }
    }, i * 650);
  }
}

// Short human-readable summary of an alert, for the alert bar.
export function alertSummary(alert, isMlb) {
  if (!alert) return null;
  const parts = [];
  const side = { home: "home", away: "away", draw: "draw", batting: "batting team" }[alert.side];
  const who = side ? side + " " : "";
  if (alert.priceMax != null) parts.push(`${who}price ≤ ${alert.priceMax}¢`);
  if (alert.priceMin != null) parts.push(`${who}price ≥ ${alert.priceMin}¢`);
  if (isMlb) {
    if (alert.inningFrom != null || alert.inningTo != null) {
      parts.push(`inning ${alert.inningFrom ?? 1}–${alert.inningTo ?? "∞"}`);
    }
    const rd = { win1: "winning by 1", lose1: "losing by 1", tie: "tie game" }[alert.runDiff];
    if (rd) parts.push(rd);
  }
  return parts.join(" · ") || "any game";
}

// A short reason string for why the price rule matched — which side hit the
// threshold — so an "Any team" alert isn't a mystery. Returns null if the
// alert has no price rule or nothing is under the threshold.
export function matchReason(alert, prices, live) {
  if (!alert) return null;
  let side = alert.side;
  if (side === "batting") side = live && live.status === "Live" ? live.batting : null;
  const sides = side && side !== "any" ? [side] : ["home", "away", "draw"];
  const label = (s) => ({ home: "Home", away: "Away", draw: "Draw" }[s]);
  if (alert.priceMax != null) {
    const w = sides.find((s) => prices[s] != null && prices[s] <= alert.priceMax);
    if (w) return `${label(w)} ${prices[w]}¢ ≤ ${alert.priceMax}¢`;
  }
  if (alert.priceMin != null) {
    const w = sides.find((s) => prices[s] != null && prices[s] >= alert.priceMin);
    if (w) return `${label(w)} ${prices[w]}¢ ≥ ${alert.priceMin}¢`;
  }
  return null;
}

// --- evaluation ------------------------------------------------------------

// ctx: { prices: {home, away, draw}, live: <MLB live state | null> }
export function matches(alert, ctx) {
  if (!alert) return false;
  const { prices, live } = ctx;
  const isLive = live && live.status === "Live";
  const wantsSituation =
    alert.inningFrom != null ||
    alert.inningTo != null ||
    (alert.runDiff && alert.runDiff !== "any");
  if (wantsSituation && !isLive) return false;

  // which side's price the alert watches ("batting" resolves live)
  let side = alert.side;
  if (side === "batting") side = isLive ? live.batting : null;

  if (alert.priceMax != null) {
    const under = (p) => p != null && p <= alert.priceMax;
    const ok =
      side && side !== "any"
        ? under(prices[side])
        : ["home", "away", "draw"].some((s) => under(prices[s]));
    if (!ok) return false;
  }
  if (alert.priceMin != null) {
    const over = (p) => p != null && p >= alert.priceMin;
    const ok =
      side && side !== "any"
        ? over(prices[side])
        : ["home", "away", "draw"].some((s) => over(prices[s]));
    if (!ok) return false;
  }

  const inning = isLive ? live.inning ?? 0 : 0;
  if (alert.inningFrom != null && inning < alert.inningFrom) return false;
  if (alert.inningTo != null && inning > alert.inningTo) return false;

  if (alert.runDiff && alert.runDiff !== "any") {
    const ref = side === "home" || side === "away" ? side : live.batting;
    const mine = live[ref]?.runs ?? 0;
    const opp = live[ref === "home" ? "away" : "home"]?.runs ?? 0;
    const diff = mine - opp;
    if (alert.runDiff === "win1" && diff !== 1) return false;
    if (alert.runDiff === "lose1" && diff !== -1) return false;
    if (alert.runDiff === "tie" && diff !== 0) return false;
  }
  return true;
}
