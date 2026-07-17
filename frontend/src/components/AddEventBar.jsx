import { useState } from "react";
import { T, monoText, btn } from "../theme.js";

export default function AddEventBar({ onFind, busy }) {
  const [value, setValue] = useState("");

  function submit() {
    if (!value.trim() || busy) return;
    onFind(value.trim());
  }

  return (
    <div style={{ display: "flex", gap: 10 }}>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        placeholder="Event URL/ID (several with ;) — or search: soccer, o/u 3.5, over < 0.40"
        style={{
          ...monoText,
          flex: 1,
          fontSize: 13,
          padding: "10px 14px",
          border: `1px solid ${T.border}`,
          borderRadius: 8,
          color: T.ink,
        }}
      />
      <button
        onClick={submit}
        disabled={busy || !value.trim()}
        style={{ ...btn.primary, fontSize: 13, padding: "10px 18px" }}
      >
        {busy ? "Searching…" : "Find event"}
      </button>
    </div>
  );
}
