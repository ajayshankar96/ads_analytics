import React, { useState, useEffect } from "react";
import { getWorkflowCampaigns, getFilters, submitTrackingSetup, getSheetHeaders, syncCampaign, getCampaignMetrics, runAttribution } from "../api";

const c = { blue: "#2E5BFF", ink: "#0F1724", sub: "#52606D", line: "#E6EAF0", muted: "#768EA7", green: "#0F8C6A", red: "#C8321E", bg: "#F7F8FA" };

const s = {
  loading: { textAlign: "center", padding: 40, color: "#888" },
  empty: { textAlign: "center", padding: 40, color: "#94a3b8", fontSize: 14 },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 },
  title: { fontSize: 20, fontWeight: 800, color: c.ink },
  list: { display: "flex", flexDirection: "column", gap: 12 },
  card: { background: "#fff", border: `1px solid ${c.line}`, borderRadius: 12, padding: "16px 20px", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" },
  cardActive: { borderColor: c.blue, boxShadow: "0 2px 12px rgba(46,91,255,0.12)" },
  head: { display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" },
  campTitle: { fontSize: 15, fontWeight: 700, color: c.ink },
  campSub: { fontSize: 12, color: c.muted, marginTop: 2 },
  badge: { fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 14 },
  badgePending: { background: "#FEF3E2", color: "#B7791F" },
  badgeDone: { background: "#E3F6EE", color: c.green },
  panel: { marginTop: 16, borderTop: `1px solid ${c.line}`, paddingTop: 16 },
  section: { marginBottom: 20 },
  secTitle: { fontSize: 14, fontWeight: 800, color: c.ink, marginBottom: 12 },
  grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 },
  field: { display: "flex", flexDirection: "column", marginBottom: 12 },
  label: { fontSize: 12, fontWeight: 600, color: c.muted, marginBottom: 4, textTransform: "uppercase", letterSpacing: ".03em" },
  input: { border: `1px solid ${c.line}`, borderRadius: 7, padding: "9px 12px", fontSize: 13, color: c.ink, outline: "none", fontFamily: "inherit", width: "100%" },
  textarea: { border: `1px solid ${c.line}`, borderRadius: 7, padding: "9px 12px", fontSize: 13, color: c.ink, outline: "none", fontFamily: "inherit", width: "100%", minHeight: 80, resize: "vertical" },
  btnGreen: { background: c.green, color: "#fff", border: "none", borderRadius: 8, padding: "10px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer" },
  addBtn: { background: "#E3F6EE", color: c.green, border: "none", borderRadius: 6, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" },
  removeBtn: { background: "#FEE2E2", color: c.red, border: "none", borderRadius: 6, padding: "5px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer" },
  metricCard: { border: `1px solid ${c.line}`, borderRadius: 10, padding: "14px 16px", marginBottom: 12 },
  metricTitle: { fontSize: 13, fontWeight: 700, color: c.ink, marginBottom: 10, display: "flex", justifyContent: "space-between" },
  doneCard: { background: "#E3F6EE", borderRadius: 10, padding: "14px 16px" },
  doneTitle: { fontSize: 13, fontWeight: 700, color: c.green },
};

const GOAL_PERIODS = ["daily", "weekly", "monthly", "date_agnostic"];

const CAMPAIGN_TYPES = ["Single Campaign Sheet", "Two different Sheets"];

const COMPUTED_PRESETS = [
  { name: "CPL", formula: "Spends / Leads", needs: ["Leads"] },
  { name: "CPQL", formula: "Spends / QL", needs: ["QL"] },
  { name: "CPA", formula: "Spends / Orders", needs: ["Orders"] },
  { name: "ROAS", formula: "Revenue / Spends", needs: ["Revenue"] },
  { name: "CAC", formula: "Spends / Customers", needs: ["Customers"] },
  { name: "CPR", formula: "Spends / Registrations", needs: ["Registrations"] },
  { name: "CPQQG", formula: "Spends / QQG", needs: ["QQG"] },
];

const INDUSTRY_PRESETS = {
  "BPC": ["Orders", "Revenue", "Leads", "QL"],
  "BFSI": ["Leads", "QL", "Applications", "Disbursements"],
  "Non BPC": ["Orders", "Revenue", "Leads"],
  "E-commerce": ["Orders", "Revenue", "Leads", "QL", "QQG"],
};

function TrackingForm({ campaign, segments, onDone }) {
  const [campaignType, setCampaignType] = useState("Single Campaign Sheet");
  const [advDataUrl, setAdvDataUrl] = useState(campaign.advertiser_data_url || "");
  const [pubDataUrl, setPubDataUrl] = useState(campaign.publisher_data_url || "");
  const [segmentPub, setSegmentPub] = useState(campaign.segment_pub || "");
  const [segmentAdv, setSegmentAdv] = useState(campaign.segment_adv || "");
  const [goals, setGoals] = useState([{ name: "", period: "daily", value: "" }]);
  const [additionalContext, setAdditionalContext] = useState(campaign.additional_context || "");
  const [submitting, setSubmitting] = useState(false);

  // Metrics auto-detection
  const [sheetHeaders, setSheetHeaders] = useState([]);
  const [loadingHeaders, setLoadingHeaders] = useState(false);
  const [selectedMetrics, setSelectedMetrics] = useState([]);
  const [computedMetrics, setComputedMetrics] = useState([]);
  const [customMetrics, setCustomMetrics] = useState([]);

  const handleDetectHeaders = async () => {
    if (!advDataUrl.trim()) { alert("Enter Advertiser Data Sheet URL first"); return; }
    setLoadingHeaders(true);
    try {
      const res = await getSheetHeaders(advDataUrl);
      setSheetHeaders(res.headers || []);
    } catch (e) { alert("Failed to read sheet: " + e.message); }
    finally { setLoadingHeaders(false); }
  };

  const toggleMetric = (header) => {
    setSelectedMetrics((prev) =>
      prev.includes(header) ? prev.filter((h) => h !== header) : [...prev, header]
    );
  };

  const toggleComputed = (preset) => {
    setComputedMetrics((prev) =>
      prev.find((p) => p.name === preset.name)
        ? prev.filter((p) => p.name !== preset.name)
        : [...prev, preset]
    );
  };

  const addCustomMetric = () => setCustomMetrics([...customMetrics, { display_name: "", definition: "", calculation: "" }]);
  const removeCustomMetric = (i) => setCustomMetrics(customMetrics.filter((_, idx) => idx !== i));
  const updateCustomMetric = (i, patch) => setCustomMetrics(customMetrics.map((m, idx) => idx === i ? { ...m, ...patch } : m));

  // Suggest computed metrics based on selected direct metrics
  const suggestedComputed = COMPUTED_PRESETS.filter((p) =>
    p.needs.some((n) => selectedMetrics.some((m) => m.toLowerCase().includes(n.toLowerCase())))
  );

  const addGoal = () => setGoals([...goals, { name: "", period: "daily", value: "" }]);
  const removeGoal = (i) => setGoals(goals.filter((_, idx) => idx !== i));
  const updateGoal = (i, patch) => setGoals(goals.map((g, idx) => idx === i ? { ...g, ...patch } : g));

  const buildGoalsJson = () => {
    const obj = { goals: { daily: {}, weekly: {}, monthly: {}, date_agnostic: {} } };
    goals.forEach((g) => {
      if (g.name.trim() && g.period) obj.goals[g.period][g.name.trim()] = parseFloat(g.value) || 0;
    });
    return JSON.stringify(obj);
  };

  const buildMetricsJson = () => {
    const obj = { metrics_library: {} };
    let idx = 1;
    // Direct metrics (from sheet headers)
    selectedMetrics.forEach((m) => {
      obj.metrics_library[`metric_${idx}`] = { display_name: m, definition: `${m} data from advertiser sheet`, calculation: "" };
      idx++;
    });
    // Computed metrics (from presets)
    computedMetrics.forEach((p) => {
      obj.metrics_library[`metric_${idx}`] = { display_name: p.name, definition: `Computed: ${p.formula}`, calculation: p.formula };
      idx++;
    });
    // Custom metrics (manually added)
    customMetrics.forEach((m) => {
      if (m.display_name.trim()) {
        obj.metrics_library[`metric_${idx}`] = { display_name: m.display_name.trim(), definition: m.definition.trim(), calculation: m.calculation.trim() };
        idx++;
      }
    });
    return JSON.stringify(obj);
  };

  const handleSubmit = async () => {
    if (!advDataUrl.trim() || !pubDataUrl.trim()) { alert("Advertiser and Publisher Data Sheet URLs are required"); return; }
    if (!segmentPub.trim() || !segmentAdv.trim()) { alert("Segment names are required"); return; }
    if (selectedMetrics.length === 0 && customMetrics.length === 0) { alert("Select at least one metric to track"); return; }
    setSubmitting(true);
    try {
      await submitTrackingSetup(campaign.campaign_id, {
        campaign_type: campaignType,
        advertiser_data_url: advDataUrl, publisher_data_url: pubDataUrl,
        segment_pub: segmentPub, segment_adv: segmentAdv,
        goals_json: buildGoalsJson(), metrics_json: buildMetricsJson(),
        additional_context: additionalContext,
      });
      onDone();
    } catch (e) { alert("Submit failed: " + e.message); }
    finally { setSubmitting(false); }
  };

  return (
    <div style={s.panel}>
      <div style={{ ...s.field, marginBottom: 14 }}>
        <label style={s.label}>Campaign Type *</label>
        <select style={s.input} value={campaignType} onChange={(e) => setCampaignType(e.target.value)}>
          {CAMPAIGN_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div style={s.grid2}>
        <div style={s.field}>
          <label style={s.label}>Advertiser Data Sheet URL *</label>
          <input style={s.input} value={advDataUrl} onChange={(e) => setAdvDataUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..." />
        </div>
        <div style={s.field}>
          <label style={s.label}>Publisher Data Sheet URL *</label>
          <input style={s.input} value={pubDataUrl} onChange={(e) => setPubDataUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..." />
        </div>
        <div style={s.field}>
          <label style={s.label}>Segment Name (Publisher) *</label>
          <select style={s.input} value={segmentPub} onChange={(e) => setSegmentPub(e.target.value)}>
            <option value="">Select segment…</option>
            {segments.map((seg) => <option key={seg} value={seg}>{seg}</option>)}
            <option value="__custom">— Enter custom —</option>
          </select>
          {segmentPub === "__custom" && <input style={{ ...s.input, marginTop: 6 }} onChange={(e) => setSegmentPub(e.target.value)} placeholder="Custom segment name" />}
        </div>
        <div style={s.field}>
          <label style={s.label}>Segment Name (Advertiser) *</label>
          <input style={s.input} value={segmentAdv} onChange={(e) => setSegmentAdv(e.target.value)} placeholder="e.g. Partnership_Razorpay" />
        </div>
      </div>

      {/* Goals */}
      <div style={{ ...s.field, marginTop: 8 }}>
        <label style={{ ...s.label, fontSize: 13, marginBottom: 10 }}>Goals</label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 140px 100px 40px", gap: 8, marginBottom: 6, fontSize: 11, color: c.muted, fontWeight: 700 }}>
          <span>GOAL NAME</span><span>PERIOD</span><span>VALUE</span><span></span>
        </div>
        {goals.map((g, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 140px 100px 40px", gap: 8, marginBottom: 8 }}>
            <input style={s.input} value={g.name} onChange={(e) => updateGoal(i, { name: e.target.value })} placeholder="e.g. CPL" />
            <select style={s.input} value={g.period} onChange={(e) => updateGoal(i, { period: e.target.value })}>
              {GOAL_PERIODS.map((p) => <option key={p} value={p}>{p.replace("_", " ")}</option>)}
            </select>
            <input style={s.input} type="number" value={g.value} onChange={(e) => updateGoal(i, { value: e.target.value })} placeholder="0" />
            <button style={s.removeBtn} onClick={() => removeGoal(i)}>✕</button>
          </div>
        ))}
        <button style={s.addBtn} onClick={addGoal}>+ Add Goal</button>
      </div>

      {/* Metrics Library — Auto-detect */}
      <div style={{ ...s.field, marginTop: 16 }}>
        <label style={{ ...s.label, fontSize: 13, marginBottom: 6 }}>Metrics Library</label>
        <div style={{ fontSize: 12, color: c.muted, marginBottom: 12 }}>
          Select a category preset to pick the direct metrics to track, then choose computed metrics.
        </div>

        {/* Industry preset buttons */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: c.muted, marginBottom: 6, fontWeight: 700 }}>Select category:</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {Object.entries(INDUSTRY_PRESETS).map(([industry, presetMetrics]) => {
              const isActive = JSON.stringify(selectedMetrics) === JSON.stringify(presetMetrics);
              return (
                <button key={industry} style={{ ...s.removeBtn, background: isActive ? "#E3F6EE" : "#EAF0FF", color: isActive ? c.green : c.blue, border: `1px solid ${isActive ? c.green : "transparent"}` }} onClick={() => setSelectedMetrics(presetMetrics)}>
                  {industry}
                </button>
              );
            })}
          </div>
        </div>

        {/* Selected direct metrics as editable chips */}
        {selectedMetrics.length > 0 && (
          <div style={{ border: `1px solid ${c.line}`, borderRadius: 10, padding: "12px 14px", marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: c.ink, marginBottom: 8 }}>
              Direct metrics to extract ({selectedMetrics.length})
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {selectedMetrics.map((m) => (
                <span key={m} style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 6, fontSize: 12, background: "#E3F6EE", border: `1px solid ${c.green}`, fontWeight: 600 }}>
                  {m}
                  <span style={{ cursor: "pointer", color: c.red, fontWeight: 800 }} onClick={() => toggleMetric(m)}>×</span>
                </span>
              ))}
              <input
                style={{ border: `1px dashed ${c.line}`, borderRadius: 6, padding: "4px 10px", fontSize: 12, outline: "none", width: 120 }}
                placeholder="+ Add more"
                onKeyDown={(e) => { if (e.key === "Enter" && e.target.value.trim()) { setSelectedMetrics([...selectedMetrics, e.target.value.trim()]); e.target.value = ""; } }}
              />
            </div>
          </div>
        )}

        {/* Suggested computed metrics */}
        {selectedMetrics.length > 0 && suggestedComputed.length > 0 && (
          <div style={{ border: `1px solid ${c.line}`, borderRadius: 10, padding: "12px 14px", marginBottom: 14, background: "#FEFCE8" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#92400E", marginBottom: 8 }}>
              Suggested computed metrics (based on your selection)
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {suggestedComputed.map((p) => {
                const isSelected = computedMetrics.find((cp) => cp.name === p.name);
                return (
                  <label key={p.name} style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 6, fontSize: 12, cursor: "pointer", background: isSelected ? "#E3F6EE" : "#fff", border: `1px solid ${isSelected ? c.green : c.line}` }}>
                    <input type="checkbox" checked={!!isSelected} onChange={() => toggleComputed(p)} style={{ width: 14, height: 14 }} />
                    <span style={{ fontWeight: 600 }}>{p.name}</span>
                    <span style={{ color: c.muted, fontSize: 11 }}>= {p.formula}</span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {/* Selected summary */}
        {(selectedMetrics.length > 0 || computedMetrics.length > 0) && (
          <div style={{ fontSize: 12, color: c.green, fontWeight: 600, marginBottom: 10 }}>
            Direct: {selectedMetrics.join(", ") || "none"} | Computed: {computedMetrics.map((p) => p.name).join(", ") || "none"}
          </div>
        )}

        {/* Custom metrics (manual add) */}
        <div style={{ fontSize: 11, color: c.muted, fontWeight: 700, marginTop: 12, marginBottom: 8 }}>Custom metrics (optional)</div>
        {customMetrics.map((m, i) => (
          <div key={i} style={s.metricCard}>
            <div style={s.metricTitle}><span>Custom {i + 1}</span><button style={s.removeBtn} onClick={() => removeCustomMetric(i)}>Remove</button></div>
            <div style={s.field}><label style={{ ...s.label, fontSize: 11 }}>Display Name</label><input style={s.input} value={m.display_name} onChange={(e) => updateCustomMetric(i, { display_name: e.target.value })} placeholder="e.g. Leads" /></div>
            <div style={s.field}><label style={{ ...s.label, fontSize: 11 }}>Calculation (optional)</label><input style={s.input} value={m.calculation} onChange={(e) => updateCustomMetric(i, { calculation: e.target.value })} placeholder="e.g. Spends/QL" /></div>
          </div>
        ))}
        <button style={{ ...s.addBtn, background: "#F7F8FA", color: c.sub, border: `1px solid ${c.line}` }} onClick={addCustomMetric}>+ Add custom metric</button>
      </div>

      <div style={{ ...s.field, marginTop: 16 }}>
        <label style={s.label}>Additional Context</label>
        <textarea style={s.textarea} value={additionalContext} onChange={(e) => setAdditionalContext(e.target.value)} placeholder="Any notes or context..." />
      </div>

      <button style={s.btnGreen} onClick={handleSubmit} disabled={submitting}>
        {submitting ? "Submitting…" : "Submit Tracking & Complete Campaign ✓"}
      </button>
    </div>
  );
}

function TrackingDoneView({ campaign, canEdit }) {
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [metrics, setMetrics] = useState(null);

  useEffect(() => {
    getCampaignMetrics(campaign.campaign_id).then(setMetrics).catch(() => {});
  }, [campaign.campaign_id]);

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const r = await syncCampaign(campaign.campaign_id);
      setSyncResult(r);
      getCampaignMetrics(campaign.campaign_id).then(setMetrics).catch(() => {});
    } catch (e) { setSyncResult({ error: e.message }); }
    finally { setSyncing(false); }
  };

  return (
    <div style={s.panel}>
      <div style={s.doneCard}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={s.doneTitle}>✅ Tracking submitted</div>
          {canEdit && (
            <button onClick={handleSync} disabled={syncing} style={{ background: c.blue, color: "#fff", border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
              {syncing ? "Syncing…" : "⟳ Sync Data"}
            </button>
          )}
        </div>
        {syncResult && (
          <div style={{ marginTop: 8, fontSize: 12, color: syncResult.error ? c.red : c.green }}>
            {syncResult.error ? `Error: ${syncResult.error}` : `✓ Synced ${syncResult.rows} rows`}
          </div>
        )}
        {metrics && metrics.rows > 0 && (
          <div style={{ marginTop: 6, fontSize: 12, color: c.muted }}>
            {metrics.rows} data points · Last synced: {metrics.last_synced ? new Date(metrics.last_synced).toLocaleString("en-IN") : "—"}
          </div>
        )}
      </div>

      {/* Tracking details */}
      <div style={{ marginTop: 14, border: `1px solid ${c.line}`, borderRadius: 10, padding: "14px 16px" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: c.ink, marginBottom: 10 }}>Tracking Details</div>
        {[
          ["Advertiser Data URL", campaign.advertiser_data_url],
          ["Publisher Data URL", campaign.publisher_data_url],
          ["Segment (Publisher)", campaign.segment_pub],
          ["Segment (Advertiser)", campaign.segment_adv],
          ["Goals", campaign.goals_json],
          ["Metrics", campaign.metrics_json],
          ["Additional Context", campaign.additional_context],
        ].map(([label, val]) => (
          <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "6px 0", borderBottom: `1px solid #F7F8FA`, fontSize: 13 }}>
            <span style={{ color: c.muted, minWidth: 160 }}>{label}</span>
            <span style={{ color: c.ink, fontWeight: 500, textAlign: "right", maxWidth: "60%", wordBreak: "break-all", whiteSpace: "pre-wrap" }}>
              {val ? (val.startsWith && val.startsWith("http") ? <a href={val} target="_blank" rel="noopener noreferrer" style={{ color: c.blue }}>{val}</a> : val) : "—"}
            </span>
          </div>
        ))}
      </div>

      {/* Revenue Attribution */}
      {canEdit && <AttributionSection campaign={campaign} />}
    </div>
  );
}

function AttributionSection({ campaign }) {
  const [driveFolderUrl, setDriveFolderUrl] = useState("");
  const [file, setFile] = useState(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);

  // Check if campaign has dynamic codes
  const hasDynamicCodes = (() => {
    try { const d = JSON.parse(campaign.promo_codes || '{}'); return d.type === 'dynamic'; } catch { return false; }
  })();

  if (!hasDynamicCodes) return null;

  const handleRun = async () => {
    if (!file) { alert("Upload a redemption file"); return; }
    if (!driveFolderUrl.trim()) { alert("Enter the Drive folder URL"); return; }
    setRunning(true);
    setResult(null);
    try {
      const r = await runAttribution(campaign.campaign_id, file, driveFolderUrl);
      setResult(r);
    } catch (e) { alert("Attribution failed: " + e.message); }
    finally { setRunning(false); }
  };

  return (
    <div style={{ marginTop: 14, border: `1px solid ${c.line}`, borderRadius: 10, padding: "14px 16px" }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: c.ink, marginBottom: 12 }}>Revenue Attribution</div>

      {!result ? (
        <>
          <div style={{ fontSize: 12, color: c.muted, marginBottom: 12 }}>
            Upload the redemption/revenue file and provide the Drive folder containing publisher code CSVs.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: c.muted, display: "block", marginBottom: 4, textTransform: "uppercase" }}>Redemption File (CSV/Excel)</label>
              <input type="file" accept=".csv,.xlsx,.xls" onChange={(e) => setFile(e.target.files?.[0] || null)}
                style={{ fontSize: 12 }} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: c.muted, display: "block", marginBottom: 4, textTransform: "uppercase" }}>Drive Folder URL</label>
              <input style={{ border: `1px solid ${c.line}`, borderRadius: 7, padding: "9px 12px", fontSize: 13, width: "100%", outline: "none" }}
                value={driveFolderUrl} onChange={(e) => setDriveFolderUrl(e.target.value)}
                placeholder="https://drive.google.com/drive/folders/..." />
            </div>
          </div>
          <button onClick={handleRun} disabled={running || !file || !driveFolderUrl.trim()}
            style={{ background: "#7C3AED", color: "#fff", border: "none", borderRadius: 8, padding: "10px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer", opacity: (!file || !driveFolderUrl.trim()) ? 0.5 : 1 }}>
            {running ? "Running attribution…" : "Run Revenue Attribution"}
          </button>
        </>
      ) : (
        <>
          {/* Results summary */}
          <div style={{ background: "#F0F4FF", borderRadius: 10, padding: "14px 16px", marginBottom: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, textAlign: "center" }}>
              <div><div style={{ fontSize: 11, color: c.muted, fontWeight: 700 }}>TOTAL ORDERS</div><div style={{ fontSize: 18, fontWeight: 800, color: c.ink }}>{result.totals?.orders?.toLocaleString()}</div></div>
              <div><div style={{ fontSize: 11, color: c.muted, fontWeight: 700 }}>TOTAL REVENUE</div><div style={{ fontSize: 18, fontWeight: 800, color: c.ink }}>₹{result.totals?.revenue?.toLocaleString()}</div></div>
              <div><div style={{ fontSize: 11, color: c.muted, fontWeight: 700 }}>ATTRIBUTED</div><div style={{ fontSize: 18, fontWeight: 800, color: c.green }}>{result.totals?.attribution_rate}%</div></div>
              <div><div style={{ fontSize: 11, color: c.muted, fontWeight: 700 }}>UNATTRIBUTED</div><div style={{ fontSize: 18, fontWeight: 800, color: c.red }}>{result.unattributed?.orders}</div></div>
            </div>
          </div>

          {/* Per-publisher breakdown */}
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${c.line}` }}>
                <th style={{ textAlign: "left", padding: "8px 10px", fontSize: 11, color: c.muted, fontWeight: 700 }}>PUBLISHER</th>
                <th style={{ textAlign: "left", padding: "8px 10px", fontSize: 11, color: c.muted, fontWeight: 700 }}>OFFER</th>
                <th style={{ textAlign: "right", padding: "8px 10px", fontSize: 11, color: c.muted, fontWeight: 700 }}>ORDERS</th>
                <th style={{ textAlign: "right", padding: "8px 10px", fontSize: 11, color: c.muted, fontWeight: 700 }}>REVENUE</th>
              </tr>
            </thead>
            <tbody>
              {(result.summary || []).map((row, i) => (
                <tr key={i} style={{ borderBottom: `1px solid #F7F8FA` }}>
                  <td style={{ padding: "8px 10px", fontWeight: 600 }}>{row.publisher}</td>
                  <td style={{ padding: "8px 10px", color: c.sub }}>{row.offer}</td>
                  <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 600 }}>{row.orders.toLocaleString()}</td>
                  <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 700 }}>₹{row.revenue.toLocaleString()}</td>
                </tr>
              ))}
              {result.unattributed?.orders > 0 && (
                <tr style={{ background: "#FEF3E2" }}>
                  <td style={{ padding: "8px 10px", fontWeight: 600, color: c.red }}>Unattributed</td>
                  <td style={{ padding: "8px 10px", color: c.muted }}>—</td>
                  <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 600, color: c.red }}>{result.unattributed.orders.toLocaleString()}</td>
                  <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 700, color: c.red }}>₹{result.unattributed.revenue.toLocaleString()}</td>
                </tr>
              )}
            </tbody>
          </table>

          <button onClick={() => setResult(null)} style={{ marginTop: 12, background: "#F1F5F9", color: c.sub, border: "none", borderRadius: 6, padding: "8px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
            Run again with new file
          </button>
        </>
      )}
    </div>
  );
}

