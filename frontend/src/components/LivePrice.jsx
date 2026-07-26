import { useEffect, useRef, useState } from "react";
import AnimatedNumber from "./AnimatedNumber.jsx";
import { fmtCents } from "../utils.js";
import { T } from "../theme.js";

// A price that visibly reacts to live changes: the number glides to its new
// value and the cell flashes green (up) / red (down) on every move, so you can
// see prices ticking in real time without refreshing. Stable prices don't
// flash — only actual changes do.
export default function LivePrice({ cents, color, weight = 700 }) {
  const [flash, setFlash] = useState(null); // "up" | "down" | null
  const prev = useRef(cents);

  useEffect(() => {
    if (cents == null) return;
    if (prev.current != null && cents !== prev.current) {
      setFlash(cents > prev.current ? "up" : "down");
    }
    prev.current = cents;
  }, [cents]);

  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(null), 800);
    return () => clearTimeout(id);
  }, [flash]);

  if (cents == null) return <span style={{ color }}>—</span>;

  const bg =
    flash === "up" ? "rgba(14,159,110,0.20)"
    : flash === "down" ? "rgba(214,69,69,0.20)"
    : "transparent";
  const fg = flash === "up" ? T.green : flash === "down" ? T.red : color;

  return (
    <span
      style={{
        display: "inline-block",
        padding: "1px 6px",
        borderRadius: 6,
        fontWeight: weight,
        color: fg,
        background: bg,
        transition: "background-color 0.7s ease, color 0.7s ease",
      }}
    >
      <AnimatedNumber value={cents} format={(n) => fmtCents(Math.round(n))} duration={500} />
    </span>
  );
}
