import React, { useState, useEffect, useCallback } from "react";

const API = process.env.REACT_APP_API_URL || "";

// ── Styles ────────────────────────────────────────────────────────────────────
const S = {
  container: { maxWidth: 900, margin: "0 auto" },
  subTabs: {
    display: "flex",
    gap: 8,
    marginBottom: 20,
    borderBottom: "2px solid #e0e0e0",
    paddingBottom: 0,
  },
  subTab: {
    padding: "8px 20px",
    border: "none",
    borderBottom: "3px solid transparent",
    background: "none",
    cursor: "pointer",
    fontSize: 14,
    fontWeight: 500,
    color: "#666",
    marginBottom: -2,
    transition: "all 0.15s",
  },
  subTabActive: {
    color: "#2563eb",
    borderBottom: "3px solid #2563eb",
    fontWeight: 700,
  },
  card: {
    background: "#fff",
    borderRadius: 10,
    boxShadow: "0 1px 6px rgba(0,0,0,0.08)",
    padding: 28,
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: 700,
    color: "#1e3a5f",
    marginBottom: 16,
    paddingBottom: 8,
    borderBottom: "1px solid #f0f0f0",
  },
  grid2: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "14px 20px",
  },
  grid1: {
    display: "grid",
    gridTemplateColumns: "1fr",
    gap: 14,
  },
  fieldGroup: { display: "flex", flexDirection: "column", gap: 4 },
  label: { fontSize: 12, fontWeight: 600, color: "#555", textTransform: "uppercase", letterSpacing: 0.4 },
  required: { color: "#dc2626", marginLeft: 2 },
  input: {
    padding: "8px 10px",
    border: "1px solid #d1d5db",
    borderRadius: 6,
    fontSize: 13,
    outline: "none",
    transition: "border-color 0.15s",
  },
  inputFocus: { borderColor: "#2563eb" },
  select: {
    padding: "8px 10px",
    border: "1px solid #d1d5db",
    borderRadius: 6,
    fontSize: 13,
    background: "#fff",
    outline: "none",
    cursor: "pointer",
  },
  jsonArea: {
    padding: "10px 12px",
    border: "1px solid #d1d5db",
    borderRadius: 6,
    fontSize: 12,
    fontFamily: "monospace",
    minHeight: 120,
    resize: "vertical",
    outline: "none",
    lineHeight: 1.5,
  },
  jsonError: { border: "1px solid #f87171" },
  jsonHint: { fontSize: 11, color: "#888", marginTop: 2 },
  jsonErrMsg: { fontSize: 11, color: "#dc2626", marginTop: 2 },
  loadBtn: {
    padding: "4px 10px",
    background: "#f0f4ff",
    border: "1px solid #93c5fd",
    borderRadius: 5,
    color: "#2563eb",
    fontSize: 11,
    fontWeight: 600,
    cursor: "pointer",
    alignSelf: "flex-start",
    marginTop: 2,
  },
  submitRow: { display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 },
  btn: {
    padding: "10px 24px",
    borderRadius: 7,
    border: "none",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    transition: "opacity 0.15s",
  },
  btnPrimary: { background: "#2563eb", color: "#fff" },
  btnSecondary: {
    background: "#f1f5f9",
    color: "#374151",
    border: "1px solid #d1d5db",
  },
  btnDisabled: { opacity: 0.5, cursor: "not-allowed" },
  alert: {
    borderRadius: 7,
    padding: "12px 16px",
    fontSize: 13,
    marginBottom: 16,
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  alertSuccess: { background: "#d1fae5", color: "#065f46", border: "1px solid #6ee7b7" },
  alertError: { background: "#fee2e2", color: "#991b1b", border: "1px solid #fca5a5" },
  // Manage tab
  tableWrap: { overflowX: "auto" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 12 },
  th: {
    background: "#f8fafc",
    padding: "10px 12px",
    textAlign: "left",
    fontWeight: 700,
    color: "#374151",
    borderBottom: "2px solid #e0e0e0",
    whiteSpace: "nowrap",
  },
  td: {
    padding: "9px 12px",
    borderBottom: "1px solid #f0f0f0",
    color: "#374151",
    verticalAlign: "top",
    maxWidth: 200,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  statusBadge: {
    display: "inline-block",
    padding: "2px 10px",
    borderRadius: 12,
    fontSize: 11,
    fontWeight: 700,
  },
  empty: { textAlign: "center", color: "#999", padding: "40px 0", fontSize: 14 },
  spinner: { textAlign: "center", color: "#888", padding: "40px 0" },
};

// ── Status badge colors ───────────────────────────────────────────────────────
function statusStyle(status) {
  const s = (status || "").toLowerCase();
  if (s === "pending")    return { background: "#fef9c3", color: "#854d0e" };
  if (s === "active")     return { background: "#d1fae5", color: "#065f46" };
  if (s === "completed")  return { background: "#dbeafe", color: "#1e40af" };
  if (s === "cancelled")  return { background: "#fee2e2", color: "#991b1b" };
  return { background: "#f1f5f9", color: "#374151" };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function isValidJson(str) {
  if (!str || !str.trim()) return false;
  try { JSON.parse(str); return true; }
  catch { return false; }
}

function Datalist({ id, value, onChange, options, placeholder }) {
  return (
    <>
      <input
        list={id + "_list"}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={S.input}
      />
      <datalist id={id + "_list"}>
        {options.map(o => <option key={o} value={o} />)}
      </datalist>
    </>
  );
}

// ── New Campaign Form ─────────────────────────────────────────────────────────
const EMPTY_FORM = {
  campaign_type: "SSP",
  advertiser: "",
  publisher: "",
  advertiser_industry: "",
  brand: "",
  offer: "",
  advertiser_data_url: "",
  publisher_data_url: "",
  goals_json: "",
  metrics_json: "",
  segment_pub: "",
  segment_adv: "",
  additional_context: "",
  campaign_details_json: "",
};

function NewCampaignForm({ filterOptions }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [jsonErrors, setJsonErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [alert, setAlert] = useState(null);
  const [templates, setTemplates] = useState(null);

  // Load JSON templates on mount
  useEffect(() => {
    fetch(`${API}/api/onboarding/templates`)
      .then(r => r.json())
      .then(setTemplates)
      .catch(() => {});
  }, []);

  const set = (key, val) => {
    setForm(f => ({ ...f, [key]: val }));
    // Clear JSON error on change
    if (["goals_json", "metrics_json", "campaign_details_json"].includes(key)) {
      setJsonErrors(e => ({ ...e, [key]: val.trim() && !isValidJson(val) }));
    }
  };

  const loadTemplate = (key) => {
    if (!templates) return;
    const map = { goals_json: "goals", metrics_json: "metrics", campaign_details_json: "campaign_details" };
    set(key, templates[map[key]]);
  };

  const validate = () => {
    const errors = {};
    const required = ["campaign_type", "advertiser", "publisher", "advertiser_data_url", "publisher_data_url"];
    for (const k of required) {
      if (!form[k].trim()) { errors[k] = true; }
    }
    for (const k of ["goals_json", "metrics_json", "campaign_details_json"]) {
      if (form[k].trim() && !isValidJson(form[k])) errors[k] = true;
    }
    return errors;
  };

  const handleSubmit = async () => {
    const errors = validate();
    if (Object.keys(errors).length) {
      setJsonErrors(errors);
      setAlert({ type: "error", msg: "Please fix the errors above before submitting." });
      return;
    }
    setSubmitting(true);
    setAlert(null);
    try {
      const res = await fetch(`${API}/api/onboarding/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Submission failed");
      setAlert({ type: "success", msg: "Campaign submitted successfully! It will appear in Manage Campaigns." });
      setForm(EMPTY_FORM);
      setJsonErrors({});
    } catch (e) {
      setAlert({ type: "error", msg: e.message });
    } finally {
      setSubmitting(false);
    }
  };

  const advOptions = filterOptions?.advertisers || [];
  const pubOptions = filterOptions?.publishers || [];
  const indOptions = filterOptions?.industries || [];

  return (
    <div>
      {alert && (
        <div style={{ ...S.alert, ...(alert.type === "success" ? S.alertSuccess : S.alertError) }}>
          {alert.type === "success" ? "✅" : "❌"} {alert.msg}
        </div>
      )}

      {/* Basic Info */}
      <div style={S.card}>
        <div style={S.sectionTitle}>📋 Basic Information</div>
        <div style={S.grid2}>
          <div style={S.fieldGroup}>
            <label style={S.label}>Campaign Type <span style={S.required}>*</span></label>
            <select style={S.select} value={form.campaign_type} onChange={e => set("campaign_type", e.target.value)}>
              <option value="SSP">SSP</option>
              <option value="DSP">DSP</option>
              <option value="Direct">Direct</option>
              <option value="Programmatic">Programmatic</option>
            </select>
          </div>

          <div style={S.fieldGroup}>
            <label style={S.label}>Advertiser Industry</label>
            <Datalist
              id="industry"
              value={form.advertiser_industry}
              onChange={v => set("advertiser_industry", v)}
              options={indOptions}
              placeholder="e.g. BFSI, E-commerce..."
            />
          </div>

          <div style={S.fieldGroup}>
            <label style={S.label}>Advertiser <span style={S.required}>*</span></label>
            <Datalist
              id="advertiser"
              value={form.advertiser}
              onChange={v => set("advertiser", v)}
              options={advOptions}
              placeholder="Select or type advertiser name"
            />
          </div>

          <div style={S.fieldGroup}>
            <label style={S.label}>Publisher <span style={S.required}>*</span></label>
            <Datalist
              id="publisher"
              value={form.publisher}
              onChange={v => set("publisher", v)}
              options={pubOptions}
              placeholder="Select or type publisher name"
            />
          </div>

          <div style={S.fieldGroup}>
            <label style={S.label}>Brand</label>
            <input style={S.input} value={form.brand} onChange={e => set("brand", e.target.value)} placeholder="Brand name" />
          </div>

          <div style={S.fieldGroup}>
            <label style={S.label}>Offer</label>
            <input style={S.input} value={form.offer} onChange={e => set("offer", e.target.value)} placeholder="Offer name" />
          </div>
        </div>
      </div>

      {/* Data Sources */}
      <div style={S.card}>
        <div style={S.sectionTitle}>🔗 Data Sources</div>
        <div style={S.grid1}>
          <div style={S.fieldGroup}>
            <label style={S.label}>Advertiser Data Sheet URL <span style={S.required}>*</span></label>
            <input
              style={{ ...S.input, ...(jsonErrors.advertiser_data_url ? { borderColor: "#f87171" } : {}) }}
              value={form.advertiser_data_url}
              onChange={e => set("advertiser_data_url", e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/..."
            />
          </div>
          <div style={S.fieldGroup}>
            <label style={S.label}>Publisher Data Sheet URL <span style={S.required}>*</span></label>
            <input
              style={{ ...S.input, ...(jsonErrors.publisher_data_url ? { borderColor: "#f87171" } : {}) }}
              value={form.publisher_data_url}
              onChange={e => set("publisher_data_url", e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/..."
            />
          </div>
        </div>
      </div>

      {/* Segment Mapping */}
      <div style={S.card}>
        <div style={S.sectionTitle}>🎯 Segment Mapping</div>
        <div style={S.grid2}>
          <div style={S.fieldGroup}>
            <label style={S.label}>Publisher Segment</label>
            <input style={S.input} value={form.segment_pub} onChange={e => set("segment_pub", e.target.value)} placeholder="Publisher segment identifier" />
          </div>
          <div style={S.fieldGroup}>
            <label style={S.label}>Advertiser Segment</label>
            <input style={S.input} value={form.segment_adv} onChange={e => set("segment_adv", e.target.value)} placeholder="Advertiser segment identifier" />
          </div>
        </div>
      </div>

      {/* JSON Fields */}
      <div style={S.card}>
        <div style={S.sectionTitle}>📊 Goals, Metrics & Campaign Details</div>
        <div style={S.grid1}>

          {/* Goals JSON */}
          <div style={S.fieldGroup}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <label style={S.label}>Goals JSON</label>
              <button style={S.loadBtn} onClick={() => loadTemplate("goals_json")}>Load Template</button>
            </div>
            <textarea
              style={{ ...S.jsonArea, ...(jsonErrors.goals_json ? S.jsonError : {}) }}
              value={form.goals_json}
              onChange={e => set("goals_json", e.target.value)}
              placeholder='{"primary": {"metric": "CTR", "target": "2%", "timeframe": "30d"}, "secondary": []}'
            />
            {jsonErrors.goals_json
              ? <span style={S.jsonErrMsg}>Invalid JSON — please fix before submitting</span>
              : <span style={S.jsonHint}>Define campaign goals as JSON</span>
            }
          </div>

          {/* Metrics JSON */}
          <div style={S.fieldGroup}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <label style={S.label}>Metrics JSON</label>
              <button style={S.loadBtn} onClick={() => loadTemplate("metrics_json")}>Load Template</button>
            </div>
            <textarea
              style={{ ...S.jsonArea, ...(jsonErrors.metrics_json ? S.jsonError : {}) }}
              value={form.metrics_json}
              onChange={e => set("metrics_json", e.target.value)}
              placeholder='{"impressions": {"track": true, "target": "1M"}, "ctr": {"track": true, "target": "2%"}}'
            />
            {jsonErrors.metrics_json
              ? <span style={S.jsonErrMsg}>Invalid JSON — please fix before submitting</span>
              : <span style={S.jsonHint}>Specify which metrics to track and targets</span>
            }
          </div>

          {/* Campaign Details JSON */}
          <div style={S.fieldGroup}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <label style={S.label}>Campaign Details JSON</label>
              <button style={S.loadBtn} onClick={() => loadTemplate("campaign_details_json")}>Load Template</button>
            </div>
            <textarea
              style={{ ...S.jsonArea, minHeight: 160, ...(jsonErrors.campaign_details_json ? S.jsonError : {}) }}
              value={form.campaign_details_json}
              onChange={e => set("campaign_details_json", e.target.value)}
              placeholder='{"campaign_name": "...", "start_date": "...", "budget": "..."}'
            />
            {jsonErrors.campaign_details_json
              ? <span style={S.jsonErrMsg}>Invalid JSON — please fix before submitting</span>
              : <span style={S.jsonHint}>Full campaign configuration as JSON</span>
            }
          </div>

          {/* Additional Context */}
          <div style={S.fieldGroup}>
            <label style={S.label}>Additional Context</label>
            <textarea
              style={{ ...S.jsonArea, minHeight: 80, fontFamily: "inherit", fontSize: 13 }}
              value={form.additional_context}
              onChange={e => set("additional_context", e.target.value)}
              placeholder="Any additional notes, special requirements, or context..."
            />
          </div>
        </div>
      </div>

      <div style={S.submitRow}>
        <button style={{ ...S.btn, ...S.btnSecondary }} onClick={() => { setForm(EMPTY_FORM); setAlert(null); setJsonErrors({}); }}>
          Clear Form
        </button>
        <button
          style={{ ...S.btn, ...S.btnPrimary, ...(submitting ? S.btnDisabled : {}) }}
          onClick={handleSubmit}
          disabled={submitting}
        >
          {submitting ? "Submitting…" : "✅ Submit Campaign"}
        </button>
      </div>
    </div>
  );
}

// ── Manage Campaigns Table ────────────────────────────────────────────────────
function ManageCampaigns() {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");

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
        <input
          style={{ ...S.input, width: 260 }}
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="🔍 Search by advertiser, publisher…"
        />
        <button style={{ ...S.btn, ...S.btnSecondary, padding: "7px 16px", fontSize: 12 }} onClick={load}>
          ⟳ Refresh
        </button>
      </div>

      {error && (
        <div style={{ ...S.alert, ...S.alertError }}>❌ {error}</div>
      )}

      <div style={S.card}>
        {loading ? (
          <div style={S.spinner}>Loading campaigns…</div>
        ) : filtered.length === 0 ? (
          <div style={S.empty}>{search ? "No campaigns match your search." : "No campaigns submitted yet."}</div>
        ) : (
          <div style={S.tableWrap}>
            <table style={S.table}>
              <thead>
                <tr>
                  {["#", "Type", "Advertiser", "Publisher", "Industry", "Brand", "Offer", "Adv Data", "Pub Data", "Status"].map(h => (
                    <th key={h} style={S.th}>{h}</th>
                  ))}
                </tr>
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
                    <td style={S.td}>
                      {c.advertiser_data_url ? (
                        <a href={c.advertiser_data_url} target="_blank" rel="noopener noreferrer" style={{ color: "#2563eb" }}>View Sheet ↗</a>
                      ) : "—"}
                    </td>
                    <td style={S.td}>
                      {c.publisher_data_url ? (
                        <a href={c.publisher_data_url} target="_blank" rel="noopener noreferrer" style={{ color: "#2563eb" }}>View Sheet ↗</a>
                      ) : "—"}
                    </td>
                    <td style={S.td}>
                      <span style={{ ...S.statusBadge, ...statusStyle(c.status) }}>
                        {c.status || "Unknown"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ fontSize: 12, color: "#888", marginTop: 10 }}>
              Showing {filtered.length} of {campaigns.length} campaigns
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function CampaignOnboarding({ filterOptions }) {
  const [subTab, setSubTab] = useState("new");

  return (
    <div style={S.container}>
      <div style={S.subTabs}>
        {[
          { id: "new",    label: "➕ New Campaign" },
          { id: "manage", label: "📂 Manage Campaigns" },
        ].map(t => (
          <button
            key={t.id}
            style={{ ...S.subTab, ...(subTab === t.id ? S.subTabActive : {}) }}
            onClick={() => setSubTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {subTab === "new"    && <NewCampaignForm filterOptions={filterOptions} />}
      {subTab === "manage" && <ManageCampaigns />}
    </div>
  );
}
