import { useEffect } from "react";
import { T, card, btn } from "../theme.js";

// Reusable modal that asks the user to confirm before a destructive action.
export default function ConfirmDialog({
  title,
  message,
  detail,
  confirmLabel,
  onConfirm,
  onCancel,
}) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(26, 29, 35, 0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ ...card, width: "min(440px, 90vw)", padding: 22 }}
      >
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
          {title}
        </div>
        <div style={{ fontSize: 13, color: T.sub, lineHeight: 1.5 }}>
          {message}
        </div>
        {detail && (
          <div style={{ fontSize: 12, color: T.red, marginTop: 8 }}>
            {detail}
          </div>
        )}
        <div
          style={{
            display: "flex",
            gap: 10,
            justifyContent: "flex-end",
            marginTop: 18,
          }}
        >
          <button
            onClick={onCancel}
            style={{ ...btn.ghost, fontSize: 13, padding: "8px 14px" }}
          >
            Cancel
          </button>
          <button
            autoFocus
            onClick={onConfirm}
            style={{
              ...btn.primary,
              fontSize: 13,
              padding: "8px 14px",
              background: T.red,
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
