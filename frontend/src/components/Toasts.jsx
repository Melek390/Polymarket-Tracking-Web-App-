import { useCallback, useEffect, useRef, useState } from "react";
import { T } from "../theme.js";

const TOAST_MS = 40000; // each alert stays this long unless closed
const MAX_TOASTS = 6;   // keep the newest few so a busy slate can't flood the screen

// Alert popups that stack instead of replacing each other. Each one lives for
// TOAST_MS (or until its × is clicked), so a burst of matches stays readable.
export function useToasts(ttl = TOAST_MS) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  // `url` is optional: when the alert is about one market, the popup gets a
  // ↗ chip that opens that bet on Polymarket. `action` ({label, onClick}) adds
  // a button that runs in-app — e.g. jump to the trade the alert is about.
  const push = useCallback((text, url = null, action = null) => {
    if (!text) return;
    const id = ++idRef.current;
    setToasts((prev) => [...prev, { id, text, url, action, at: Date.now() }].slice(-MAX_TOASTS));
  }, []);

  const dismiss = useCallback(
    (id) => setToasts((prev) => prev.filter((t) => t.id !== id)),
    [],
  );

  // Drop everything at once. Alerts belong to the sport that raised them, and
  // a toast outlives a sport switch by up to TOAST_MS — so without this you
  // land on Cricket still reading alerts about Soccer games.
  const clear = useCallback(() => setToasts([]), []);

  // drop expired ones
  useEffect(() => {
    if (!toasts.length) return;
    const timer = setInterval(() => {
      const now = Date.now();
      setToasts((prev) => prev.filter((t) => now - t.at < ttl));
    }, 1000);
    return () => clearInterval(timer);
  }, [toasts.length, ttl]);

  return { toasts, push, dismiss, clear };
}

export default function Toasts({ toasts, onDismiss }) {
  if (!toasts?.length) return null;
  return (
    <div
      style={{
        position: "fixed", right: 20, bottom: 20, zIndex: 130,
        display: "flex", flexDirection: "column", gap: 10,
        width: "min(420px, 92vw)",
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          style={{
            background: T.ink, color: "#fff", padding: "12px 14px",
            borderRadius: 8, fontSize: 14, lineHeight: 1.35,
            boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
            display: "flex", alignItems: "flex-start", gap: 10,
          }}
        >
          <span style={{ flex: 1 }}>
            🔔 {t.text}
            {t.action && (
              <button
                onClick={() => { t.action.onClick(); onDismiss(t.id); }}
                style={{
                  background: "#0E9F6E", color: "#fff", border: "none",
                  borderRadius: 4, fontSize: 11, fontWeight: 700,
                  padding: "3px 8px", cursor: "pointer",
                  verticalAlign: "middle", marginLeft: 6,
                }}
              >
                {t.action.label}
              </button>
            )}
            {t.url && (
              <a
                href={t.url}
                target="_blank"
                rel="noreferrer"
                title="Open this bet on Polymarket"
                style={{
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  background: "#3B82F6", color: "#fff", borderRadius: 4,
                  fontSize: 11, fontWeight: 700, lineHeight: 1, padding: "3px 5px",
                  textDecoration: "none", verticalAlign: "middle", marginLeft: 6,
                }}
              >
                ↗
              </a>
            )}
          </span>
          <button
            onClick={() => onDismiss(t.id)}
            title="Dismiss"
            style={{
              background: "none", border: "none", color: "rgba(255,255,255,0.75)",
              fontSize: 20, lineHeight: 1, cursor: "pointer", padding: 0,
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
