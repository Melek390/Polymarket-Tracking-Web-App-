import { useEffect, useRef, useState } from "react";
import { T, card } from "../theme.js";

// The account chip in the top-right corner: initial, name, caret — and a
// dropdown with the two things you ever want from it (change password, sign
// out). Replaces the bare "melek · admin  [Sign out]" pair, which put a
// destructive action permanently one stray click away.
//
// Lives in the header, which sits OUTSIDE the zoomed content area, so the
// absolute positioning here is not subject to the A-/A+ zoom rule.
export default function UserMenu({ user, onSignOut, onNavigate }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);

  // close on an outside click or Escape — a menu you cannot dismiss without
  // picking something is worse than no menu
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (wrap.current && !wrap.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!user) return null;
  const name = user.display_name || user.username;
  const initial = (name || "?").trim().charAt(0).toUpperCase();

  const item = {
    display: "flex", alignItems: "center", gap: 9, width: "100%",
    padding: "9px 13px", border: "none", background: "transparent",
    fontFamily: T.ui, fontSize: 13, color: T.ink, textAlign: "left",
    cursor: "pointer",
  };

  return (
    <div ref={wrap} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        title="Your account"
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "4px 9px 4px 4px", borderRadius: 999, cursor: "pointer",
          fontFamily: T.ui, color: "#fff",
          background: open ? "rgba(255,255,255,0.18)" : "transparent",
          border: "1px solid rgba(255, 255, 255, 0.55)",
        }}
      >
        <span style={{
          width: 24, height: 24, borderRadius: "50%", background: "#fff",
          color: NAVY_TEXT, fontSize: 12, fontWeight: 800,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          {initial}
        </span>
        <span style={{ fontSize: 12, fontWeight: 600, maxWidth: 140,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {name}
        </span>
        <span style={{ fontSize: 9, opacity: 0.8, transform: open ? "rotate(180deg)" : "none" }}>
          ▼
        </span>
      </button>

      {open && (
        <div role="menu" style={{
          ...card, position: "absolute", top: "calc(100% + 8px)", right: 0,
          minWidth: 214, padding: "6px 0", zIndex: 60,
          boxShadow: "0 10px 28px rgba(0,0,0,0.20)",
        }}>
          {/* who you are, so a shared screen never gets confused */}
          <div style={{ padding: "7px 13px 10px", borderBottom: `1px solid ${T.border}` }}>
            <div style={{ fontFamily: T.ui, fontSize: 13, fontWeight: 700, color: T.ink }}>
              {name}
            </div>
            <div style={{ fontFamily: T.ui, fontSize: 11, color: T.sub }}>
              @{user.username}{user.is_admin ? " · administrator" : ""}
            </div>
          </div>
          <button
            role="menuitem"
            style={item}
            onMouseEnter={(e) => { e.currentTarget.style.background = T.soft; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            onClick={() => { setOpen(false); onNavigate("/account"); }}
          >
            <span style={{ width: 16, textAlign: "center" }}>🔑</span>
            Change password
          </button>
          <button
            role="menuitem"
            style={{ ...item, color: T.red }}
            onMouseEnter={(e) => { e.currentTarget.style.background = T.soft; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            onClick={() => { setOpen(false); onSignOut(); }}
          >
            <span style={{ width: 16, textAlign: "center" }}>⏻</span>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

const NAVY_TEXT = "#191970";
