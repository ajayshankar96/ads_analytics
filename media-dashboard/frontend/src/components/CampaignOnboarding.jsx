import React, { useState, useEffect, useCallback, useRef } from "react";

const API = process.env.REACT_APP_API_URL || "";

// ─────────────────────────── Styles ──────────────────────────────────────────
const S = {
  container: { maxWidth: 960, margin: "0 auto" },
  subTabs: { display: "flex", gap: 8, marginBottom: 20, borderBottom: "2px solid #e0e0e0", paddingBottom: 0 },
  subTab: { padding: "8px 20px", border: "none", borderBottom: "3px solid transparent", background: "none", cursor: "pointer", fontSize: 14, fontWeight: 500, color: "#666", marginBottom: -2, transition: "all 0.15s" },
  subTabActive: { color: "#2563eb", borderBottom: "3px solid #2563eb", fontWeight: 700 },

  card: { background: "#fff", borderRadius: 10, boxShadow: "0 1px 6px rgba(0,0,0,0.08)", padding: 24, marginBottom: 20 },
  sectionHeader: { display: "flex", alignItems: "center", gap: 10, marginBottom: 16, paddingBottom: 10, borderBottom: "1px solid #f0f0f0" },
  sectionNum: { width: 26, height: 26, borderRadius: "50%", background: "#2563eb", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, flexShrink: 0 },
  sectionTitle: { fontSize: 15, fontWeight: 700, color: "#1e3a5f" },

  grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px 20px" },
  grid3: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "14px 16px" },
  grid1: { display: "grid", gridTemplateColumns: "1fr", gap: 14 },

  fieldGroup: { display: "flex", flexDirection: "column", gap: 4 },
  label: { fontSize: 12, fontWeight: 600, color: "#555", textTransform: "uppercase", letterSpacing: 0.4 },
  labelNormal: { fontSize: 13, fontWeight: 500, color: "#374151" },
  required: { color: "#dc2626", marginLeft: 2 },
  input: { padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13, outline: "none" },
  inputErr: { borderColor: "#f87171" },
  select: { padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13, background: "#fff", outline: "none", cursor: "pointer" },
  hint: { fontSize: 11, color: "#888", marginTop: 2 },
  errMsg: { fontSize: 11, color: "#dc2626", marginTop: 2 },

  // Goal rows
  goalRow: { display: "grid", gridTemplateColumns: "1fr 160px 120px 36px", gap: 8, alignItems: "end", marginBottom: 8 },
  // Metric card
  metricCard: { border: "1px solid #e5e7eb", borderRadius: 8, padding: 16, marginBottom: 12, position: "relative", background: "#fafbff" },
  metricCardGrid: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 },

  addBtn: { display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 6, color: "#16a34a", fontSize: 13, fontWeight: 600, cursor: "pointer", marginTop: 8 },
  removeBtn: { padding: "4px 8px", background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: 5, color: "#dc2626", fontSize: 12, fontWeight: 700, cursor: "pointer" },
  removeBtnAbs: { position: "absolute", top: 10, right: 10, padding: "3px 8px", background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: 5, color: "#dc2626", fontSize: 11, fontWeight: 700, cursor: "pointer" },

  // KPI toggle
  toggleRow: { display: "flex", alignItems: "center", gap: 12, marginBottom: 14 },
  toggleLabel: { fontSize: 13, fontWeight: 600, color: "#374151" },
  toggle: { display: "flex", gap: 0 },
  toggleOpt: { padding: "5px 16px", border: "1px solid #d1d5db", fontSize: 13, cursor: "pointer", background: "#f9fafb", color: "#374151" },
  toggleOptActive: { background: "#2563eb", color: "#fff", borderColor: "#2563eb" },

  // Campaign details section tabs
  cdTabs: { display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 },
  cdTab: { padding: "5px 12px", border: "1px solid #d1d5db", borderRadius: 20, fontSize: 12, cursor: "pointer", background: "#f9fafb", color: "#555", fontWeight: 500 },
  cdTabActive: { background: "#2563eb", color: "#fff", borderColor: "#2563eb" },

  // Submit
  submitRow: { display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 },
  btn: { padding: "10px 24px", borderRadius: 7, border: "none", fontSize: 14, fontWeight: 600, cursor: "pointer", transition: "opacity 0.15s" },
  btnPrimary: { background: "#2563eb", color: "#fff" },
  btnSecondary: { background: "#f1f5f9", color: "#374151", border: "1px solid #d1d5db" },
  btnDisabled: { opacity: 0.5, cursor: "not-allowed" },

  alert: { borderRadius: 7, padding: "12px 16px", fontSize: 13, marginBottom: 16, display: "flex", alignItems: "center", gap: 8 },
  alertSuccess: { background: "#d1fae5", color: "#065f46", border: "1px solid #6ee7b7" },
  alertError: { background: "#fee2e2", color: "#991b1b", border: "1px solid #fca5a5" },

  // Manage
  tableWrap: { overflowX: "auto" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 12 },
  th: { background: "#f8fafc", padding: "10px 12px", textAlign: "left", fontWeight: 700, color: "#374151", borderBottom: "2px solid #e0e0e0", whiteSpace: "nowrap" },
  td: { padding: "9px 12px", borderBottom: "1px solid #f0f0f0", color: "#374151", verticalAlign: "top", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  statusBadge: { display: "inline-block", padding: "2px 10px", borderRadius: 12, fontSize: 11, fontWeight: 700 },
  empty: { textAlign: "center", color: "#999", padding: "40px 0", fontSize: 14 },
  spinner: { textAlign: "center", color: "#888", padding: "40px 0" },
};

