import React, { useState, useEffect } from "react";
import { getWorkflowCampaigns, getFilters, submitTrackingSetup, getSheetHeaders, syncCampaign, getCampaignMetrics, runAttribution } from "../api";

const c = { blue: "#2E5BFF", ink: "#0F1724", sub: "#52606D", line: "#E6EAF0", muted: "#768EA7", green: "#0F8C6A", red: "#C8321E", amber: "#B7791F", bg: "#F7F8FA" };

const CAMPAIGN_TYPES = ["Single Campaign Sheet", "Two different Sheets"];
const GOAL_PERIODS = ["daily", "weekly", "monthly", "date_agnostic"];
const INDUSTRY_PRESETS = {
  "BPC": ["Orders", "Revenue", "Leads", "QL"],
  "BFSI": ["Leads", "QL", "Applications", "Disbursements"],
  "Non BPC": ["Orders", "Revenue", "Leads"],
  "E-commerce": ["Orders", "Revenue", "Leads", "QL", "QQG"],
};
const COMPUTED_PRESETS = [
  { name: "CPL", formula: "Spends / Leads", needs: ["Leads"] },
  { name: "CPQL", formula: "Spends / QL", needs: ["QL"] },
  { name: "CPA", formula: "Spends / Orders", needs: ["Orders"] },
  { name: "ROAS", formula: "Revenue / Spends", needs: ["Revenue"] },
];
const DRIVE_CODES_FOLDER = "https://drive.google.com/drive/folders/1QCcZtxs_KekuBYVB5Z2OzsYkgitpANhO";

// ── Left Panel: Campaign List ────────────────────────────────────────────────
function CampaignList({ campaigns, selected, onSelect }) {
  const [filter, setFilter] = useState("all");
  const filtered = filter === "all" ? campaigns : filter === "tracked" ? campaigns.filter((c) => c.tracking_submitted) : campaigns.filter((c) => !c.tracking_submitted);

  return (
    <div style={{ width: 320, borderRight: `1px solid ${c.line}`, background: "#fff", overflowY: "auto", flexShrink: 0, height: "calc(100vh - 140px)" }}>
      <div style={{ padding: "12px 14px", borderBottom: `1px solid ${c.line}`, display: "flex", gap: 6, position: "sticky", top: 0, background: "#fff", zIndex: 1 }}>
        {[["all", "All"], ["tracked", "Tracked"], ["pending", "Pending"]].map(([k, label]) => (
          <button key={k} onClick={() => setFilter(k)} style={{ padding: "5px 10px", borderRadius: 14, fontSize: 11, fontWeight: 600, border: `1px solid ${filter === k ? c.blue : c.line}`, background: filter === k ? "#EAF0FF" : "#fff", color: filter === k ? c.blue : c.sub, cursor: "pointer" }}>{label}</button>
        ))}
      </div>
      {filtered.map((cam) => {
        const isDone = cam.tracking_submitted;
        const isActive = selected === cam.campaign_id;
        return (
          <div key={cam.campaign_id} onClick={() => onSelect(cam.campaign_id)}
            style={{ padding: "12px 14px", borderBottom: `1px solid #F1F5F9`, cursor: "pointer", background: isActive ? "#F0F4FF" : "#fff", borderLeft: isActive ? `3px solid ${c.blue}` : "3px solid transparent" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: c.ink }}>{cam.advertiser_name} → {cam.publisher_name}</div>
            <div style={{ fontSize: 11, color: c.muted, marginTop: 2 }}>{cam.campaign_id} · {cam.offer_title || ""}</div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
              <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10, background: isDone ? "#E3F6EE" : "#FEF3E2", color: isDone ? c.green : c.amber }}>{isDone ? "Tracked ✓" : "Pending"}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Right Panel: Detail with Tabs ────────────────────────────────────────────
function CampaignDetail({ campaign, segments, canEdit, onReload }) {
  const [activeTab, setActiveTab] = useState(campaign.tracking_submitted ? "sync" : "setup");
  const isDone = campaign.tracking_submitted;

  const tabs = [
    { id: "setup", label: "Setup" },
    { id: "sync", label: "Data Sync" },
    { id: "attribution", label: "Attribution" },
  ];

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "24px", height: "calc(100vh - 140px)" }}>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 20, fontWeight: 800, color: c.ink }}>{campaign.advertiser_name} → {campaign.publisher_name}</h2>
        <div style={{ fontSize: 12, color: c.muted, marginTop: 2 }}>{campaign.campaign_id} · {campaign.offer_title || ""}</div>
      </div>

      <div style={{ display: "flex", gap: 0, marginBottom: 20, borderBottom: `2px solid ${c.line}` }}>
        {tabs.map((tab) => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            style={{ padding: "10px 18px", fontSize: 13, fontWeight: 600, color: activeTab === tab.id ? c.blue : c.muted, cursor: "pointer", border: "none", background: "none", borderBottom: `2px solid ${activeTab === tab.id ? c.blue : "transparent"}`, marginBottom: -2 }}>{tab.label}</button>
        ))}
      </div>

      {activeTab === "setup" && <SetupTab campaign={campaign} segments={segments} canEdit={canEdit} onReload={onReload} />}
      {activeTab === "sync" && <SyncTab campaign={campaign} canEdit={canEdit} />}
      {activeTab === "attribution" && <AttributionTab campaign={campaign} />}
    </div>
  );
}

