import React, { useState } from "react";

/**
 * New Advertiser onboarding wizard (6 steps). Step 1 (Basics) is built;
 * steps 2-6 are stubbed and will be implemented feature-by-feature.
 * UI-only for now — persistence is wired once the schema is finalized.
 */

const STEPS = [
  { id: 1, label: "Basics" },
  { id: 2, label: "Commercial" },
  { id: 3, label: "Performance Goal" },
  { id: 4, label: "POC" },
  { id: 5, label: "Agreement" },
  { id: 6, label: "Review" },
];

const CATEGORIES = [
  "Beauty & Personal Care", "Skincare", "Apparel & Fashion", "Jewellery",
  "Audio & Wearables", "Consumer Electronics", "Food & Beverage",
  "Home & Kitchen", "Travel & Hospitality", "Health & Wellness", "Other",
];

const c = {
  blue: "#2E5BFF", ink: "#0F1724", sub: "#52606D", line: "#E6EAF0",
  muted: "#768EA7", bg: "#F7F8FA",
};

const s = {
  overlay: { position: "fixed", inset: 0, background: "rgba(15,23,36,0.45)", zIndex: 10000,
    display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "32px 20px", overflowY: "auto" },
  modal: { background: "#fff", borderRadius: 16, width: "100%", maxWidth: 920,
    boxShadow: "0 20px 60px rgba(15,23,36,0.25)", overflow: "hidden", display: "flex", flexDirection: "column" },

  header: { padding: "24px 32px 18px", display: "flex", justifyContent: "space-between", alignItems: "flex-start" },
  eyebrow: { fontSize: 12, fontWeight: 700, letterSpacing: ".06em", color: c.blue, textTransform: "uppercase", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 },
  title: { fontSize: 26, fontWeight: 800, color: c.ink, letterSpacing: "-.01em" },
  close: { width: 38, height: 38, borderRadius: 9, border: `1px solid ${c.line}`, background: "#fff",
    cursor: "pointer", fontSize: 18, color: c.muted, lineHeight: 1 },

  stepper: { display: "flex", alignItems: "center", padding: "16px 32px", background: c.bg, borderTop: `1px solid ${c.line}`, borderBottom: `1px solid ${c.line}` },
  stepWrap: { display: "flex", alignItems: "center", flex: 1, minWidth: 0 },
  circle: (state) => ({
    width: 30, height: 30, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: 13, fontWeight: 700, cursor: "pointer",
    background: state === "active" ? c.blue : "#fff",
    color: state === "active" ? "#fff" : state === "done" ? c.blue : c.muted,
    border: state === "future" ? `2px solid ${c.line}` : `2px solid ${c.blue}`,
  }),
  stepLabel: (state) => ({ marginLeft: 8, fontSize: 13, fontWeight: 600, whiteSpace: "nowrap",
    color: state === "active" ? c.blue : state === "done" ? c.ink : c.muted }),
  connector: { flex: 1, height: 2, background: c.line, margin: "0 10px", minWidth: 14 },

  body: { padding: "28px 32px 8px" },
  secTitle: { fontSize: 18, fontWeight: 800, color: c.ink, marginBottom: 4 },
  secSub: { fontSize: 13.5, color: c.sub, lineHeight: 1.5, marginBottom: 24 },

  grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 22, marginBottom: 22 },
  field: { display: "flex", flexDirection: "column" },
  label: { fontSize: 13.5, fontWeight: 600, color: c.ink, marginBottom: 8 },
  req: { color: "#C8321E", marginLeft: 3 },
  input: { border: `1px solid ${c.line}`, borderRadius: 9, padding: "12px 14px", fontSize: 14, color: c.ink, outline: "none", width: "100%" },
  help: { fontSize: 12, color: c.muted, marginTop: 6 },
  errText: { fontSize: 12, color: "#C8321E", marginTop: 6 },

  dropzone: { border: `1.5px dashed ${c.line}`, borderRadius: 12, padding: "20px 22px", display: "flex",
    alignItems: "center", gap: 16, cursor: "pointer", background: "#FCFDFE" },
  dzIcon: { width: 44, height: 44, borderRadius: 10, background: "#EEF2F9", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 },
  dzTitle: { fontSize: 14, fontWeight: 700, color: c.ink },
  dzSub: { fontSize: 12, color: c.muted, marginTop: 2 },
  logoPreview: { width: 44, height: 44, borderRadius: 10, objectFit: "contain", border: `1px solid ${c.line}`, background: "#fff" },

  textarea: { border: `1px solid ${c.line}`, borderRadius: 9, padding: "12px 14px", fontSize: 14, color: c.ink, outline: "none", width: "100%", minHeight: 92, resize: "vertical", fontFamily: "inherit" },

  footer: { padding: "18px 32px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: `1px solid ${c.line}`, marginTop: 20 },
  footNote: { fontSize: 12.5, color: c.muted },
  primary: { background: c.blue, color: "#fff", border: "none", borderRadius: 10, padding: "12px 22px",
    fontSize: 14, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8 },
  ghost: { background: "#fff", color: c.sub, border: `1px solid ${c.line}`, borderRadius: 10, padding: "12px 18px", fontSize: 14, fontWeight: 600, cursor: "pointer" },

  stub: { padding: "60px 20px", textAlign: "center", color: c.muted },
  stubBadge: { display: "inline-block", padding: "4px 12px", borderRadius: 20, background: "#EEF2F9", color: c.blue, fontSize: 12, fontWeight: 700, marginBottom: 14 },
};

