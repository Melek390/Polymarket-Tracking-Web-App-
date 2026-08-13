import { T, btn, card } from "../../theme.js";

// The centred card every signed-out page sits in (login, register, forgot,
// reset). Kept in one file so the four pages cannot drift apart.
export default function AuthShell({ title, subtitle, children, footer }) {
  return (
    <div style={{
      minHeight: "100vh", background: T.soft,
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: "40px 20px", fontFamily: T.ui,
    }}>
      <div style={{ width: "100%", maxWidth: 400 }}>
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: T.ink }}>Market Tracker</div>
        </div>
        <div style={{ ...card, padding: 24 }}>
          <h1 style={{ fontSize: 17, fontWeight: 700, margin: "0 0 4px", color: T.ink }}>
            {title}
          </h1>
          {subtitle && (
            <p style={{ fontSize: 12, color: T.sub, margin: "0 0 18px", lineHeight: 1.5 }}>
              {subtitle}
            </p>
          )}
          {children}
        </div>
        {footer && (
          <div style={{ textAlign: "center", marginTop: 14, fontSize: 12, color: T.sub }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export const field = {
  width: "100%", boxSizing: "border-box", padding: "9px 11px",
  border: `1px solid ${T.border}`, borderRadius: 8, fontSize: 14,
  fontFamily: T.ui, color: T.ink, background: "#fff", marginBottom: 12,
};

export const fieldLabel = {
  display: "block", fontSize: 11, fontWeight: 600, color: T.sub,
  textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5,
};

export const submitBtn = {
  ...btn.primary, width: "100%", padding: "10px 14px", fontSize: 14,
};

export function ErrorNote({ children }) {
  if (!children) return null;
  return (
    <div style={{
      background: "#FEF2F2", border: `1px solid ${T.red}`, color: T.red,
      borderRadius: 8, padding: "8px 11px", fontSize: 12,
      marginBottom: 12, lineHeight: 1.5,
    }}>
      {children}
    </div>
  );
}

export function OkNote({ children }) {
  if (!children) return null;
  return (
    <div style={{
      background: "#ECFDF5", border: `1px solid ${T.green}`, color: T.green,
      borderRadius: 8, padding: "8px 11px", fontSize: 12,
      marginBottom: 12, lineHeight: 1.5,
    }}>
      {children}
    </div>
  );
}

export function LinkButton({ onClick, children }) {
  return (
    <button onClick={onClick} style={{
      background: "none", border: "none", padding: 0, cursor: "pointer",
      color: T.ink, fontFamily: T.ui, fontSize: 12, fontWeight: 600,
      textDecoration: "underline",
    }}>
      {children}
    </button>
  );
}