// ── Setup Tab ────────────────────────────────────────────────────────────────
function SetupTab({ campaign, segments, canEdit, onReload }) {
  const [campaignType, setCampaignType] = useState("Single Campaign Sheet");
  const [advDataUrl, setAdvDataUrl] = useState(campaign.advertiser_data_url || "");
  const [pubDataUrl, setPubDataUrl] = useState(campaign.publisher_data_url || "");
  const [segmentPub, setSegmentPub] = useState(campaign.segment_pub || "");
  const [segmentAdv, setSegmentAdv] = useState(campaign.segment_adv || "");
  const [goals, setGoals] = useState([{ name: "", period: "daily", value: "" }]);
  const [selectedMetrics, setSelectedMetrics] = useState([]);
  const [computedMetrics, setComputedMetrics] = useState([]);
  const [additionalContext, setAdditionalContext] = useState(campaign.additional_context || "");
  const [submitting, setSubmitting] = useState(false);

  const toggleMetric = (m) => setSelectedMetrics((prev) => prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]);
  const toggleComputed = (p) => setComputedMetrics((prev) => prev.find((x) => x.name === p.name) ? prev.filter((x) => x.name !== p.name) : [...prev, p]);
  const suggestedComputed = COMPUTED_PRESETS.filter((p) => p.needs.some((n) => selectedMetrics.some((m) => m.toLowerCase().includes(n.toLowerCase()))));

  const buildGoalsJson = () => { const obj = { goals: { daily: {}, weekly: {}, monthly: {}, date_agnostic: {} } }; goals.forEach((g) => { if (g.name.trim() && g.period) obj.goals[g.period][g.name.trim()] = parseFloat(g.value) || 0; }); return JSON.stringify(obj); };
  const buildMetricsJson = () => { const obj = { metrics_library: {} }; let idx = 1; selectedMetrics.forEach((m) => { obj.metrics_library[`metric_${idx}`] = { display_name: m, definition: `${m} from advertiser sheet`, calculation: "" }; idx++; }); computedMetrics.forEach((p) => { obj.metrics_library[`metric_${idx}`] = { display_name: p.name, definition: `Computed: ${p.formula}`, calculation: p.formula }; idx++; }); return JSON.stringify(obj); };

  const handleSubmit = async () => {
    if (!advDataUrl.trim() || !pubDataUrl.trim()) { alert("Data Sheet URLs required"); return; }
    if (!segmentPub.trim() || !segmentAdv.trim()) { alert("Segment names required"); return; }
    setSubmitting(true);
    try { await submitTrackingSetup(campaign.campaign_id, { campaign_type: campaignType, advertiser_data_url: advDataUrl, publisher_data_url: pubDataUrl, segment_pub: segmentPub, segment_adv: segmentAdv, goals_json: buildGoalsJson(), metrics_json: buildMetricsJson(), additional_context: additionalContext }); onReload(); }
    catch (e) { alert("Failed: " + e.message); }
    finally { setSubmitting(false); }
  };

  if (campaign.tracking_submitted) {
    return (
      <div>
        <div style={{ background: "#E3F6EE", borderRadius: 10, padding: "12px 14px", marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: c.green }}>✅ Tracking submitted</div>
        </div>
        <div style={{ border: `1px solid ${c.line}`, borderRadius: 10, padding: "14px" }}>
          {[["Advertiser Data URL", campaign.advertiser_data_url], ["Publisher Data URL", campaign.publisher_data_url], ["Segment (Publisher)", campaign.segment_pub], ["Segment (Advertiser)", campaign.segment_adv], ["Goals", campaign.goals_json], ["Metrics", campaign.metrics_json], ["Additional Context", campaign.additional_context]].map(([label, val]) => (
            <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "6px 0", borderBottom: `1px solid #F7F8FA`, fontSize: 12 }}>
              <span style={{ color: c.muted, minWidth: 140 }}>{label}</span>
              <span style={{ color: c.ink, fontWeight: 500, textAlign: "right", maxWidth: "60%", wordBreak: "break-all" }}>{val && val.startsWith && val.startsWith("http") ? <a href={val} target="_blank" rel="noopener noreferrer" style={{ color: c.blue }}>{val}</a> : (val || "—")}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!canEdit) return <div style={{ padding: 20, color: c.amber }}>View only — you don't have permission to set up tracking.</div>;

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        <div><label style={{ fontSize: 11, fontWeight: 600, color: c.muted, display: "block", marginBottom: 4 }}>Campaign Type</label><select style={{ border: `1px solid ${c.line}`, borderRadius: 7, padding: "9px 12px", fontSize: 13, width: "100%", outline: "none" }} value={campaignType} onChange={(e) => setCampaignType(e.target.value)}>{CAMPAIGN_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></div>
        <div></div>
        <div><label style={{ fontSize: 11, fontWeight: 600, color: c.muted, display: "block", marginBottom: 4 }}>Advertiser Data Sheet URL *</label><input style={{ border: `1px solid ${c.line}`, borderRadius: 7, padding: "9px 12px", fontSize: 13, width: "100%", outline: "none" }} value={advDataUrl} onChange={(e) => setAdvDataUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..." /></div>
        <div><label style={{ fontSize: 11, fontWeight: 600, color: c.muted, display: "block", marginBottom: 4 }}>Publisher Data Sheet URL *</label><input style={{ border: `1px solid ${c.line}`, borderRadius: 7, padding: "9px 12px", fontSize: 13, width: "100%", outline: "none" }} value={pubDataUrl} onChange={(e) => setPubDataUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..." /></div>
        <div><label style={{ fontSize: 11, fontWeight: 600, color: c.muted, display: "block", marginBottom: 4 }}>Segment (Publisher) *</label><select style={{ border: `1px solid ${c.line}`, borderRadius: 7, padding: "9px 12px", fontSize: 13, width: "100%", outline: "none" }} value={segmentPub} onChange={(e) => setSegmentPub(e.target.value)}><option value="">Select…</option>{segments.map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
        <div><label style={{ fontSize: 11, fontWeight: 600, color: c.muted, display: "block", marginBottom: 4 }}>Segment (Advertiser) *</label><input style={{ border: `1px solid ${c.line}`, borderRadius: 7, padding: "9px 12px", fontSize: 13, width: "100%", outline: "none" }} value={segmentAdv} onChange={(e) => setSegmentAdv(e.target.value)} placeholder="e.g. Partnership_Razorpay" /></div>
      </div>

      {/* Goals */}
      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 11, fontWeight: 600, color: c.muted, display: "block", marginBottom: 6 }}>GOALS</label>
        {goals.map((g, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 120px 80px 30px", gap: 8, marginBottom: 6 }}>
            <input style={{ border: `1px solid ${c.line}`, borderRadius: 6, padding: "7px 10px", fontSize: 12, outline: "none" }} value={g.name} onChange={(e) => { const u = [...goals]; u[i].name = e.target.value; setGoals(u); }} placeholder="e.g. CPL" />
            <select style={{ border: `1px solid ${c.line}`, borderRadius: 6, padding: "7px", fontSize: 12, outline: "none" }} value={g.period} onChange={(e) => { const u = [...goals]; u[i].period = e.target.value; setGoals(u); }}>{GOAL_PERIODS.map((p) => <option key={p} value={p}>{p}</option>)}</select>
            <input style={{ border: `1px solid ${c.line}`, borderRadius: 6, padding: "7px", fontSize: 12, outline: "none", textAlign: "right" }} type="number" value={g.value} onChange={(e) => { const u = [...goals]; u[i].value = e.target.value; setGoals(u); }} placeholder="0" />
            <button onClick={() => setGoals(goals.filter((_, idx) => idx !== i))} style={{ background: "#FEE2E2", color: c.red, border: "none", borderRadius: 5, cursor: "pointer", fontSize: 11 }}>✕</button>
          </div>
        ))}
        <button onClick={() => setGoals([...goals, { name: "", period: "daily", value: "" }])} style={{ background: "#E3F6EE", color: c.green, border: "none", borderRadius: 6, padding: "5px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>+ Add Goal</button>
      </div>

      {/* Metrics */}
      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 11, fontWeight: 600, color: c.muted, display: "block", marginBottom: 6 }}>METRICS</label>
        <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
          {Object.entries(INDUSTRY_PRESETS).map(([ind, metrics]) => (
            <button key={ind} onClick={() => setSelectedMetrics(metrics)} style={{ padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, border: `1px solid ${c.line}`, background: "#EAF0FF", color: c.blue, cursor: "pointer" }}>{ind}</button>
          ))}
        </div>
        {selectedMetrics.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
            {selectedMetrics.map((m) => <span key={m} style={{ padding: "3px 8px", borderRadius: 5, fontSize: 11, background: "#E3F6EE", color: c.green, fontWeight: 600 }}>{m} <span onClick={() => toggleMetric(m)} style={{ cursor: "pointer" }}>×</span></span>)}
          </div>
        )}
        {suggestedComputed.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {suggestedComputed.map((p) => { const sel = computedMetrics.find((x) => x.name === p.name); return (
              <label key={p.name} style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 5, fontSize: 11, background: sel ? "#E3F6EE" : "#F7F8FA", border: `1px solid ${sel ? c.green : c.line}`, cursor: "pointer" }}>
                <input type="checkbox" checked={!!sel} onChange={() => toggleComputed(p)} style={{ width: 12, height: 12 }} />{p.name} = {p.formula}
              </label>
            ); })}
          </div>
        )}
      </div>

      <div style={{ marginBottom: 14 }}><label style={{ fontSize: 11, fontWeight: 600, color: c.muted, display: "block", marginBottom: 4 }}>Additional Context</label><textarea style={{ border: `1px solid ${c.line}`, borderRadius: 7, padding: "9px 12px", fontSize: 13, width: "100%", minHeight: 60, outline: "none", resize: "vertical" }} value={additionalContext} onChange={(e) => setAdditionalContext(e.target.value)} placeholder="Notes..." /></div>

      <button onClick={handleSubmit} disabled={submitting} style={{ background: c.green, color: "#fff", border: "none", borderRadius: 8, padding: "10px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>{submitting ? "Submitting…" : "Submit Tracking & Complete ✓"}</button>
    </div>
  );
}

