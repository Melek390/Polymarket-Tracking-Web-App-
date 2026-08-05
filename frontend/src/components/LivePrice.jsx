import { useEffect, useRef, useState } from "react";
import AnimatedNumber from "./AnimatedNumber.jsx";
import { fmtCents } from "../utils.js";
import { T } from "../theme.js";

// Sub-cent prices are real on Polymarket (a 0.5¢ longshot), and rounding to
// whole cents showed them as 0¢ — and flattered 99.6¢ into 100¢. Polymarket's
// own UI shows one decimal, so match it: one decimal normally, two below 0.1¢
// so a genuine 0.05¢ isn't shown as zero either. fmtCents trims trailing
// zeros, so ordinary prices still read "45¢", not "45.0¢".
const fmtLive = (n) =>
  fmtCents(n > 0 && n < 0.1 ? Math.round(n * 100) / 100 : Math.round(n * 10) / 10);

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
      <AnimatedNumber value={cents} format={fmtLive} duration={500} />
    </span>
  );
}