function stepState(stepId, current) {
  if (stepId === current) return "active";
  if (stepId < current) return "done";
  return "future";
}

export default function AdvertiserWizard({ onClose }) {
  const [step, setStep] = useState(1);
  const [data, setData] = useState({ name: "", category: "", description: "" });
  const [logo, setLogo] = useState(null); // { name, url }
  const [error, setError] = useState("");

  const onLogo = (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) setLogo({ name: f.name, url: URL.createObjectURL(f) });
  };

  const next = () => {
    if (step === 1) {
      if (!data.name.trim() || !data.category) {
        setError("Advertiser name and Industry / Category are required.");
        return;
      }
    }
    setError("");
    if (step < STEPS.length) setStep(step + 1);
    else onClose();
  };

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={s.header}>
          <div>
            <div style={s.eyebrow}>
              <span>👤➕</span> SALES DASHBOARD · STAGE 1
            </div>
            <div style={s.title}>Onboard new advertiser</div>
          </div>
          <button style={s.close} onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* Stepper */}
        <div style={s.stepper}>
          {STEPS.map((st, i) => {
            const state = stepState(st.id, step);
            return (
              <div style={s.stepWrap} key={st.id}>
                <div
                  style={s.circle(state)}
                  onClick={() => st.id < step && setStep(st.id)}
                  title={st.label}
                >
                  {state === "done" ? "✓" : st.id}
                </div>
                <span style={s.stepLabel(state)}>{st.label}</span>
                {i < STEPS.length - 1 && <div style={s.connector} />}
              </div>
            );
          })}
        </div>

        {/* Body */}
        {step === 1 ? (
          <div style={s.body}>
            <div style={s.secTitle}>Advertiser basics</div>
            <div style={s.secSub}>
              This information persists across all downstream dashboards. The Advertiser ID is auto-generated on save.
            </div>

            <div style={s.grid2}>
              <div style={s.field}>
                <label style={s.label}>Advertiser name<span style={s.req}>*</span></label>
                <input
                  style={s.input}
                  placeholder="e.g. Plum Goodness"
                  value={data.name}
                  onChange={(e) => setData({ ...data, name: e.target.value })}
                />
                <div style={s.help}>Legal entity name as on registration</div>
              </div>
              <div style={s.field}>
                <label style={s.label}>Industry / Category<span style={s.req}>*</span></label>
                <select
                  style={s.input}
                  value={data.category}
                  onChange={(e) => setData({ ...data, category: e.target.value })}
                >
                  <option value="">Select a category…</option>
                  {CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
                </select>
              </div>
            </div>

            <div style={{ ...s.field, marginBottom: 22 }}>
              <label style={s.label}>Brand logo</label>
              <label style={s.dropzone}>
                <input type="file" accept="image/svg+xml,image/png" style={{ display: "none" }} onChange={onLogo} />
                {logo ? (
                  <img src={logo.url} alt="logo" style={s.logoPreview} />
                ) : (
                  <div style={s.dzIcon}>🖼️</div>
                )}
                <div>
                  <div style={s.dzTitle}>{logo ? logo.name : "Drop logo here or click to upload"}</div>
                  <div style={s.dzSub}>SVG preferred · 512×512 PNG accepted · ≤ 500 KB</div>
                </div>
              </label>
            </div>

            <div style={s.field}>
              <label style={s.label}>Description (optional)</label>
              <textarea
                style={s.textarea}
                placeholder="A short blurb shown internally to Ops & Campaign Managers"
                value={data.description}
                onChange={(e) => setData({ ...data, description: e.target.value })}
              />
            </div>

            {error && <div style={s.errText}>{error}</div>}
          </div>
        ) : (
          <div style={s.body}>
            <div style={s.stub}>
              <div style={s.stubBadge}>STEP {step} OF 6</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: c.ink, marginBottom: 6 }}>
                {STEPS[step - 1].label}
              </div>
              <div>Coming next — we're building the wizard one step at a time.</div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={s.footer}>
          <div style={s.footNote}>Step {step} of 6 · Saved automatically as you go</div>
          <div style={{ display: "flex", gap: 10 }}>
            {step > 1 && <button style={s.ghost} onClick={() => setStep(step - 1)}>← Back</button>}
            <button style={s.primary} onClick={next}>
              {step === STEPS.length ? "Done" : "Continue"} <span>→</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
