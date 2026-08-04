import { useEffect, useMemo, useState } from "react";
import { T, card, monoText, btn } from "../../theme.js";
import { fetchMlbTeams } from "../../api/client.js";
import {
  TAG_COLORS, addTag, colorOf, persistTeamTags, removeTag, tagsFor, toggleTeamTag,
} from "../../teamTags.js";

// Small coloured label. Exported because the table renders these under each
// club name too, and they must look identical in both places.
export function TeamTag({ tag }) {
  return (
    <span style={{
      display: "inline-block", fontFamily: T.ui, fontSize: 9, fontWeight: 700,
      letterSpacing: 0.3, color: "#fff", background: colorOf(tag.color),
      borderRadius: 4, padding: "1px 5px", lineHeight: 1.4,
    }}>
      {tag.label}
    </span>
  );
}

// Create tags, then tick them against clubs. No cap on either, by request.
export default function TeamTagsDialog({ state, onChange, onClose }) {
  const [teams, setTeams] = useState(null);
  const [label, setLabel] = useState("");
  const [color, setColor] = useState(TAG_COLORS[0].key);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetchMlbTeams().then(setTeams).catch(() => setTeams([]));
  }, []);

  const apply = (next) => { onChange(next); persistTeamTags(next); };
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (teams || []).filter((t) => !q || t.name.toLowerCase().includes(q)
      || (t.abbr || "").toLowerCase().includes(q));
  }, [teams, search]);

  const field = {
    ...monoText, fontSize: 13, padding: "8px 10px",
    border: `1px solid ${T.border}`, borderRadius: 8, color: T.ink,
  };

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(26,29,35,0.45)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 140,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        ...card, width: "min(720px, 95vw)", maxHeight: "88vh",
        display: "flex", flexDirection: "column", padding: 20,
      }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Team tags</div>
          <button onClick={onClose} style={{ ...btn.ghost, fontSize: 22, lineHeight: 1, padding: "0 4px" }}>×</button>
        </div>
        <div style={{ fontSize: 12, color: T.sub, marginTop: 2 }}>
          Label the clubs you follow — the tags show under the team name in the games list.
        </div>

        {/* create */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 14, flexWrap: "wrap" }}>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && label.trim()) { apply(addTag(state, label, color)); setLabel(""); }
            }}
            placeholder="New tag name…"
            style={{ ...field, flex: 1, minWidth: 180 }}
          />
          {TAG_COLORS.map((c) => (
            <button key={c.key} onClick={() => setColor(c.key)} title={c.key}
              style={{ width: 22, height: 22, borderRadius: "50%", cursor: "pointer",
                background: c.dot,
                border: c.key === color ? `2px solid ${T.ink}` : "1px solid rgba(0,0,0,0.12)" }} />
          ))}
          <button
            onClick={() => { if (label.trim()) { apply(addTag(state, label, color)); setLabel(""); } }}
            disabled={!label.trim()}
            style={{ ...btn.green, fontSize: 13, padding: "9px 16px" }}
          >
            Add tag
          </button>
        </div>

        {/* existing tags */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12, minHeight: 24 }}>
          {state.tags.length === 0
            ? <span style={{ fontSize: 12, color: T.faint }}>No tags yet — create one above.</span>
            : state.tags.map((t) => (
                <span key={t.id} style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  border: `1px solid ${T.border}`, borderRadius: 999, padding: "3px 6px 3px 8px",
                }}>
                  <TeamTag tag={t} />
                  <button onClick={() => apply(removeTag(state, t.id))} title="Delete this tag"
                    style={{ ...btn.ghost, fontSize: 13, padding: "0 3px", color: T.faint }}>✕</button>
                </span>
              ))}
        </div>

        {/* assign */}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Find a club…"
          style={{ ...field, marginTop: 14 }}
        />
        <div style={{ overflowY: "auto", marginTop: 10, borderTop: `1px solid ${T.border}` }}>
          {teams === null && <div style={{ padding: 16, fontSize: 13, color: T.faint }}>Loading clubs…</div>}
          {teams?.length === 0 && (
            <div style={{ padding: 16, fontSize: 13, color: T.red }}>Could not load the club list.</div>
          )}
          {shown.map((tm) => {
            const mine = tagsFor(state, tm.name);
            return (
              <div key={tm.name} style={{
                display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
                padding: "8px 2px", borderBottom: `1px solid ${T.border}`,
              }}>
                <span style={{ fontFamily: T.ui, fontSize: 13, fontWeight: 500, minWidth: 190 }}>
                  {tm.name} <span style={{ color: T.faint, fontSize: 11 }}>{tm.abbr}</span>
                </span>
                {state.tags.map((t) => {
                  const on = mine.some((x) => x.id === t.id);
                  return (
                    <button key={t.id} onClick={() => apply(toggleTeamTag(state, tm.name, t.id))}
                      title={on ? "Remove this tag" : "Add this tag"}
                      style={{
                        fontFamily: T.ui, fontSize: 10, fontWeight: 700, cursor: "pointer",
                        borderRadius: 4, padding: "3px 7px",
                        color: on ? "#fff" : T.sub,
                        background: on ? colorOf(t.color) : "transparent",
                        border: `1px solid ${on ? colorOf(t.color) : T.border}`,
                        opacity: on ? 1 : 0.75,
                      }}>
                      {t.label}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
