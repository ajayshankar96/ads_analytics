import React, { useState } from "react";

/**
 * New Advertiser onboarding wizard (6 steps). Steps 1 (Basics) and 2 (Commercial)
 * are built; steps 3-6 are stubbed and added feature-by-feature.
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
  muted: "#768EA7", bg: "#F7F8FA", selBg: "#F0F4FF",
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
    background: state === "active" ? c.blue : state === "done" ? "#0F8C6A" : "#fff",
    color: state === "future" ? c.muted : "#fff",
    border: state === "future" ? `2px solid ${c.line}` : "2px solid transparent",
  }),
  stepLabel: (state) => ({ marginLeft: 8, fontSize: 13, fontWeight: 600, whiteSpace: "nowrap",
    color: state === "active" ? c.blue : state === "done" ? "#0F8C6A" : c.muted }),
  connector: { flex: 1, height: 2, background: c.line, margin: "0 10px", minWidth: 14 },

  body: { padding: "28px 32px 8px" },
  secTitle: { fontSize: 18, fontWeight: 800, color: c.ink, marginBottom: 4 },
  secSub: { fontSize: 13.5, color: c.sub, lineHeight: 1.5, marginBottom: 24 },
  secLabel: { fontSize: 12, fontWeight: 700, letterSpacing: ".06em", color: c.muted, textTransform: "uppercase", margin: "18px 0 12px" },

  grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 22, marginBottom: 22 },
  field: { display: "flex", flexDirection: "column" },
  label: { fontSize: 13.5, fontWeight: 600, color: c.ink, marginBottom: 8 },
  req: { color: "#C8321E", marginLeft: 3 },
  input: { border: `1px solid ${c.line}`, borderRadius: 9, padding: "12px 14px", fontSize: 14, color: c.ink, outline: "none", width: "100%" },
  help: { fontSize: 12, color: c.muted, marginTop: 6 },
  errText: { fontSize: 12.5, color: "#C8321E", marginTop: 14, fontWeight: 600 },

  // buy-type radio cards
  radioGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 26 },
  radioCard: (sel) => ({ display: "flex", alignItems: "flex-start", gap: 14, padding: "18px 20px", borderRadius: 12,
    cursor: "pointer", background: sel ? c.selBg : "#fff", border: sel ? `2px solid ${c.blue}` : `1.5px solid ${c.line}` }),
  radioDot: (sel) => ({ width: 18, height: 18, borderRadius: "50%", flexShrink: 0, marginTop: 2,
    border: sel ? `5px solid ${c.blue}` : `2px solid ${c.line}`, background: "#fff" }),
  cardIcon: (sel) => ({ width: 38, height: 38, borderRadius: 9, flexShrink: 0, display: "flex", alignItems: "center",
    justifyContent: "center", fontSize: 18, background: sel ? c.blue : "#EEF2F9" }),
  cardTitle: { fontSize: 15, fontWeight: 700, color: c.ink },
  cardDesc: { fontSize: 12.5, color: c.sub, marginTop: 3, lineHeight: 1.45 },

  suffixWrap: { display: "flex", alignItems: "stretch", border: `1px solid ${c.line}`, borderRadius: 9, overflow: "hidden" },
  suffixInput: { border: "none", padding: "12px 14px", fontSize: 14, color: c.ink, outline: "none", width: "100%" },
  suffixBox: { display: "flex", alignItems: "center", padding: "0 14px", borderLeft: `1px solid ${c.line}`, color: c.muted, fontSize: 14, background: c.bg },

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

const BUY_TYPES = [
  { id: "CPC", icon: "🖱️", title: "CPC", desc: "Cost per click — fixed rate per click delivered" },
  { id: "ROAS", icon: "📈", title: "ROAS", desc: "Revenue share — performance against committed return" },
];

export default function AdvertiserWizard({ onClose }) {
  const [step, setStep] = useState(1);
  const [data, setData] = useState({
    name: "", category: "", description: "",
    buy_type: "ROAS", roas_multiplier: "", cpc_rate: "", budget_hint: "",
    gst: "", pan: "",
  });
  const [logo, setLogo] = useState(null);
  const [error, setError] = useState("");

  const set = (patch) => setData((d) => ({ ...d, ...patch }));

  const onLogo = (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) setLogo({ name: f.name, url: URL.createObjectURL(f) });
  };

  const validate = () => {
    if (step === 1) {
      if (!data.name.trim() || !data.category) return "Advertiser name and Industry / Category are required.";
    }
    if (step === 2) {
      if (data.buy_type === "ROAS" && !String(data.roas_multiplier).trim()) return "Committed ROAS multiplier is required.";
      if (data.buy_type === "CPC" && !String(data.cpc_rate).trim()) return "CPC rate is required.";
      if (!data.gst.trim() || !data.pan.trim()) return "GST number and PAN number are required.";
      if (data.gst.trim().length !== 15) return "GST number must be a 15-character GSTIN.";
      if (data.pan.trim().length !== 10) return "PAN number must be 10 characters.";
    }
    return "";
  };

  const next = () => {
    const err = validate();
    if (err) { setError(err); return; }
    setError("");
    if (step < STEPS.length) setStep(step + 1);
    else onClose();
  };

  const renderStep = () => {
    if (step === 1) {
      return (
        <>
          <div style={s.secTitle}>Advertiser basics</div>
          <div style={s.secSub}>
            This information persists across all downstream dashboards. The Advertiser ID is auto-generated on save.
          </div>
          <div style={s.grid2}>
            <div style={s.field}>
              <label style={s.label}>Advertiser name<span style={s.req}>*</span></label>
              <input style={s.input} placeholder="e.g. Plum Goodness" value={data.name} onChange={(e) => set({ name: e.target.value })} />
              <div style={s.help}>Legal entity name as on registration</div>
            </div>
            <div style={s.field}>
              <label style={s.label}>Industry / Category<span style={s.req}>*</span></label>
              <select style={s.input} value={data.category} onChange={(e) => set({ category: e.target.value })}>
                <option value="">Select a category…</option>
                {CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
              </select>
            </div>
          </div>
          <div style={{ ...s.field, marginBottom: 22 }}>
            <label style={s.label}>Brand logo</label>
            <label style={s.dropzone}>
              <input type="file" accept="image/svg+xml,image/png" style={{ display: "none" }} onChange={onLogo} />
              {logo ? <img src={logo.url} alt="logo" style={s.logoPreview} /> : <div style={s.dzIcon}>🖼️</div>}
              <div>
                <div style={s.dzTitle}>{logo ? logo.name : "Drop logo here or click to upload"}</div>
                <div style={s.dzSub}>SVG preferred · 512×512 PNG accepted · ≤ 500 KB</div>
              </div>
            </label>
          </div>
          <div style={s.field}>
            <label style={s.label}>Description (optional)</label>
            <textarea style={s.textarea} placeholder="A short blurb shown internally to Ops & Campaign Managers"
              value={data.description} onChange={(e) => set({ description: e.target.value })} />
          </div>
        </>
      );
    }

    if (step === 2) {
      const isRoas = data.buy_type === "ROAS";
      return (
        <>
          <div style={s.secTitle}>Commercial terms</div>
          <div style={s.secSub}>
            Buy type and rate carry through to every campaign created for this advertiser. GST and PAN are required for invoicing.
          </div>

          <div style={s.secLabel}>Buy type <span style={s.req}>*</span></div>
          <div style={s.radioGrid}>
            {BUY_TYPES.map((bt) => {
              const sel = data.buy_type === bt.id;
              return (
                <div key={bt.id} style={s.radioCard(sel)} onClick={() => set({ buy_type: bt.id })}>
                  <div style={s.radioDot(sel)} />
                  <div style={s.cardIcon(sel)}>{bt.icon}</div>
                  <div>
                    <div style={s.cardTitle}>{bt.title}</div>
                    <div style={s.cardDesc}>{bt.desc}</div>
                  </div>
                </div>
              );
            })}
          </div>

          <div style={s.grid2}>
            {isRoas ? (
              <div style={s.field}>
                <label style={s.label}>Committed ROAS multiplier<span style={s.req}>*</span></label>
                <div style={s.suffixWrap}>
                  <input style={s.suffixInput} type="number" placeholder="4.5"
                    value={data.roas_multiplier} onChange={(e) => set({ roas_multiplier: e.target.value })} />
                  <div style={s.suffixBox}>x</div>
                </div>
                <div style={s.help}>Revenue / spend target across the brand</div>
              </div>
            ) : (
              <div style={s.field}>
                <label style={s.label}>CPC rate (₹)<span style={s.req}>*</span></label>
                <input style={s.input} type="number" placeholder="e.g. 12"
                  value={data.cpc_rate} onChange={(e) => set({ cpc_rate: e.target.value })} />
                <div style={s.help}>Fixed rate charged per click delivered</div>
              </div>
            )}
            <div style={s.field}>
              <label style={s.label}>Default campaign budget hint (₹)</label>
              <input style={s.input} placeholder="e.g. 5,00,000"
                value={data.budget_hint} onChange={(e) => set({ budget_hint: e.target.value })} />
              <div style={s.help}>Pre-fills the budget field when creating new campaigns. Optional.</div>
            </div>
          </div>

          <div style={s.secLabel}>Tax & registration</div>
          <div style={s.grid2}>
            <div style={s.field}>
              <label style={s.label}>GST number<span style={s.req}>*</span></label>
              <input style={s.input} placeholder="29AABCU9603R1ZL" maxLength={15}
                value={data.gst} onChange={(e) => set({ gst: e.target.value.toUpperCase() })} />
              <div style={s.help}>15-character GSTIN · validated on save</div>
            </div>
            <div style={s.field}>
              <label style={s.label}>PAN number<span style={s.req}>*</span></label>
              <input style={s.input} placeholder="AABCU9603R" maxLength={10}
                value={data.pan} onChange={(e) => set({ pan: e.target.value.toUpperCase() })} />
              <div style={s.help}>10-character PAN</div>
            </div>
          </div>
        </>
      );
    }

    return (
      <div style={s.stub}>
        <div style={s.stubBadge}>STEP {step} OF 6</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: c.ink, marginBottom: 6 }}>{STEPS[step - 1].label}</div>
        <div>Coming next — we're building the wizard one step at a time.</div>
      </div>
    );
  };

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={(e) => e.stopPropagation()}>
        <div style={s.header}>
          <div>
            <div style={s.eyebrow}><span>👤➕</span> SALES DASHBOARD · STAGE 1</div>
            <div style={s.title}>Onboard new advertiser</div>
          </div>
          <button style={s.close} onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div style={s.stepper}>
          {STEPS.map((st, i) => {
            const state = stepState(st.id, step);
            return (
              <div style={s.stepWrap} key={st.id}>
                <div style={s.circle(state)} onClick={() => st.id < step && setStep(st.id)} title={st.label}>
                  {state === "done" ? "✓" : st.id}
                </div>
                <span style={s.stepLabel(state)}>{st.label}</span>
                {i < STEPS.length - 1 && <div style={s.connector} />}
              </div>
            );
          })}
        </div>

        <div style={s.body}>
          {renderStep()}
          {error && <div style={s.errText}>{error}</div>}
        </div>

        <div style={s.footer}>
          <div style={s.footNote}>Step {step} of 6 · Saved automatically as you go</div>
          <div style={{ display: "flex", gap: 10 }}>
            {step > 1 && <button style={s.ghost} onClick={() => { setError(""); setStep(step - 1); }}>← Back</button>}
            <button style={s.primary} onClick={next}>
              {step === STEPS.length ? "Done" : "Continue"} <span>→</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