export default function CampaignTracking({ userRole = "VIEWER" }) {
  const canEdit = userRole === "ADMIN" || userRole === "OPS";
  const [campaigns, setCampaigns] = useState([]);
  const [segments, setSegments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const [cRes, fRes] = await Promise.all([getWorkflowCampaigns(), getFilters()]);
      const liveCamps = (cRes.campaigns || []).filter((c) => c.current_stage === "LIVE" || c.current_stage === "COMPLETED");
      setCampaigns(liveCamps);
      setSegments(fRes.segments || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  if (loading) return <div style={s.loading}>Loading campaigns…</div>;

  return (
    <div>
      <div style={s.header}>
        <div style={s.title}>Campaign Success & Tracking</div>
      </div>

      {campaigns.length === 0 ? (
        <div style={s.empty}>No live campaigns yet. Campaigns appear here once they go live in Campaign Ops.</div>
      ) : (
        <div style={s.list}>
          {campaigns.map((cam) => {
            const isSelected = selected === cam.campaign_id;
            const isDone = cam.tracking_submitted || cam.current_stage === "COMPLETED";
            return (
              <div key={cam.campaign_id} style={{ ...s.card, ...(isSelected ? s.cardActive : {}) }}>
                <div style={s.head} onClick={() => setSelected(isSelected ? null : cam.campaign_id)}>
                  <div>
                    <div style={s.campTitle}>
                      {cam.advertiser_name || cam.name}
                      {cam.publisher_name && <span style={{ fontWeight: 400, color: c.muted }}> → {cam.publisher_name}</span>}
                    </div>
                    <div style={s.campSub}>{cam.campaign_id}</div>
                  </div>
                  <span style={{ ...s.badge, ...(isDone ? s.badgeDone : s.badgePending) }}>
                    {isDone ? "Tracking Set ✓" : "Pending Setup"}
                  </span>
                </div>

                {isSelected && (
                  isDone ? (
                    <TrackingDoneView campaign={cam} canEdit={canEdit} />
                  ) : (
                    canEdit ? <TrackingForm campaign={cam} segments={segments} onDone={load} /> :
                    <div style={{ ...s.doneCard, background: "#FEF3E2" }}><div style={{ fontSize: 13, fontWeight: 700, color: "#B7791F" }}>View only — you don't have permission to edit tracking setup</div></div>
                  )
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
