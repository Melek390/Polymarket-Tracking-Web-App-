import { useEffect, useRef, useState } from "react";
import { T, btn } from "../theme.js";
import { HIGHLIGHT_COLORS, highlightColor } from "../highlights.js";

const PALETTE_W = 232; // wide enough for six swatches + "None"

// The per-row colour button. Shows the row's current colour (a hollow outline
// when it has none) and opens a small palette. Picking the colour it already
// has clears it, so the same button marks and unmarks.
export default function HighlightPicker({ color, onPick }) {
  const [at, setAt] = useState(null); // {top, left} while open, null when closed
  const ref = useRef(null);
  const current = highlightColor(color);
  const open = at !== null;

  // The palette is positioned FIXED, from the button's own rect. Both tables
  // scroll inside `overflow-x: auto`, which also clips vertically — an
  // absolutely-positioned palette got cut off on the bottom rows.
  function place() {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom > 70;
    setAt({
      top: below ? r.bottom + 6 : r.top - 50,
      left: Math.max(8, Math.min(r.right - PALETTE_W, window.innerWidth - PALETTE_W - 8)),
    });
  }

  // A fixed palette would drift away from its row on scroll, so follow the
  // button instead. (Closing on scroll looks tidier but fights the browser:
  // scrolling a part-offscreen palette into view would shut it immediately.)
  useEffect(() => {
    if (!open) return;
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  return (
    <span style={{ display: "inline-block" }}>
      <button
        ref={ref}
        onClick={() => (open ? setAt(null) : place())}
        title={current ? `Highlighted ${current.label} — click to change` : "Highlight this row"}
        style={{
          ...btn.outline,
          padding: 0,
          width: 26,
          height: 26,
          lineHeight: 0,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          borderColor: current ? current.dot : T.border,
        }}
      >
        <span
          style={{
            width: 13,
            height: 13,
            borderRadius: "50%",
            background: current ? current.dot : "transparent",
            border: `1.5px solid ${current ? current.dot : T.faint}`,
          }}
        />
      </button>

      {open && (
        <>
          {/* click anywhere else to close */}
          <span
            onClick={() => setAt(null)}
            style={{ position: "fixed", inset: 0, zIndex: 140 }}
          />
          <span
            style={{
              position: "fixed",
              top: at.top,
              left: at.left,
              width: PALETTE_W,
              boxSizing: "border-box",
              zIndex: 141,
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: 8,
              background: "#fff",
              border: `1px solid ${T.border}`,
              borderRadius: 8,
              boxShadow: "0 6px 20px rgba(26,29,35,0.16)",
            }}
          >
            {HIGHLIGHT_COLORS.map((c) => (
              <button
                key={c.key}
                onClick={() => {
                  onPick(c.key === color ? null : c.key);
                  setAt(null);
                }}
                title={c.label}
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  cursor: "pointer",
                  background: c.dot,
                  border: c.key === color ? `2px solid ${T.ink}` : "1px solid rgba(0,0,0,0.12)",
                }}
              />
            ))}
            <button
              onClick={() => {
                onPick(null);
                setAt(null);
              }}
              title="Remove the highlight"
              style={{ ...btn.ghost, fontSize: 12, padding: "2px 6px" }}
            >
              None
            </button>
          </span>
        </>
      )}
    </span>
  );
}

// "Clear 3 highlights" — only shown once something is highlighted.
export function ClearHighlights({ count, onClear }) {
  if (!count) return null;
  return (
    <button
      onClick={onClear}
      style={{ ...btn.outline, fontSize: 12, padding: "6px 10px" }}
    >
      Clear {count} highlight{count > 1 ? "s" : ""}
    </button>
  );
}