// ─── Status badge colours ─────────────────────────────────────────────────────
function statusStyle(s) {
  const v = (s || "").toLowerCase();
  if (v === "pending")   return { background: "#fef9c3", color: "#854d0e" };
  if (v === "live")      return { background: "#d1fae5", color: "#065f46" };
  if (v === "active")    return { background: "#d1fae5", color: "#065f46" };
  if (v === "paused")    return { background: "#fef3c7", color: "#92400e" };
  if (v === "completed") return { background: "#dbeafe", color: "#1e40af" };
  if (v === "cancelled") return { background: "#fee2e2", color: "#991b1b" };
  return { background: "#f1f5f9", color: "#374151" };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function Datalist({ id, value, onChange, options, placeholder, style, err }) {
  return (
    <>
      <input list={id + "_dl"} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} style={{ ...S.input, ...(err ? S.inputErr : {}), ...style }} />
      <datalist id={id + "_dl"}>{options.map(o => <option key={o} value={o} />)}</datalist>
    </>
  );
}

function Field({ label, required, hint, err, children }) {
  return (
    <div style={S.fieldGroup}>
      <label style={S.label}>{label}{required && <span style={S.required}>*</span>}</label>
      {children}
      {err  && <span style={S.errMsg}>{err}</span>}
      {hint && !err && <span style={S.hint}>{hint}</span>}
    </div>
  );
}

// ─── JSON builders ────────────────────────────────────────────────────────────
const PERIOD_MAP = { daily: "daily", weekly: "weekly", monthly: "monthly", date_agnostic: "date_agnostic" };

function buildGoalsJson(goals) {
  const out = { goals: { daily: {}, weekly: {}, monthly: {}, date_agnostic: {} } };
  goals.forEach(({ goal, period, value }) => {
    if (goal.trim() && period && value !== "") {
      out.goals[period][goal.trim()] = isNaN(value) ? value : Number(value);
    }
  });
  return JSON.stringify(out);
}

function buildMetricsJson(metrics) {
  const lib = {};
  metrics.forEach(({ display_name, definition, calculation }, i) => {
    if (display_name.trim()) {
      lib[`metric_${i + 1}`] = { display_name: display_name.trim(), definition, calculation };
    }
  });
  return JSON.stringify({ metrics_library: lib });
}

function buildCampaignDetailsJson(cd) {
  return JSON.stringify({
    campaign_details: {
      brand_name: cd.brand_name,
      offer_title: cd.offer_title,
      tc: cd.tc,
      how_to_redeem: cd.how_to_redeem,
      tracking: { landing_link: cd.landing_link, utm_redirection_link: cd.utm_redirection_link },
      incentives: {
        codes: cd.codes ? cd.codes.split(",").map(s => s.trim()).filter(Boolean) : [],
        codes_validity: { start_date: cd.start_date, expiry_date: cd.expiry_date },
      },
      assets: { creative_url: cd.creative_url, logo_url: cd.logo_url },
      targeting: {
        Segment_link: cd.segment_link,
        "Segment Description": cd.segment_description,
        Size: cd.size,
        "Cohort Name": cd.cohort_name,
      },
      budget_and_metrics: {
        total_budget: parseFloat(cd.total_budget) || 0,
        cpc: parseFloat(cd.cpc) || 0,
        cpm: parseFloat(cd.cpm) || 0,
        publisher_spends_calc: cd.publisher_spends_calc || "Spends",
        advertiser_spends_calc: cd.advertiser_spends_calc || "Spends",
        committed_kpi: cd.committed_kpi || "NO",
        committed_kpi_config: {
          metric: cd.kpi_metric,
          operation: cd.kpi_operation,
          goal: cd.kpi_goal,
          formula: cd.kpi_formula,
        },
      },
      Rzp_cut: parseFloat(cd.rzp_cut) || 0,
    },
  });
}

