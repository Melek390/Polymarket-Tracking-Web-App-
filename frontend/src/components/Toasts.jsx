import { useCallback, useEffect, useRef, useState } from "react";
import { T } from "../theme.js";

const TOAST_MS = 40000; // each alert stays this long unless closed
const MAX_TOASTS = 6;   // keep the newest few so a busy slate can't flood the screen

// Alert popups that stack instead of replacing each other. Each one lives for
// TOAST_MS (or until its × is clicked), so a burst of matches stays readable.
export function useToasts(ttl = TOAST_MS) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const push = useCallback((text) => {
    if (!text) return;
    const id = ++idRef.current;
    setToasts((prev) => [...prev, { id, text, at: Date.now() }].slice(-MAX_TOASTS));
  }, []);

  const dismiss = useCallback(
    (id) => setToasts((prev) => prev.filter((t) => t.id !== id)),
    [],
  );

  // drop expired ones
  useEffect(() => {
    if (!toasts.length) return;
    const timer = setInterval(() => {
      const now = Date.now();
      setToasts((prev) => prev.filter((t) => now - t.at < ttl));
    }, 1000);
    return () => clearInterval(timer);
  }, [toasts.length, ttl]);

  return { toasts, push, dismiss };
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
          <span style={{ flex: 1 }}>🔔 {t.text}</span>
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
