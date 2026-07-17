import { T, monoText } from "../theme.js";

export default function OutcomeChips({ outcomes }) {
  return (
    <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {outcomes.map((label, i) => {
        const color = T.series[i % T.series.length];
        return (
          <span
            key={label}
            style={{
              ...monoText,
              fontSize: 11,
              padding: "2px 8px",
              borderRadius: 999,
              border: `1px solid ${color}`,
              color,
              whiteSpace: "nowrap",
            }}
          >
            {label}
          </span>
        );
      })}
    </span>
  );
}