// ─── Email draft builder (HTML, matches the AdOps sample format) ───────────────
function buildEmailDraft(basic, cd) {
  const v = (x) => (x !== undefined && x !== null && String(x).trim()) ? String(x).trim() : "";
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  // Each non-empty line of a textarea becomes a bullet point
  const bullets = (text) => {
    const items = String(text || "").split("\n").map(s => s.trim()).filter(Boolean);
    if (!items.length) return "";
    return "<ul style='margin:4px 0 12px 0;padding-left:22px'>"
      + items.map(i => `<li>${esc(i)}</li>`).join("") + "</ul>";
  };
  const P = [];
  P.push("<p>Hi,</p>");
  P.push("<p>Please find below the campaign details for your reference.</p>");
  const kv = [];
  if (v(cd.landing_link)) kv.push(`<b>Landing Link:</b> ${esc(v(cd.landing_link))}`);
  if (v(cd.offer_title))  kv.push(`<b>Offer Title:</b> ${esc(v(cd.offer_title))}`);
  if (kv.length) P.push("<p>" + kv.join("<br>") + "</p>");
  if (v(cd.tc))            P.push(`<p><b>Terms &amp; Conditions:</b></p>${bullets(cd.tc)}`);
  if (v(cd.how_to_redeem)) P.push(`<p><b>How to Redeem:</b></p>${bullets(cd.how_to_redeem)}`);
  const codes = [];
  if (v(cd.codes))       codes.push(`<b>Promo Code(s):</b> ${esc(v(cd.codes))}`);
  if (v(cd.expiry_date)) codes.push(`<b>Code Validity:</b> ${esc(v(cd.expiry_date))}`);
  if (codes.length) P.push("<p>" + codes.join("<br>") + "</p>");
  const assets = [];
  if (v(cd.creative_url)) assets.push(`<b>Creative:</b> <a href="${esc(v(cd.creative_url))}">Creative</a>`);
  if (v(cd.logo_url))     assets.push(`<b>Logo:</b> <a href="${esc(v(cd.logo_url))}">Logo</a>`);
  if (assets.length) P.push("<p>" + assets.join("<br>") + "</p>");
  const targeting = v(cd.segment_description) || v(basic.additional_context);
  if (targeting) P.push(`<p><b>Targeting:</b> ${esc(targeting)}</p>`);
  const budget = [];
  if (v(cd.total_budget)) budget.push(`<b>Daily Budget:</b> Rs ${esc(v(cd.total_budget))} per day`);
  if (v(cd.cpc) || v(cd.cpm)) budget.push(`<b>CPC/CPD:</b> ${esc(v(cd.cpc) || v(cd.cpm))}`);
  if (budget.length) P.push("<p>" + budget.join("<br>") + "</p>");
  P.push("<p>Regards,<br>AdOps Team | Razorpay</p>");
  return P.join("\n");
}

// ─── Minimal rich-text editor (Bold / Italic / Underline / bullet / numbered) ──
function RichTextEditor({ html, onChange }) {
  const ref = useRef(null);
  // Seed content only when the incoming html differs from the DOM (new draft);
  // typing keeps html === innerHTML, so the cursor never jumps.
  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== (html || "")) {
      ref.current.innerHTML = html || "";
    }
  }, [html]);
  const exec = (cmd) => {
    document.execCommand(cmd, false, null);
    if (ref.current) { onChange(ref.current.innerHTML); ref.current.focus(); }
  };
  const tbBtn = {
    padding: "4px 10px", border: "1px solid #cbd5e1", background: "#fff",
    borderRadius: 4, cursor: "pointer", fontSize: 13, minWidth: 30,
  };
  const tools = [
    ["bold", <b>B</b>], ["italic", <i>I</i>], ["underline", <u>U</u>],
    ["insertUnorderedList", "• List"], ["insertOrderedList", "1. List"],
  ];
  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
        {tools.map(([cmd, label]) => (
          <button key={cmd} type="button" style={tbBtn}
            onMouseDown={e => { e.preventDefault(); exec(cmd); }}>{label}</button>
        ))}
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={() => ref.current && onChange(ref.current.innerHTML)}
        style={{
          minHeight: 300, border: "1px solid #cbd5e1", borderRadius: 6,
          padding: "10px 12px", fontSize: 13, lineHeight: 1.5, background: "#fff",
          overflowY: "auto",
        }}
      />
    </div>
  );
}

function buildEmailSubject(basic, cd) {
  const brand = (cd.brand_name || basic.brand || basic.advertiser || "Campaign").trim();
  const offer = (cd.offer_title || basic.offer || "").trim();
  return offer ? `Campaign Details: ${brand} — ${offer}` : `Campaign Details: ${brand}`;
}

// ─── Default states ───────────────────────────────────────────────────────────
const EMPTY_BASIC = {
  campaign_type: "",
  advertiser: "", publisher: "", advertiser_industry: "", brand: "", offer: "",
  advertiser_data_url: "", publisher_data_url: "",
  segment_pub: "", segment_adv: "",
  additional_context: "",
};

const EMPTY_GOAL   = () => ({ id: Date.now() + Math.random(), goal: "", period: "date_agnostic", value: "" });
const EMPTY_METRIC = () => ({ id: Date.now() + Math.random(), display_name: "", definition: "", calculation: "" });

const EMPTY_CD = {
  brand_name: "", offer_title: "", tc: "", how_to_redeem: "",
  landing_link: "", utm_redirection_link: "",
  codes: "", start_date: "", expiry_date: "",
  creative_url: "", logo_url: "",
  segment_link: "", segment_description: "", size: "", cohort_name: "",
  total_budget: "", cpc: "", cpm: "", rzp_cut: "",
  publisher_spends_calc: "Spends", advertiser_spends_calc: "Spends",
  committed_kpi: "NO",
  kpi_metric: "", kpi_operation: "", kpi_goal: "", kpi_formula: "",
};

// ─── Campaign Details sections ────────────────────────────────────────────────
const CD_SECTIONS = [
  { id: "basic",     label: "Basic Info" },
  { id: "tracking",  label: "Tracking" },
  { id: "incentives",label: "Incentives" },
  { id: "assets",    label: "Assets" },
  { id: "targeting", label: "Targeting" },
  { id: "budget",    label: "Budget & Metrics" },
];

