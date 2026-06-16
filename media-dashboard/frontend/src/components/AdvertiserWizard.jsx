import React, { useState } from "react";
import { createAdvertiser, updateAdvertiser, submitAdvertiser } from "../api";
import { GOOGLE_WEB_CLIENT_ID, useGisLoaded, getGmailAccessToken, sendViaGmail, textToHtml } from "../lib/gmail";

/**
 * New Advertiser onboarding wizard — 7 steps:
 * 1 Basics · 2 Commercial · 3 Performance Goal · 4 POC · 5 Agreement & PO ·
 * 6 Review · 7 Send welcome email to the POC.
 */

const STEPS = [
  { id: 1, label: "Basics" },
  { id: 2, label: "Commercial" },
  { id: 3, label: "Performance Goal" },
  { id: 4, label: "POC" },
  { id: 5, label: "Agreement" },
  { id: 6, label: "Review" },
  { id: 7, label: "Send Email" },
];

// Welcome email draft sent to the POC after onboarding (editable before send).
function buildWelcomeDraft(brand) {
  const b = (brand || "").trim() || "there";
  return `Hi ${b} team,

Welcome aboard. To launch your first RMN campaign, please share the following:
• Brand logo (SVG + 512×512 PNG)
• Campaign creatives (1200×628 and 1080×1080)
• Campaign details: offer copy, landing page, dates
• Data reporting structure preference (daily / weekly)
• Coupon codes (unique or static) where applicable

Reply-all to this thread; our Ops team will take it from here.`;
}

const CATEGORIES = [
  "Beauty & Personal Care", "Skincare", "Apparel & Fashion", "Jewellery",
  "Audio & Wearables", "Consumer Electronics", "Food & Beverage",
  "Home & Kitchen", "Travel & Hospitality", "Health & Wellness", "Other",
];

const c = {
  blue: "#2E5BFF", ink: "#0F1724", sub: "#52606D", line: "#E6EAF0",
  muted: "#768EA7", bg: "#F7F8FA", selBg: "#F0F4FF",
  green: "#0F8C6A", amber: "#B7791F", red: "#C8321E",
};