// ── Sync Tab ─────────────────────────────────────────────────────────────────
function SyncTab({ campaign, canEdit }) {
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [metrics, setMetrics] = useState(null);

  useEffect(() => { getCampaignMetrics(campaign.campaign_id).then(setMetrics).catch(() => {}); }, [campaign.campaign_id]);

  const handleSync = async () => {
    setSyncing(true); setSyncResult(null);
    try { const r = await syncCampaign(campaign.campaign_id); setSyncResult(r); getCampaignMetrics(campaign.campaign_id).then(setMetrics); }
    catch (e) { setSyncResult({ error: e.message }); }
    finally { setSyncing(false); }
  };

  if (!campaign.tracking_submitted) return <div style={{ padding: 20, color: c.muted }}>Submit tracking setup first to enable data sync.</div>;

  return (
    <div>
      <div style={{ background: "#E3F6EE", borderRadius: 10, padding: "14px", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: c.green }}>✅ Tracking active</div>
          {metrics && metrics.rows > 0 && <div style={{ fontSize: 12, color: c.sub, marginTop: 3 }}>{metrics.rows} data points · Last synced: {metrics.last_synced ? new Date(metrics.last_synced).toLocaleString("en-IN") : "—"}</div>}
          {metrics && metrics.rows === 0 && <div style={{ fontSize: 12, color: c.muted, marginTop: 3 }}>No data synced yet</div>}
        </div>
        {canEdit && <button onClick={handleSync} disabled={syncing} style={{ background: c.blue, color: "#fff", border: "none", borderRadius: 7, padding: "8px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>{syncing ? "Syncing…" : "⟳ Sync Now"}</button>}
      </div>
      {syncResult && <div style={{ fontSize: 12, color: syncResult.error ? c.red : c.green, marginBottom: 10 }}>{syncResult.error ? `Error: ${syncResult.error}` : `✓ Synced ${syncResult.rows} rows`}</div>}
      <div style={{ fontSize: 12, color: c.muted }}>Data is automatically synced every 6 hours via scheduled job.</div>
    </div>
  );
}

// ── Attribution Tab ──────────────────────────────────────────────────────────
function AttributionTab({ campaign }) {
  const [file, setFile] = useState(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);

  const hasDynamicCodes = (() => { try { return JSON.parse(campaign.promo_codes || '{}').type === 'dynamic'; } catch { return false; } })();
  if (!hasDynamicCodes) return <div style={{ padding: 20, color: c.muted }}>Revenue attribution is available for campaigns with Dynamic Codes. This campaign uses static codes or no codes.</div>;

  const handleRun = async () => {
    if (!file) return;
    setRunning(true); setResult(null);
    try { const r = await runAttribution(campaign.campaign_id, file, DRIVE_CODES_FOLDER); setResult(r); }
    catch (e) { alert("Failed: " + e.message); }
    finally { setRunning(false); }
  };

  return (
    <div>
      {!result ? (
        <>
          <div style={{ fontSize: 12, color: c.muted, marginBottom: 12 }}>Upload the redemption file to attribute revenue to publishers.</div>
          <div style={{ marginBottom: 12 }}><input type="file" accept=".csv,.xlsx,.xls" onChange={(e) => setFile(e.target.files?.[0] || null)} style={{ fontSize: 12 }} /></div>
          <button onClick={handleRun} disabled={running || !file} style={{ background: "#7C3AED", color: "#fff", border: "none", borderRadius: 8, padding: "10px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer", opacity: !file ? 0.5 : 1 }}>{running ? "Running…" : "Run Revenue Attribution"}</button>
        </>
      ) : (
        <>
          <div style={{ background: "#F0F4FF", borderRadius: 10, padding: "14px", marginBottom: 14, display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10, textAlign: "center" }}>
            <div><div style={{ fontSize: 10, color: c.muted, fontWeight: 700 }}>ORDERS</div><div style={{ fontSize: 18, fontWeight: 800 }}>{result.totals?.orders?.toLocaleString()}</div></div>
            <div><div style={{ fontSize: 10, color: c.muted, fontWeight: 700 }}>REVENUE</div><div style={{ fontSize: 18, fontWeight: 800 }}>₹{result.totals?.revenue?.toLocaleString()}</div></div>
            <div><div style={{ fontSize: 10, color: c.muted, fontWeight: 700 }}>ATTRIBUTED</div><div style={{ fontSize: 18, fontWeight: 800, color: c.green }}>{result.totals?.attribution_rate}%</div></div>
            <div><div style={{ fontSize: 10, color: c.muted, fontWeight: 700 }}>UNATTRIBUTED</div><div style={{ fontSize: 18, fontWeight: 800, color: c.red }}>{result.unattributed?.orders}</div></div>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead><tr style={{ borderBottom: `1px solid ${c.line}` }}><th style={{ textAlign: "left", padding: 8, fontSize: 10, color: c.muted }}>PUBLISHER</th><th style={{ textAlign: "left", padding: 8, fontSize: 10, color: c.muted }}>OFFER</th><th style={{ textAlign: "right", padding: 8, fontSize: 10, color: c.muted }}>ORDERS</th><th style={{ textAlign: "right", padding: 8, fontSize: 10, color: c.muted }}>REVENUE</th></tr></thead>
            <tbody>
              {(result.summary || []).map((r, i) => (<tr key={i} style={{ borderBottom: `1px solid #F1F5F9` }}><td style={{ padding: 8, fontWeight: 600 }}>{r.publisher}</td><td style={{ padding: 8, color: c.sub }}>{r.offer}</td><td style={{ padding: 8, textAlign: "right" }}>{r.orders.toLocaleString()}</td><td style={{ padding: 8, textAlign: "right", fontWeight: 700 }}>₹{r.revenue.toLocaleString()}</td></tr>))}
            </tbody>
          </table>
          <button onClick={() => setResult(null)} style={{ marginTop: 12, background: "#F1F5F9", color: c.sub, border: "none", borderRadius: 6, padding: "7px 12px", fontSize: 11, cursor: "pointer" }}>Run again</button>
        </>
      )}
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────
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
      if (liveCamps.length > 0 && !selected) setSelected(liveCamps[0].campaign_id);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  if (loading) return <div style={{ textAlign: "center", padding: 40, color: "#888" }}>Loading…</div>;

  const selectedCampaign = campaigns.find((c) => c.campaign_id === selected);

  return (
    <div style={{ display: "flex", height: "calc(100vh - 140px)", border: `1px solid ${c.line}`, borderRadius: 12, overflow: "hidden", background: "#fff" }}>
      <CampaignList campaigns={campaigns} selected={selected} onSelect={setSelected} />
      {selectedCampaign ? (
        <CampaignDetail campaign={selectedCampaign} segments={segments} canEdit={canEdit} onReload={load} />
      ) : (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: c.muted, fontSize: 14 }}>
          {campaigns.length === 0 ? "No live campaigns yet." : "Select a campaign from the list."}
        </div>
      )}
    </div>
  );
}