// ─── New Campaign Form ────────────────────────────────────────────────────────
export function NewCampaignForm({ filterOptions }) {
  const [basic, setBasic] = useState(EMPTY_BASIC);
  const [goals, setGoals] = useState([EMPTY_GOAL()]);
  const [metrics, setMetrics] = useState([
    { id: 1, display_name: "", definition: "", calculation: "" },
    { id: 2, display_name: "", definition: "", calculation: "" },
  ]);
  const [cd, setCd] = useState(EMPTY_CD);
  const [cdSection, setCdSection] = useState("basic");

  const [errs, setErrs] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [alert, setAlert] = useState(null);

  // Email-after-submit state (draft → edit → send)
  const [showEmailDraft, setShowEmailDraft] = useState(false);
  const [recipients, setRecipients] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailAlert, setEmailAlert] = useState(null);

  const setB = (k, v) => setBasic(b => ({ ...b, [k]: v }));
  const setC = (k, v) => setCd(c => ({ ...c, [k]: v }));

  // Goals
  const addGoal    = () => setGoals(g => [...g, EMPTY_GOAL()]);
  const removeGoal = id => setGoals(g => g.filter(x => x.id !== id));
  const setGoal    = (id, k, v) => setGoals(g => g.map(x => x.id === id ? { ...x, [k]: v } : x));

  // Metrics
  const addMetric    = () => setMetrics(m => [...m, EMPTY_METRIC()]);
  const removeMetric = id => setMetrics(m => m.filter(x => x.id !== id));
  const setMetric    = (id, k, v) => setMetrics(m => m.map(x => x.id === id ? { ...x, [k]: v } : x));

  const validate = () => {
    const e = {};
    ["advertiser", "publisher", "advertiser_data_url", "publisher_data_url", "segment_pub", "segment_adv"]
      .forEach(k => { if (!basic[k].trim()) e[k] = "Required"; });
    return e;
  };

  const handleSubmit = async () => {
    const e = validate();
    if (Object.keys(e).length) { setErrs(e); setAlert({ type: "error", msg: "Please fill in all required fields." }); return; }
    setErrs({}); setSubmitting(true); setAlert(null);
    try {
      const payload = {
        ...basic,
        goals_json:            buildGoalsJson(goals),
        metrics_json:          buildMetricsJson(metrics),
        campaign_details_json: buildCampaignDetailsJson(cd),
      };
      const res  = await fetch(`${API}/api/onboarding/submit`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Submission failed");
      setAlert({ type: "success", msg: "Campaign submitted successfully!" });
      // Pre-generate an editable email draft from the just-submitted data
      setEmailSubject(buildEmailSubject(basic, cd));
      setEmailBody(buildEmailDraft(basic, cd));
      setShowEmailDraft(true);
      setEmailAlert(null);
      setBasic(EMPTY_BASIC); setGoals([EMPTY_GOAL()]); setMetrics([EMPTY_METRIC(), EMPTY_METRIC()]); setCd(EMPTY_CD);
    } catch (ex) {
      setAlert({ type: "error", msg: ex.message });
    } finally { setSubmitting(false); }
  };

  const handleSendEmail = async () => {
    const recips = recipients.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
    if (!recips.length) { setEmailAlert({ type: "error", msg: "Enter at least one recipient email." }); return; }
    if (!emailBody.trim()) { setEmailAlert({ type: "error", msg: "Email body is empty." }); return; }
    setSendingEmail(true); setEmailAlert(null);
    try {
      const res = await fetch(`${API}/api/onboarding/send-email`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipients: recips, subject: emailSubject, body: emailBody, is_html: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Failed to send email");
      setEmailAlert({ type: "success", msg: `Email sent to ${recips.join(", ")}` });
    } catch (ex) {
      setEmailAlert({ type: "error", msg: ex.message });
    } finally { setSendingEmail(false); }
  };

  const advOptions = filterOptions?.advertisers || [];
  const pubOptions = filterOptions?.publishers  || [];
  const indOptions = filterOptions?.industries  || [];

  return (
    <div>
      {alert && (
        <div style={{ ...S.alert, ...(alert.type === "success" ? S.alertSuccess : S.alertError) }}>
          {alert.type === "success" ? "✅" : "❌"} {alert.msg}
        </div>
      )}

      {/* ── Email draft editor (appears after a campaign is created) ── */}
      {showEmailDraft && (
        <div style={{
          border: "1px solid #bfdbfe", background: "#f8fbff", borderRadius: 10,
          padding: 16, marginBottom: 20,
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontWeight: 700, color: "#1e3a5f" }}>📧 Review &amp; send campaign email</div>
            <span
              onClick={() => { setShowEmailDraft(false); setEmailAlert(null); }}
              style={{ cursor: "pointer", color: "#94a3b8", fontSize: 18, lineHeight: 1 }}
              title="Dismiss"
            >×</span>
          </div>
          <div style={{ fontSize: 12, color: "#64748b", margin: "4px 0 12px" }}>
            A draft was generated from the campaign details. Edit anything below, then send.
          </div>

          <label style={{ fontSize: 12, fontWeight: 600, color: "#334155" }}>Recipients</label>
          <input
            type="text"
            value={recipients}
            onChange={e => setRecipients(e.target.value)}
            placeholder="recipient1@razorpay.com, recipient2@razorpay.com"
            style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13, marginTop: 4, marginBottom: 10, boxSizing: "border-box" }}
          />

          <label style={{ fontSize: 12, fontWeight: 600, color: "#334155" }}>Subject</label>
          <input
            type="text"
            value={emailSubject}
            onChange={e => setEmailSubject(e.target.value)}
            style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13, marginTop: 4, marginBottom: 10, boxSizing: "border-box" }}
          />

          <label style={{ fontSize: 12, fontWeight: 600, color: "#334155" }}>Body (editable)</label>
          <div style={{ marginTop: 4 }}>
            <RichTextEditor html={emailBody} onChange={setEmailBody} />
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10 }}>
            <button
              onClick={handleSendEmail}
              disabled={sendingEmail}
              style={{ padding: "8px 18px", borderRadius: 6, border: "none", cursor: "pointer", background: sendingEmail ? "#94a3b8" : "#2563eb", color: "#fff", fontWeight: 600, fontSize: 13 }}
            >
              {sendingEmail ? "Sending…" : "✉️ Send Email"}
            </button>
            {emailAlert && (
              <span style={{ fontSize: 13, color: emailAlert.type === "success" ? "#059669" : "#dc2626" }}>
                {emailAlert.type === "success" ? "✅" : "❌"} {emailAlert.msg}
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── 1. Basic Information ── */}
      <div style={S.card}>
        <div style={S.sectionHeader}><div style={S.sectionNum}>1</div><div style={S.sectionTitle}>Basic Information</div></div>
        <div style={S.grid2}>
          <Field label="Campaign Type" hint="Type of campaign structure">
            <select style={S.select} value={basic.campaign_type} onChange={e => setB("campaign_type", e.target.value)}>
              <option value="">Select Campaign Type</option>
              <option value="Single Campaign Sheet">Single Campaign Sheet</option>
              <option value="Two different Sheets">Two different Sheets</option>
            </select>
          </Field>
          <Field label="Advertiser Industry">
            <Datalist id="ind" value={basic.advertiser_industry} onChange={v => setB("advertiser_industry", v)}
              options={indOptions} placeholder="e.g. Insurance, E-commerce, Fintech" />
          </Field>
          <Field label="Advertiser" required err={errs.advertiser}>
            <Datalist id="adv" value={basic.advertiser} onChange={v => setB("advertiser", v)}
              options={advOptions} placeholder="Advertiser name" err={!!errs.advertiser} />
          </Field>
          <Field label="Publisher" required err={errs.publisher}>
            <Datalist id="pub" value={basic.publisher} onChange={v => setB("publisher", v)}
              options={pubOptions} placeholder="Publisher name" err={!!errs.publisher} />
          </Field>
          <Field label="Brand">
            <input style={S.input} value={basic.brand} onChange={e => setB("brand", e.target.value)} placeholder="Brand name" />
          </Field>
          <Field label="Offer">
            <input style={S.input} value={basic.offer} onChange={e => setB("offer", e.target.value)} placeholder="Offer name" />
          </Field>
          <Field label="Advertiser Data Sheet URL" required err={errs.advertiser_data_url}>
            <input style={{ ...S.input, ...(errs.advertiser_data_url ? S.inputErr : {}) }}
              value={basic.advertiser_data_url} onChange={e => setB("advertiser_data_url", e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/..." />
          </Field>
          <Field label="Publisher Data Sheet URL" required err={errs.publisher_data_url}>
            <input style={{ ...S.input, ...(errs.publisher_data_url ? S.inputErr : {}) }}
              value={basic.publisher_data_url} onChange={e => setB("publisher_data_url", e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/..." />
          </Field>
          <Field label="Segment Names (Shared by Publisher in reports)" required err={errs.segment_pub}
            hint="Segment name as it appears in publisher reports">
            <input style={{ ...S.input, ...(errs.segment_pub ? S.inputErr : {}) }}
              value={basic.segment_pub} onChange={e => setB("segment_pub", e.target.value)}
              placeholder="e.g. Seg 1A" />
          </Field>
          <Field label="Segment Name (Shared by Advertiser in reports)" required err={errs.segment_adv}
            hint="Segment name as it appears in advertiser reports">
            <input style={{ ...S.input, ...(errs.segment_adv ? S.inputErr : {}) }}
              value={basic.segment_adv} onChange={e => setB("segment_adv", e.target.value)}
              placeholder="e.g. Partnership_Razorpay / Placement1a" />
          </Field>
        </div>
      </div>

      {/* ── 2. Goals ── */}
      <div style={S.card}>
        <div style={S.sectionHeader}><div style={S.sectionNum}>2</div><div style={S.sectionTitle}>Goals</div></div>
        {/* Header row */}
        <div style={{ ...S.goalRow, marginBottom: 4 }}>
          <span style={{ ...S.label, fontSize: 11 }}>GOAL</span>
          <span style={{ ...S.label, fontSize: 11 }}>PERIOD</span>
          <span style={{ ...S.label, fontSize: 11 }}>VALUE</span>
          <span />
        </div>
        {goals.map(g => (
          <div key={g.id} style={S.goalRow}>
            <input style={S.input} value={g.goal} onChange={e => setGoal(g.id, "goal", e.target.value)}
              placeholder="e.g. CPL" />
            <select style={S.select} value={g.period} onChange={e => setGoal(g.id, "period", e.target.value)}>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="date_agnostic">Date Agnostic</option>
            </select>
            <input style={S.input} type="number" value={g.value} onChange={e => setGoal(g.id, "value", e.target.value)}
              placeholder="e.g. 500" />
            <button style={S.removeBtn} onClick={() => removeGoal(g.id)}>✕</button>
          </div>
        ))}
        <button style={S.addBtn} onClick={addGoal}>+ Add Goal</button>
      </div>

      {/* ── 3. Metrics Library ── */}
      <div style={S.card}>
        <div style={S.sectionHeader}><div style={S.sectionNum}>3</div><div style={S.sectionTitle}>Metrics Library</div></div>
        <span style={{ ...S.hint, display: "block", marginBottom: 12 }}>Define metrics to extract from advertiser data and their calculations</span>
        {metrics.map((m, idx) => (
          <div key={m.id} style={S.metricCard}>
            <button style={S.removeBtnAbs} onClick={() => removeMetric(m.id)}>Remove</button>
            <div style={{ fontWeight: 700, fontSize: 13, color: "#374151", marginBottom: 12 }}>Metric {idx + 1}</div>
            <div style={S.metricCardGrid}>
              <Field label="Display Name" hint="e.g. Leads">
                <input style={S.input} value={m.display_name} onChange={e => setMetric(m.id, "display_name", e.target.value)}
                  placeholder="e.g. Leads" />
              </Field>
              <Field label="Definition" hint="e.g. Leads data from advertiser sheet">
                <input style={S.input} value={m.definition} onChange={e => setMetric(m.id, "definition", e.target.value)}
                  placeholder="e.g. Leads data from advertiser sheet" />
              </Field>
              <Field label="Calculation" hint="e.g. $leadsCol">
                <input style={S.input} value={m.calculation} onChange={e => setMetric(m.id, "calculation", e.target.value)}
                  placeholder="e.g. $leadsCol" />
              </Field>
            </div>
          </div>
        ))}
        <button style={S.addBtn} onClick={addMetric}>+ Add Metric</button>
      </div>

      {/* ── 4. Committed KPI Configuration ── */}
      <div style={S.card}>
        <div style={S.sectionHeader}><div style={S.sectionNum}>4</div><div style={S.sectionTitle}>Committed KPI Configuration</div></div>
        <span style={{ ...S.hint, display: "block", marginBottom: 14 }}>
          Configure Publisher and Advertiser Spends calculations. Formula builder appears when Committed KPI = YES.
        </span>
        <div style={S.grid2}>
          <Field label="Publisher Spends Calculation" hint="e.g. Spends / 1.2 or Spends / 3.2">
            <input style={S.input} value={cd.publisher_spends_calc} onChange={e => setC("publisher_spends_calc", e.target.value)}
              placeholder="e.g. Spends / 1.2" />
          </Field>
          <Field label="Advertiser Spends Calculation" hint="Enter a formula to calculate Advertiser Spends (use column names like Spends, Total_Budget, etc.)">
            <input style={S.input} value={cd.advertiser_spends_calc} onChange={e => setC("advertiser_spends_calc", e.target.value)}
              placeholder="e.g. Spends * 1.2 or Total_Budget / 10" />
          </Field>
        </div>
        <div style={{ ...S.toggleRow, marginTop: 14 }}>
          <span style={S.toggleLabel}>Committed KPI</span>
          <div style={S.toggle}>
            {["NO", "YES"].map((opt, i) => (
              <button key={opt} onClick={() => setC("committed_kpi", opt)}
                style={{
                  ...S.toggleOpt,
                  ...(cd.committed_kpi === opt ? S.toggleOptActive : {}),
                  borderRadius: i === 0 ? "5px 0 0 5px" : "0 5px 5px 0",
                }}>
                {opt}
              </button>
            ))}
          </div>
        </div>
        {cd.committed_kpi === "YES" && (
          <div style={{ ...S.grid2, marginTop: 14, padding: 16, background: "#f0f4ff", borderRadius: 8, border: "1px solid #bfdbfe" }}>
            <Field label="Metric" hint="e.g. Leads, QL">
              <input style={S.input} value={cd.kpi_metric} onChange={e => setC("kpi_metric", e.target.value)} placeholder="Metric name" />
            </Field>
            <Field label="Operation" hint="e.g. >=, <=, =">
              <input style={S.input} value={cd.kpi_operation} onChange={e => setC("kpi_operation", e.target.value)} placeholder="e.g. >=" />
            </Field>
            <Field label="Goal" hint="Target value">
              <input style={S.input} value={cd.kpi_goal} onChange={e => setC("kpi_goal", e.target.value)} placeholder="e.g. 100" />
            </Field>
            <Field label="Formula" hint="Calculation formula">
              <input style={S.input} value={cd.kpi_formula} onChange={e => setC("kpi_formula", e.target.value)} placeholder="e.g. Leads / Spends" />
            </Field>
          </div>
        )}
      </div>

      {/* ── 5. Campaign Details ── */}
      <div style={S.card}>
        <div style={S.sectionHeader}><div style={S.sectionNum}>5</div><div style={S.sectionTitle}>Campaign Details</div></div>
        <span style={{ ...S.hint, display: "block", marginBottom: 12 }}>Select a section to edit its fields. All sections are optional.</span>
        <div style={S.cdTabs}>
          {CD_SECTIONS.map(s => (
            <button key={s.id} onClick={() => setCdSection(s.id)}
              style={{ ...S.cdTab, ...(cdSection === s.id ? S.cdTabActive : {}) }}>
              {s.label}
            </button>
          ))}
        </div>

        {cdSection === "basic" && (
          <div style={S.grid2}>
            <Field label="Brand Name"><input style={S.input} value={cd.brand_name} onChange={e => setC("brand_name", e.target.value)} placeholder="Brand name" /></Field>
            <Field label="Offer Title"><input style={S.input} value={cd.offer_title} onChange={e => setC("offer_title", e.target.value)} placeholder="Offer title" /></Field>
            <Field label="T&C" hint="One point per line — becomes bullet points in the email">
              <textarea style={{ ...S.input, minHeight: 90, fontFamily: "inherit", resize: "vertical" }}
                value={cd.tc} onChange={e => setC("tc", e.target.value)}
                placeholder={"One condition per line, e.g.\nGet flat ₹250 off on your bill\nValid only for first-time customers\nCoupon valid until 31st August 2026"} />
            </Field>
            <Field label="How to Redeem" hint="One step per line — becomes bullet points in the email">
              <textarea style={{ ...S.input, minHeight: 90, fontFamily: "inherit", resize: "vertical" }}
                value={cd.how_to_redeem} onChange={e => setC("how_to_redeem", e.target.value)}
                placeholder={"One step per line, e.g.\nDownload and open the app\nSign in and book a service\nApply the coupon code at checkout"} />
            </Field>
            <Field label="Rzp Cut (%)" hint="Razorpay's revenue cut percentage">
              <input style={S.input} type="number" value={cd.rzp_cut} onChange={e => setC("rzp_cut", e.target.value)} placeholder="0" />
            </Field>
          </div>
        )}

        {cdSection === "tracking" && (
          <div style={S.grid1}>
            <Field label="Landing Link"><input style={S.input} value={cd.landing_link} onChange={e => setC("landing_link", e.target.value)} placeholder="https://..." /></Field>
            <Field label="UTM Redirection Link"><input style={S.input} value={cd.utm_redirection_link} onChange={e => setC("utm_redirection_link", e.target.value)} placeholder="https://..." /></Field>
          </div>
        )}

        {cdSection === "incentives" && (
          <div style={S.grid2}>
            <Field label="Promo Codes" hint="Comma-separated list"><input style={S.input} value={cd.codes} onChange={e => setC("codes", e.target.value)} placeholder="CODE1, CODE2" /></Field>
            <div />
            <Field label="Validity Start Date"><input style={S.input} type="date" value={cd.start_date} onChange={e => setC("start_date", e.target.value)} /></Field>
            <Field label="Validity Expiry Date"><input style={S.input} type="date" value={cd.expiry_date} onChange={e => setC("expiry_date", e.target.value)} /></Field>
          </div>
        )}

        {cdSection === "assets" && (
          <div style={S.grid2}>
            <Field label="Creative URL"><input style={S.input} value={cd.creative_url} onChange={e => setC("creative_url", e.target.value)} placeholder="https://..." /></Field>
            <Field label="Logo URL"><input style={S.input} value={cd.logo_url} onChange={e => setC("logo_url", e.target.value)} placeholder="https://..." /></Field>
          </div>
        )}

        {cdSection === "targeting" && (
          <div style={S.grid2}>
            <Field label="Segment Link"><input style={S.input} value={cd.segment_link} onChange={e => setC("segment_link", e.target.value)} placeholder="Drive/Sheets link to segment" /></Field>
            <Field label="Cohort Name"><input style={S.input} value={cd.cohort_name} onChange={e => setC("cohort_name", e.target.value)} placeholder="e.g. Risk Band" /></Field>
            <Field label="Segment Description">
              <textarea style={{ ...S.input, minHeight: 70, resize: "vertical", fontFamily: "inherit" }}
                value={cd.segment_description} onChange={e => setC("segment_description", e.target.value)}
                placeholder="Describe the target segment" />
            </Field>
            <Field label="Size" hint="Segment size in millions">
              <input style={S.input} value={cd.size} onChange={e => setC("size", e.target.value)} placeholder="e.g. 6.5" />
            </Field>
          </div>
        )}

        {cdSection === "budget" && (
          <div style={S.grid3}>
            <Field label="Total Budget"><input style={S.input} type="number" value={cd.total_budget} onChange={e => setC("total_budget", e.target.value)} placeholder="0" /></Field>
            <Field label="CPC Target"><input style={S.input} type="number" value={cd.cpc} onChange={e => setC("cpc", e.target.value)} placeholder="0" /></Field>
            <Field label="CPM Target"><input style={S.input} type="number" value={cd.cpm} onChange={e => setC("cpm", e.target.value)} placeholder="0" /></Field>
          </div>
        )}
      </div>

      {/* ── 6. Additional Context ── */}
      <div style={S.card}>
        <div style={S.sectionHeader}><div style={S.sectionNum}>6</div><div style={S.sectionTitle}>Additional Information</div></div>
        <Field label="Additional Context">
          <textarea style={{ ...S.input, minHeight: 80, resize: "vertical", fontFamily: "inherit", fontSize: 13 }}
            value={basic.additional_context} onChange={e => setB("additional_context", e.target.value)}
            placeholder="Any additional notes or context about this campaign" />
        </Field>
      </div>

      <div style={S.submitRow}>
        <button style={{ ...S.btn, ...S.btnSecondary }} onClick={() => {
          setBasic(EMPTY_BASIC); setGoals([EMPTY_GOAL()]); setMetrics([EMPTY_METRIC(), EMPTY_METRIC()]); setCd(EMPTY_CD); setErrs({}); setAlert(null);
        }}>Clear Form</button>
        <button style={{ ...S.btn, ...S.btnPrimary, ...(submitting ? S.btnDisabled : {}) }}
          onClick={handleSubmit} disabled={submitting}>
          {submitting ? "Submitting…" : "✅ Create Campaign"}
        </button>
      </div>
    </div>
  );
}

// ─── Manage Campaigns ─────────────────────────────────────────────────────────
function ManageCampaigns() {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [search, setSearch]       = useState("");

  const load = useCallback(() => {
    setLoading(true);
    fetch(`${API}/api/onboarding/campaigns`)
      .then(r => r.json())
      .then(d => { setCampaigns(d.campaigns || []); setError(null); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = campaigns.filter(c => {
    const q = search.toLowerCase();
    return !q || [c.advertiser, c.publisher, c.campaign_type, c.brand, c.status]
      .some(v => (v || "").toLowerCase().includes(q));
  });

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <input style={{ ...S.input, width: 260 }} value={search} onChange={e => setSearch(e.target.value)}
          placeholder="🔍 Search by advertiser, publisher…" />
        <button style={{ ...S.btn, ...S.btnSecondary, padding: "7px 16px", fontSize: 12 }} onClick={load}>⟳ Refresh</button>
      </div>
      {error && <div style={{ ...S.alert, ...S.alertError }}>❌ {error}</div>}
      <div style={S.card}>
        {loading ? <div style={S.spinner}>Loading campaigns…</div>
          : filtered.length === 0 ? <div style={S.empty}>{search ? "No campaigns match your search." : "No campaigns submitted yet."}</div>
          : (
            <div style={S.tableWrap}>
              <table style={S.table}>
                <thead>
                  <tr>{["#","Type","Advertiser","Publisher","Industry","Brand","Offer","Merged Sheet","Adv Data","Pub Data","Status","Status Date"]
                    .map(h => <th key={h} style={S.th}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {filtered.map((c, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? "#fff" : "#fafbfc" }}>
                      <td style={S.td}>{i + 1}</td>
                      <td style={S.td}>{c.campaign_type}</td>
                      <td style={{ ...S.td, fontWeight: 600 }}>{c.advertiser}</td>
                      <td style={S.td}>{c.publisher}</td>
                      <td style={S.td}>{c.advertiser_industry}</td>
                      <td style={S.td}>{c.brand}</td>
                      <td style={S.td}>{c.offer}</td>
                      <td style={S.td}>{c.merged_sheet_url ? <a href={c.merged_sheet_url} target="_blank" rel="noopener noreferrer" style={{ color: "#2563eb" }}>Open ↗</a> : <span style={{ color: "#aaa" }}>Pending</span>}</td>
                      <td style={S.td}>{c.advertiser_data_url ? <a href={c.advertiser_data_url} target="_blank" rel="noopener noreferrer" style={{ color: "#2563eb" }}>View ↗</a> : "—"}</td>
                      <td style={S.td}>{c.publisher_data_url ? <a href={c.publisher_data_url} target="_blank" rel="noopener noreferrer" style={{ color: "#2563eb" }}>View ↗</a> : "—"}</td>
                      <td style={S.td}><span style={{ ...S.statusBadge, ...statusStyle(c.status) }}>{c.status || "Unknown"}</span></td>
                      <td style={S.td}>{c.status_date || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ fontSize: 12, color: "#888", marginTop: 10 }}>Showing {filtered.length} of {campaigns.length} campaigns</div>
            </div>
          )}
      </div>
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────
export default function CampaignOnboarding({ filterOptions }) {
  const [subTab, setSubTab] = useState("new");
  return (
    <div style={S.container}>
      <div style={S.subTabs}>
        {[{ id: "new", label: "➕ New Campaign" }, { id: "manage", label: "📂 Manage Campaigns" }].map(t => (
          <button key={t.id} style={{ ...S.subTab, ...(subTab === t.id ? S.subTabActive : {}) }} onClick={() => setSubTab(t.id)}>{t.label}</button>
        ))}
      </div>
      {subTab === "new"    && <NewCampaignForm filterOptions={filterOptions} />}
      {subTab === "manage" && <ManageCampaigns />}
    </div>
  );
}