const s = {
  overlay: { position: "fixed", inset: 0, background: "rgba(15,23,36,0.45)", zIndex: 10000,
    display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "32px 20px", overflowY: "auto" },
  modal: { background: "#fff", borderRadius: 16, width: "100%", maxWidth: 920,
    boxShadow: "0 20px 60px rgba(15,23,36,0.25)", overflow: "hidden", display: "flex", flexDirection: "column" },

  header: { padding: "24px 32px 18px", display: "flex", justifyContent: "space-between", alignItems: "flex-start" },
  eyebrow: { fontSize: 12, fontWeight: 700, letterSpacing: ".06em", color: c.blue, textTransform: "uppercase", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 },
  title: { fontSize: 26, fontWeight: 800, color: c.ink, letterSpacing: "-.01em" },
  close: { width: 38, height: 38, borderRadius: 9, border: `1px solid ${c.line}`, background: "#fff", cursor: "pointer", fontSize: 18, color: c.muted, lineHeight: 1 },

  stepper: { display: "flex", alignItems: "center", padding: "16px 32px", background: c.bg, borderTop: `1px solid ${c.line}`, borderBottom: `1px solid ${c.line}` },
  stepWrap: { display: "flex", alignItems: "center", flex: 1, minWidth: 0 },
  circle: (state) => ({ width: 30, height: 30, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: 13, fontWeight: 700, cursor: "pointer",
    background: state === "active" ? c.blue : state === "done" ? c.green : "#fff",
    color: state === "future" ? c.muted : "#fff", border: state === "future" ? `2px solid ${c.line}` : "2px solid transparent" }),
  stepLabel: (state) => ({ marginLeft: 8, fontSize: 13, fontWeight: 600, whiteSpace: "nowrap",
    color: state === "active" ? c.blue : state === "done" ? c.green : c.muted }),
  connector: { flex: 1, height: 2, background: c.line, margin: "0 10px", minWidth: 14 },

  body: { padding: "28px 32px 8px" },
  secTitle: { fontSize: 18, fontWeight: 800, color: c.ink, marginBottom: 4 },
  secSub: { fontSize: 13.5, color: c.sub, lineHeight: 1.5, marginBottom: 24 },
  secLabel: { fontSize: 12, fontWeight: 700, letterSpacing: ".06em", color: c.muted, textTransform: "uppercase", margin: "18px 0 12px" },

  grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 22, marginBottom: 22 },
  field: { display: "flex", flexDirection: "column" },
  label: { fontSize: 13.5, fontWeight: 600, color: c.ink, marginBottom: 8 },
  req: { color: c.red, marginLeft: 3 },
  input: { border: `1px solid ${c.line}`, borderRadius: 9, padding: "12px 14px", fontSize: 14, color: c.ink, outline: "none", width: "100%", fontFamily: "inherit" },
  help: { fontSize: 12, color: c.muted, marginTop: 6 },
  errText: { fontSize: 12.5, color: c.red, marginTop: 14, fontWeight: 600 },

  radioGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 26 },
  radioCard: (sel) => ({ display: "flex", alignItems: "flex-start", gap: 14, padding: "18px 20px", borderRadius: 12,
    cursor: "pointer", background: sel ? c.selBg : "#fff", border: sel ? `2px solid ${c.blue}` : `1.5px solid ${c.line}` }),
  radioDot: (sel) => ({ width: 18, height: 18, borderRadius: "50%", flexShrink: 0, marginTop: 2, border: sel ? `5px solid ${c.blue}` : `2px solid ${c.line}`, background: "#fff" }),
  cardIcon: (sel) => ({ width: 38, height: 38, borderRadius: 9, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, background: sel ? c.blue : "#EEF2F9" }),
  cardTitle: { fontSize: 15, fontWeight: 700, color: c.ink },
  cardDesc: { fontSize: 12.5, color: c.sub, marginTop: 3, lineHeight: 1.45 },

  suffixWrap: { display: "flex", alignItems: "stretch", border: `1px solid ${c.line}`, borderRadius: 9, overflow: "hidden" },
  affixInput: { border: "none", padding: "12px 14px", fontSize: 14, color: c.ink, outline: "none", width: "100%", fontFamily: "inherit" },
  suffixBox: { display: "flex", alignItems: "center", padding: "0 14px", borderLeft: `1px solid ${c.line}`, color: c.muted, fontSize: 14, background: c.bg },
  prefixBox: { display: "flex", alignItems: "center", padding: "0 14px", borderRight: `1px solid ${c.line}`, color: c.muted, fontSize: 14, background: c.bg },

  dropzone: { border: `1.5px dashed ${c.line}`, borderRadius: 12, padding: "20px 22px", display: "flex", alignItems: "center", gap: 16, cursor: "pointer", background: "#FCFDFE", marginBottom: 4 },
  dzIcon: { width: 44, height: 44, borderRadius: 10, background: "#EEF2F9", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 },
  dzTitle: { fontSize: 14, fontWeight: 700, color: c.ink },
  dzSub: { fontSize: 12, color: c.muted, marginTop: 2 },
  logoPreview: { width: 44, height: 44, borderRadius: 10, objectFit: "contain", border: `1px solid ${c.line}`, background: "#fff" },

  textarea: { border: `1px solid ${c.line}`, borderRadius: 9, padding: "12px 14px", fontSize: 14, color: c.ink, outline: "none", width: "100%", minHeight: 92, resize: "vertical", fontFamily: "inherit" },

  // RAG panel
  ragPanel: { background: c.bg, borderRadius: 14, padding: "18px 20px", marginTop: 6 },
  ragGrid: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 },
  ragCard: (col) => ({ background: "#fff", borderRadius: 10, padding: "14px 16px", borderLeft: `4px solid ${col}` }),
  ragHead: { display: "flex", alignItems: "center", gap: 8, marginBottom: 8 },
  ragDot: (col) => ({ width: 9, height: 9, borderRadius: "50%", background: col }),
  ragName: { fontSize: 12.5, fontWeight: 800, letterSpacing: ".04em", color: c.ink },
  ragMain: { fontSize: 13.5, color: c.ink, fontWeight: 600, lineHeight: 1.4 },
  ragSub: { fontSize: 12, color: c.muted, marginTop: 6 },

  checkRow: { display: "flex", alignItems: "center", gap: 12, background: c.bg, borderRadius: 10, padding: "14px 16px", marginTop: 6, cursor: "pointer" },
  checkLabel: { fontSize: 14, fontWeight: 700, color: c.ink },

  infoBanner: { display: "flex", gap: 12, background: "#EAF0FF", borderRadius: 12, padding: "16px 18px", marginTop: 22, color: "#274DB0", fontSize: 13.5, lineHeight: 1.5 },

  // review
  revGroup: { border: `1px solid ${c.line}`, borderRadius: 12, padding: "16px 18px", marginBottom: 14 },
  revHead: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  revTitle: { fontSize: 14, fontWeight: 800, color: c.ink },
  editLink: { background: "none", border: "none", color: c.blue, fontSize: 13, fontWeight: 700, cursor: "pointer", padding: 0 },
  revRow: { display: "flex", justifyContent: "space-between", gap: 16, padding: "6px 0", fontSize: 13.5 },
  revKey: { color: c.muted },
  revVal: { color: c.ink, fontWeight: 600, textAlign: "right", maxWidth: "60%", wordBreak: "break-word" },

  footer: { padding: "18px 32px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: `1px solid ${c.line}`, marginTop: 20 },
  footNote: { fontSize: 12.5, color: c.muted },
  primary: { background: c.blue, color: "#fff", border: "none", borderRadius: 10, padding: "12px 22px", fontSize: 14, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8 },
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
const GOAL_TYPES = [
  { id: "ROAS", icon: "🎯", title: "ROAS", desc: "Return on ad spend — revenue per ₹1 spent" },
  { id: "CAC", icon: "🧑‍💼", title: "CAC", desc: "Cost per acquisition — spend per new customer" },
];

export default function AdvertiserWizard({ onClose, advertiser }) {
  const a = advertiser || {};
  const [step, setStep] = useState(a.current_step || 1);
  const [advId, setAdvId] = useState(a.id || null);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState({
    // Basics
    name: a.name || "", category: a.category || "", description: a.description || "",
    // Commercial
    buy_type: a.buy_type || "ROAS", roas_multiplier: a.roas_multiplier ?? "", cpc_rate: a.cpc_rate ?? "",
    budget_hint: a.budget_hint || "", gst: a.gst || "", pan: a.pan || "",
    // Performance goal
    goal_type: a.goal_type || "ROAS", target_roas: a.target_roas ?? "", target_cac: a.target_cac ?? "",
    // POC
    poc_name: a.poc_name || "", poc_designation: a.poc_designation || "", poc_email: a.poc_email || "",
    poc_phone: a.poc_phone || "", cc_finance: !!a.cc_finance,
    // Agreement & PO
    po_ref: a.po_ref || "", contract_start: a.contract_start || "",
  });
  const [logo, setLogo] = useState(a.logo_name ? { name: a.logo_name } : null);
  const [agreementFile, setAgreementFile] = useState(a.agreement_name ? { name: a.agreement_name } : null);
  const [poFile, setPoFile] = useState(a.po_name ? { name: a.po_name } : null);
  const [error, setError] = useState("");

  // Step 7 — welcome email
  useGisLoaded();
  const [emailTo, setEmailTo] = useState(a.poc_email || "");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailStatus, setEmailStatus] = useState(null);   // {type, msg}

  const sendWelcomeEmail = async () => {
    const to = (emailTo || "").split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
    if (!to.length) { setEmailStatus({ type: "error", msg: "Enter at least one recipient." }); return; }
    if (!emailBody.trim()) { setEmailStatus({ type: "error", msg: "Email body is empty." }); return; }
    if (!GOOGLE_WEB_CLIENT_ID) { setEmailStatus({ type: "error", msg: "Google sign-in not configured." }); return; }
    setSendingEmail(true); setEmailStatus(null);
    try {
      const token = await getGmailAccessToken();   // consent popup (first time)
      await sendViaGmail(token, { to, subject: emailSubject, html: textToHtml(emailBody) });
      setEmailStatus({ type: "success", msg: `Email sent to ${to.join(", ")} from your account` });
      setTimeout(onClose, 1400);
    } catch (e) {
      setEmailStatus({ type: "error", msg: e.message });
    } finally { setSendingEmail(false); }
  };

  const set = (patch) => setData((d) => ({ ...d, ...patch }));
  const pickFile = (setter) => (e) => { const f = e.target.files && e.target.files[0]; if (f) setter({ name: f.name, url: URL.createObjectURL(f) }); };

  const buildPayload = (extra = {}) => ({
    ...data,
    logo_name: logo ? logo.name : null,
    agreement_name: agreementFile ? agreementFile.name : null,
    po_name: poFile ? poFile.name : null,
    ...extra,
  });

  const persist = async (extra = {}) => {
    const payload = buildPayload(extra);
    setSaving(true);
    try {
      if (advId) { await updateAdvertiser(advId, payload); return advId; }
      const r = await createAdvertiser(payload);
      setAdvId(r.advertiser.id);
      return r.advertiser.id;
    } finally { setSaving(false); }
  };

  const saveDraft = async () => {
    if (!data.name.trim()) { setError("Enter the advertiser name before saving a draft."); setStep(1); return; }
    try { await persist({ current_step: step, status: "DRAFT" }); onClose(); }
    catch (e) { setError("Save failed: " + e.message); }
  };

  const validate = () => {
    if (step === 1 && (!data.name.trim() || !data.category)) return "Advertiser name and Industry / Category are required.";
    if (step === 2) {
      if (data.buy_type === "ROAS" && !String(data.roas_multiplier).trim()) return "Committed ROAS multiplier is required.";
      if (data.buy_type === "CPC" && !String(data.cpc_rate).trim()) return "CPC rate is required.";
      if (!data.gst.trim() || !data.pan.trim()) return "GST number and PAN number are required.";
      if (data.gst.trim().length !== 15) return "GST number must be a 15-character GSTIN.";
      if (data.pan.trim().length !== 10) return "PAN number must be 10 characters.";
    }
    if (step === 3) {
      if (data.goal_type === "ROAS" && !String(data.target_roas).trim()) return "Target ROAS is required.";
      if (data.goal_type === "CAC" && !String(data.target_cac).trim()) return "Target CAC is required.";
    }
    if (step === 4) {
      if (!data.poc_name.trim() || !data.poc_email.trim() || !data.poc_phone.trim()) return "POC name, email and phone are required.";
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.poc_email.trim())) return "Enter a valid POC email.";
    }
    if (step === 5 && !agreementFile) return "A signed legal agreement is required.";
    return "";
  };

  const next = async () => {
    const err = validate();
    if (err) { setError(err); return; }
    setError("");
    try {
      if (step < 6) {
        const ns = step + 1;
        await persist({ current_step: ns });   // autosave draft as you go
        setStep(ns);
      } else if (step === 6) {
        // Review → create/onboard the advertiser, then go to the email step.
        const id = await persist({ current_step: 7 });
        await submitAdvertiser(id, {});
        // Seed the welcome-email draft from the collected data.
        setEmailTo(data.poc_email || "");
        setEmailSubject(`Welcome to Razorpay Media Network — next steps for ${(data.name || "your brand").trim()}`);
        setEmailBody(buildWelcomeDraft(data.name));
        setEmailStatus(null);
        setStep(7);
      }
      // step 7 (email) is driven by its own Send / Skip buttons, not next().
    } catch (e) {
      setError("Save failed: " + e.message);
    }
  };

  const goal = data.goal_type === "ROAS" ? "ROAS" : "CAC";

  const renderStep = () => {
    if (step === 1) {
      return (
        <>
          <div style={s.secTitle}>Advertiser basics</div>
          <div style={s.secSub}>This information persists across all downstream dashboards. The Advertiser ID is auto-generated on save.</div>
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
              <input type="file" accept="image/svg+xml,image/png" style={{ display: "none" }} onChange={pickFile(setLogo)} />
              {logo && logo.url ? <img src={logo.url} alt="logo" style={s.logoPreview} /> : <div style={s.dzIcon}>🖼️</div>}
              <div>
                <div style={s.dzTitle}>{logo ? logo.name : "Drop logo here or click to upload"}</div>
                <div style={s.dzSub}>SVG preferred · 512×512 PNG accepted · ≤ 500 KB</div>
              </div>
            </label>
          </div>
          <div style={s.field}>
            <label style={s.label}>Description (optional)</label>
            <textarea style={s.textarea} placeholder="A short blurb shown internally to Ops & Campaign Managers" value={data.description} onChange={(e) => set({ description: e.target.value })} />
          </div>
        </>
      );
    }

    if (step === 2) {
      const isRoas = data.buy_type === "ROAS";
      return (
        <>
          <div style={s.secTitle}>Commercial terms</div>
          <div style={s.secSub}>Buy type and rate carry through to every campaign created for this advertiser. GST and PAN are required for invoicing.</div>
          <div style={s.secLabel}>Buy type <span style={s.req}>*</span></div>
          <div style={s.radioGrid}>
            {BUY_TYPES.map((bt) => {
              const sel = data.buy_type === bt.id;
              return (
                <div key={bt.id} style={s.radioCard(sel)} onClick={() => set({ buy_type: bt.id })}>
                  <div style={s.radioDot(sel)} />
                  <div style={s.cardIcon(sel)}>{bt.icon}</div>
                  <div><div style={s.cardTitle}>{bt.title}</div><div style={s.cardDesc}>{bt.desc}</div></div>
                </div>
              );
            })}
          </div>
          <div style={s.grid2}>
            {isRoas ? (
              <div style={s.field}>
                <label style={s.label}>Committed ROAS multiplier<span style={s.req}>*</span></label>
                <div style={s.suffixWrap}>
                  <input style={s.affixInput} type="number" placeholder="4.5" value={data.roas_multiplier} onChange={(e) => set({ roas_multiplier: e.target.value })} />
                  <div style={s.suffixBox}>x</div>
                </div>
                <div style={s.help}>Revenue / spend target across the brand</div>
              </div>
            ) : (
              <div style={s.field}>
                <label style={s.label}>CPC rate (₹)<span style={s.req}>*</span></label>
                <input style={s.input} type="number" placeholder="e.g. 12" value={data.cpc_rate} onChange={(e) => set({ cpc_rate: e.target.value })} />
                <div style={s.help}>Fixed rate charged per click delivered</div>
              </div>
            )}
            <div style={s.field}>
              <label style={s.label}>Default campaign budget hint (₹)</label>
              <input style={s.input} placeholder="e.g. 5,00,000" value={data.budget_hint} onChange={(e) => set({ budget_hint: e.target.value })} />
              <div style={s.help}>Pre-fills the budget field when creating new campaigns. Optional.</div>
            </div>
          </div>
          <div style={s.secLabel}>Tax & registration</div>
          <div style={s.grid2}>
            <div style={s.field}>
              <label style={s.label}>GST number<span style={s.req}>*</span></label>
              <input style={s.input} placeholder="29AABCU9603R1ZL" maxLength={15} value={data.gst} onChange={(e) => set({ gst: e.target.value.toUpperCase() })} />
              <div style={s.help}>15-character GSTIN · validated on save</div>
            </div>
            <div style={s.field}>
              <label style={s.label}>PAN number<span style={s.req}>*</span></label>
              <input style={s.input} placeholder="AABCU9603R" maxLength={10} value={data.pan} onChange={(e) => set({ pan: e.target.value.toUpperCase() })} />
              <div style={s.help}>10-character PAN</div>
            </div>
          </div>
        </>
      );
    }

    if (step === 3) {
      const isRoas = data.goal_type === "ROAS";
      return (
        <>
          <div style={s.secTitle}>Brand-level performance goal</div>
          <div style={s.secSub}>Set at the brand level here and inherited at the campaign level. Can be duplicated and adjusted whenever a new campaign is created — avoiding re-entry from scratch.</div>
          <div style={s.secLabel}>Goal type <span style={s.req}>*</span></div>
          <div style={s.radioGrid}>
            {GOAL_TYPES.map((gt) => {
              const sel = data.goal_type === gt.id;
              return (
                <div key={gt.id} style={s.radioCard(sel)} onClick={() => set({ goal_type: gt.id })}>
                  <div style={s.radioDot(sel)} />
                  <div style={s.cardIcon(sel)}>{gt.icon}</div>
                  <div><div style={s.cardTitle}>{gt.title}</div><div style={s.cardDesc}>{gt.desc}</div></div>
                </div>
              );
            })}
          </div>
          <div style={{ ...s.field, marginBottom: 6 }}>
            {isRoas ? (
              <>
                <label style={s.label}>Target ROAS<span style={s.req}>*</span></label>
                <div style={{ ...s.suffixWrap, maxWidth: 430 }}>
                  <input style={s.affixInput} type="number" placeholder="4.5" value={data.target_roas} onChange={(e) => set({ target_roas: e.target.value })} />
                  <div style={s.suffixBox}>x</div>
                </div>
                <div style={s.help}>Live ROAS measured weekly · RAG fires when actual is &gt;25% off goal</div>
              </>
            ) : (
              <>
                <label style={s.label}>Target CAC (₹)<span style={s.req}>*</span></label>
                <input style={{ ...s.input, maxWidth: 430 }} type="number" placeholder="e.g. 350" value={data.target_cac} onChange={(e) => set({ target_cac: e.target.value })} />
                <div style={s.help}>Live CAC measured weekly · RAG fires when actual is &gt;25% off goal</div>
              </>
            )}
          </div>
          <div style={s.ragPanel}>
            <div style={{ ...s.secLabel, margin: "0 0 12px" }}>How alerts will fire</div>
            <div style={s.ragGrid}>
              <div style={s.ragCard(c.green)}>
                <div style={s.ragHead}><span style={s.ragDot(c.green)} /><span style={s.ragName}>GREEN</span></div>
                <div style={s.ragMain}>Actual {goal} at or better than goal</div>
                <div style={s.ragSub}>No action required</div>
              </div>
              <div style={s.ragCard(c.amber)}>
                <div style={s.ragHead}><span style={s.ragDot(c.amber)} /><span style={s.ragName}>AMBER</span></div>
                <div style={s.ragMain}>Actual {goal} within 25% of goal</div>
                <div style={s.ragSub}>Campaign Manager to investigate</div>
              </div>
              <div style={s.ragCard(c.red)}>
                <div style={s.ragHead}><span style={s.ragDot(c.red)} /><span style={s.ragName}>RED</span></div>
                <div style={s.ragMain}>Actual {goal} more than 25% off goal</div>
                <div style={s.ragSub}>Escalate to Sales & Finance</div>
              </div>
            </div>
          </div>
        </>
      );
    }

    if (step === 4) {
      return (
        <>
          <div style={s.secTitle}>Point of contact</div>
          <div style={s.secSub}>This is who the auto-emailer addresses for campaign assets, and who Ops loops in for clarifications.</div>
          <div style={s.grid2}>
            <div style={s.field}>
              <label style={s.label}>POC name<span style={s.req}>*</span></label>
              <input style={s.input} placeholder="e.g. Aanya Krishnan" value={data.poc_name} onChange={(e) => set({ poc_name: e.target.value })} />
            </div>
            <div style={s.field}>
              <label style={s.label}>POC designation</label>
              <input style={s.input} placeholder="e.g. Performance Marketing Lead" value={data.poc_designation} onChange={(e) => set({ poc_designation: e.target.value })} />
            </div>
          </div>
          <div style={s.grid2}>
            <div style={s.field}>
              <label style={s.label}>POC email<span style={s.req}>*</span></label>
              <div style={s.suffixWrap}>
                <div style={s.prefixBox}>✉️</div>
                <input style={s.affixInput} type="email" placeholder="aanya@brand.com" value={data.poc_email} onChange={(e) => set({ poc_email: e.target.value })} />
              </div>
              <div style={s.help}>Auto-emailer triggers to this address on save</div>
            </div>
            <div style={s.field}>
              <label style={s.label}>POC phone<span style={s.req}>*</span></label>
              <div style={s.suffixWrap}>
                <div style={s.prefixBox}>+91</div>
                <input style={s.affixInput} placeholder="98765 43210" value={data.poc_phone} onChange={(e) => set({ poc_phone: e.target.value })} />
              </div>
            </div>
          </div>
          <div style={s.checkRow} onClick={() => set({ cc_finance: !data.cc_finance })}>
            <input type="checkbox" checked={data.cc_finance} onChange={() => set({ cc_finance: !data.cc_finance })} style={{ width: 17, height: 17 }} />
            <span style={s.checkLabel}>CC advertiser's finance team on invoice-related communications</span>
          </div>
        </>
      );
    }

    if (step === 5) {
      return (
        <>
          <div style={s.secTitle}>Agreement &amp; PO</div>
          <div style={s.secSub}>Legal agreement is required on save. PO is required for invoicing — can be added now or after agreement closure.</div>
          <div style={{ ...s.field, marginBottom: 22 }}>
            <label style={s.label}>Legal agreement<span style={s.req}>*</span></label>
            <label style={s.dropzone}>
              <input type="file" accept=".pdf,.docx" style={{ display: "none" }} onChange={pickFile(setAgreementFile)} />
              <div style={s.dzIcon}>📝</div>
              <div>
                <div style={s.dzTitle}>{agreementFile ? agreementFile.name : "Drop signed agreement (PDF / DOCX)"}</div>
                <div style={s.dzSub}>Both parties' signatures required · stored encrypted</div>
              </div>
            </label>
          </div>
          <div style={{ ...s.field, marginBottom: 22 }}>
            <label style={s.label}>Purchase Order (PO)</label>
            <label style={s.dropzone}>
              <input type="file" accept=".pdf" style={{ display: "none" }} onChange={pickFile(setPoFile)} />
              <div style={s.dzIcon}>🧾</div>
              <div>
                <div style={s.dzTitle}>{poFile ? poFile.name : "Drop PO (PDF)"}</div>
                <div style={s.dzSub}>Required before first invoice can be raised</div>
              </div>
            </label>
          </div>
          <div style={s.grid2}>
            <div style={s.field}>
              <label style={s.label}>PO reference number</label>
              <input style={s.input} placeholder="PO-BRAND-Q2-2026" value={data.po_ref} onChange={(e) => set({ po_ref: e.target.value })} />
            </div>
            <div style={s.field}>
              <label style={s.label}>Contract start date</label>
              <input style={s.input} type="date" value={data.contract_start} onChange={(e) => set({ contract_start: e.target.value })} />
            </div>
          </div>
          <div style={s.infoBanner}>
            <span>ℹ️</span>
            <span>On save, an <strong>auto-emailer</strong> will fire to the POC requesting brand logo, campaign creatives, campaign details, data reporting preference, and coupon codes — kicking off the Ops phase.</span>
          </div>
        </>
      );
    }

    if (step === 6) {
      // Review
      const v = (x) => (x === "" || x === undefined || x === null ? "—" : x);
      const rate = data.buy_type === "ROAS" ? (data.roas_multiplier ? `${data.roas_multiplier}x ROAS` : "—") : (data.cpc_rate ? `₹${data.cpc_rate} / click` : "—");
      const target = data.goal_type === "ROAS" ? (data.target_roas ? `${data.target_roas}x` : "—") : (data.target_cac ? `₹${data.target_cac}` : "—");
      const groups = [
        { step: 1, title: "Basics", rows: [["Advertiser name", v(data.name)], ["Industry / Category", v(data.category)], ["Brand logo", logo ? logo.name : "—"], ["Description", v(data.description)]] },
        { step: 2, title: "Commercial", rows: [["Buy type", data.buy_type], ["Rate", rate], ["Budget hint", data.budget_hint ? `₹${data.budget_hint}` : "—"], ["GST", v(data.gst)], ["PAN", v(data.pan)]] },
        { step: 3, title: "Performance Goal", rows: [["Goal type", data.goal_type], ["Target", target]] },
        { step: 4, title: "Point of contact", rows: [["Name", v(data.poc_name)], ["Designation", v(data.poc_designation)], ["Email", v(data.poc_email)], ["Phone", data.poc_phone ? `+91 ${data.poc_phone}` : "—"], ["CC finance", data.cc_finance ? "Yes" : "No"]] },
        { step: 5, title: "Agreement & PO", rows: [["Legal agreement", agreementFile ? agreementFile.name : "—"], ["PO", poFile ? poFile.name : "—"], ["PO reference", v(data.po_ref)], ["Contract start", v(data.contract_start)]] },
      ];
      return (
        <>
          <div style={s.secTitle}>Review &amp; submit</div>
          <div style={s.secSub}>Confirm the details below. On continue, the advertiser is created (ID auto-generated) and you'll review &amp; send the welcome email to the POC.</div>
          {groups.map((g) => (
            <div style={s.revGroup} key={g.step}>
              <div style={s.revHead}>
                <div style={s.revTitle}>{g.title}</div>
                <button style={s.editLink} onClick={() => { setError(""); setStep(g.step); }}>Edit</button>
              </div>
              {g.rows.map(([k, val]) => (
                <div style={s.revRow} key={k}><span style={s.revKey}>{k}</span><span style={s.revVal}>{val}</span></div>
              ))}
            </div>
          ))}
        </>
      );
    }

    // Step 7 — Send welcome email to the POC
    return (
      <>
        <div style={s.secTitle}>Send welcome email</div>
        <div style={s.secSub}>The advertiser is onboarded. Review the draft below and send it to the POC — it goes from your own Google account.</div>
        <div style={{ ...s.field, marginBottom: 18 }}>
          <label style={s.label}>To<span style={s.req}>*</span></label>
          <div style={s.suffixWrap}>
            <div style={s.prefixBox}>✉️</div>
            <input style={s.affixInput} type="text" value={emailTo} onChange={(e) => setEmailTo(e.target.value)} placeholder="poc@brand.com" />
          </div>
          <div style={s.help}>Pre-filled from the POC email · comma-separate for multiple recipients.</div>
        </div>
        <div style={{ ...s.field, marginBottom: 18 }}>
          <label style={s.label}>Subject</label>
          <input style={s.input} value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} />
        </div>
        <div style={s.field}>
          <label style={s.label}>Body</label>
          <textarea style={{ ...s.textarea, minHeight: 260 }} value={emailBody} onChange={(e) => setEmailBody(e.target.value)} />
          <div style={s.help}>Edit freely — sent as a formatted email preserving these line breaks.</div>
        </div>
        {emailStatus && (
          <div style={{ ...s.errText, color: emailStatus.type === "success" ? c.green : c.red }}>
            {emailStatus.type === "success" ? "✓ " : "✕ "}{emailStatus.msg}
          </div>
        )}
      </>
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
          <div style={s.footNote}>
            Step {step} of {STEPS.length} · {saving ? "Saving…" : (step === 7 ? "Advertiser onboarded ✓" : "Saved automatically as you go")}
            {advId ? ` · ${advId}` : ""}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            {step === 7 ? (
              <>
                <button style={s.ghost} onClick={onClose} disabled={sendingEmail}>Skip &amp; finish</button>
                <button style={s.primary} onClick={sendWelcomeEmail} disabled={sendingEmail}>
                  {sendingEmail ? "Sending…" : "Send email & finish"} <span>✉️</span>
                </button>
              </>
            ) : (
              <>
                <button style={s.ghost} onClick={saveDraft} disabled={saving}>Save draft</button>
                {step > 1 && <button style={s.ghost} onClick={() => { setError(""); setStep(step - 1); }}>← Back</button>}
                <button style={s.primary} onClick={next} disabled={saving}>
                  {step === 6 ? "Create advertiser" : "Continue"} <span>→</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
