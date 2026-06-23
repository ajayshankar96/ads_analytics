import React, { useState, useEffect } from "react";
import { getWorkflowCampaigns, getFilters, submitTrackingSetup, getSheetHeaders, syncCampaign, getCampaignMetrics, runAttribution, getSheetUrls, addSheetUrl, getSheetPreview, getColumnMappings, saveColumnMapping } from "../api";

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
        <h2 style={{ fontSize: 20, fontWeight: 800, color: c.ink }}>{campaign.advertiser_name} → {campaign.publisher_name}{campaign.offer_title ? ` · ${campaign.offer_title}` : ""}</h2>
        <div style={{ fontSize: 12, color: c.muted, marginTop: 2 }}>{campaign.campaign_id}</div>
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
const STANDARD_FIELDS = [
  { key: "date", label: "Date", required: true },
  { key: "impressions", label: "Impressions" },
  { key: "distribution", label: "Distribution" },
  { key: "clicks", label: "Clicks" },
  { key: "spends", label: "Spends" },
  { key: "orders", label: "Orders" },
  { key: "redirections", label: "Redirections" },
  { key: "revenue", label: "Revenue" },
  { key: "scratches", label: "Scratches" },
  { key: "cpm", label: "CPM" },
  { key: "cpc", label: "CPC" },
];

function ColumnMapper({ sheetUrl, name, type, onSaved }) {
  const [preview, setPreview] = useState(null);
  const [tabs, setTabs] = useState([]);
  const [selectedTab, setSelectedTab] = useState("");
  const [headerRow, setHeaderRow] = useState(1);
  const [mapping, setMapping] = useState({});
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [existingMapping, setExistingMapping] = useState(null);

  useEffect(() => {
    if (name && type) {
      getColumnMappings(name, type).then((d) => {
        if (d.mappings && d.mappings.length > 0) {
          setExistingMapping(d.mappings[0]);
          setMapping(d.mappings[0].mapping || {});
          setHeaderRow(d.mappings[0].header_row || 1);
          setSelectedTab(d.mappings[0].tab_name || "");
        }
      }).catch(() => {});
    }
  }, [name, type]);

  const handlePreview = async () => {
    if (!sheetUrl) return;
    setLoading(true);
    try {
      const d = await getSheetPreview(sheetUrl, selectedTab || undefined);
      setPreview(d.rows || []);
      setTabs(d.tabs || []);
      if (!selectedTab && d.selected_tab) setSelectedTab(d.selected_tab);
    } catch (e) { alert("Failed to read sheet: " + e.message); }
    finally { setLoading(false); }
  };

  const handleSave = async () => {
    try {
      await saveColumnMapping({ name, type, sheet_url: sheetUrl, tab_name: selectedTab, header_row: headerRow, data_start_row: headerRow + 1, mapping, format_type: "vertical" });
      setSaved(true);
      if (onSaved) onSaved();
      setTimeout(() => setSaved(false), 2000);
    } catch (e) { alert("Save failed: " + e.message); }
  };

  const headers = preview && preview[headerRow - 1] ? preview[headerRow - 1] : [];

  return (
    <div style={{ border: `1px solid ${c.line}`, borderRadius: 10, padding: "14px", marginTop: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: c.ink }}>Column Mapping — {name} ({type})</div>
        {existingMapping && <span style={{ fontSize: 11, color: c.green, fontWeight: 600 }}>✓ Mapping saved</span>}
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        {tabs.length > 0 && (
          <select style={{ border: `1px solid ${c.line}`, borderRadius: 6, padding: "6px 10px", fontSize: 12 }} value={selectedTab} onChange={(e) => setSelectedTab(e.target.value)}>
            {tabs.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
        <button onClick={handlePreview} disabled={loading} style={{ background: c.blue, color: "#fff", border: "none", borderRadius: 6, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
          {loading ? "Loading…" : preview ? "Refresh" : "Preview Sheet"}
        </button>
      </div>

      {preview && (
        <>
          {/* Show preview rows */}
          <div style={{ overflowX: "auto", marginBottom: 12 }}>
            <table style={{ fontSize: 11, borderCollapse: "collapse", minWidth: 600 }}>
              <tbody>
                {preview.slice(0, 5).map((row, i) => (
                  <tr key={i} style={{ background: i === headerRow - 1 ? "#EAF0FF" : "transparent" }}>
                    <td style={{ padding: "3px 6px", color: c.muted, fontSize: 10 }}>{i + 1}</td>
                    {(row || []).slice(0, 12).map((cell, j) => (
                      <td key={j} style={{ padding: "3px 6px", border: `1px solid ${c.line}`, maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ fontSize: 11, color: c.muted, marginBottom: 8 }}>
            Header row: <input type="number" min="1" max="10" value={headerRow} onChange={(e) => setHeaderRow(parseInt(e.target.value) || 1)} style={{ width: 40, border: `1px solid ${c.line}`, borderRadius: 4, padding: "2px 4px", fontSize: 11 }} /> (highlighted in blue above)
          </div>

          {/* Mapping dropdowns */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
            {STANDARD_FIELDS.map((field) => (
              <div key={field.key} style={{ fontSize: 12 }}>
                <label style={{ fontSize: 10, color: c.muted, fontWeight: 600, display: "block", marginBottom: 2 }}>
                  {field.label} {field.required && <span style={{ color: c.red }}>*</span>}
                </label>
                <select style={{ border: `1px solid ${c.line}`, borderRadius: 5, padding: "5px 8px", fontSize: 11, width: "100%" }}
                  value={mapping[field.key] || ""} onChange={(e) => setMapping({ ...mapping, [field.key]: e.target.value })}>
                  <option value="">— skip —</option>
                  {headers.map((h, i) => <option key={i} value={h}>{h}</option>)}
                </select>
              </div>
            ))}
          </div>

          <button onClick={handleSave} style={{ background: c.green, color: "#fff", border: "none", borderRadius: 6, padding: "7px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
            {saved ? "Saved ✓" : "Save Mapping"}
          </button>
        </>
      )}
    </div>
  );
}

// ── Visual Sheet Picker (for advertiser sheets with varied formats) ──────────
function VisualSheetPicker({ sheetUrl, name, onSaved }) {
  const [tabs, setTabs] = useState([]);
  const [selectedTab, setSelectedTab] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState("date"); // "date" or "value"
  const [dateCol, setDateCol] = useState(null);
  const [valueCol, setValueCol] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [open, setOpen] = useState(false);

  const loadSheet = async (tab) => {
    setLoading(true);
    try {
      const d = await getSheetPreview(sheetUrl, tab || undefined);
      setRows(d.rows || []);
      setTabs(d.tabs || []);
      if (!selectedTab && d.selected_tab) setSelectedTab(d.selected_tab);
    } catch (e) { alert("Failed to read sheet: " + e.message); }
    finally { setLoading(false); }
  };

  const handleTabChange = (t) => { setSelectedTab(t); loadSheet(t); };

  const handleCellClick = (colIdx) => {
    if (mode === "date") setDateCol(colIdx);
    else setValueCol(colIdx);
  };

  const handleSave = async () => {
    if (dateCol === null || valueCol === null) { alert("Please select both a Date column and a Value column"); return; }
    setSaving(true);
    try {
      // Derive header row and mapping from selections
      const codeRow = rows.findIndex((row, i) => i > 0 && row[valueCol] && row[valueCol].trim()) + 1;
      const dateHeaderName = rows[0] && rows[0][dateCol] ? rows[0][dateCol] : `col_${dateCol}`;
      const valueHeaderName = rows[codeRow - 1] && rows[codeRow - 1][valueCol] ? rows[codeRow - 1][valueCol] : `col_${valueCol}`;
      await saveColumnMapping({
        name, type: "advertiser", sheet_url: sheetUrl, tab_name: selectedTab,
        header_row: codeRow, data_start_row: codeRow + 1,
        mapping: { date: dateHeaderName, orders: valueHeaderName, date_col_index: dateCol, value_col_index: valueCol },
        format_type: "promo_pivot",
      });
      setSaved(true);
      if (onSaved) onSaved();
      setTimeout(() => setSaved(false), 2000);
    } catch (e) { alert("Save failed: " + e.message); }
    finally { setSaving(false); }
  };

  if (!open) {
    return (
      <button onClick={() => { setOpen(true); loadSheet(); }} style={{ background: c.blue, color: "#fff", border: "none", borderRadius: 7, padding: "8px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", marginTop: 8 }}>
        Configure Advertiser Sheet
      </button>
    );
  }

  const maxCols = Math.min(15, Math.max(...rows.map((r) => r.length), 0));
  const colLetters = Array.from({ length: maxCols }, (_, i) => String.fromCharCode(65 + i));

  return (
    <div style={{ border: `1px solid ${c.line}`, borderRadius: 12, padding: "16px", marginTop: 10, background: "#fff" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: c.ink }}>Configure Advertiser Sheet — {name}</div>
        <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: c.muted }}>✕</button>
      </div>

      {/* Tab selector */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
        {tabs.length > 0 && (
          <select style={{ border: `1px solid ${c.line}`, borderRadius: 6, padding: "6px 10px", fontSize: 12 }} value={selectedTab} onChange={(e) => handleTabChange(e.target.value)}>
            {tabs.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
        <button onClick={() => loadSheet(selectedTab)} disabled={loading} style={{ background: c.bg, border: `1px solid ${c.line}`, borderRadius: 6, padding: "6px 12px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {/* Mode toggle */}
      {rows.length > 0 && (
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <button onClick={() => setMode("date")} style={{ background: mode === "date" ? "#DBEAFE" : "#fff", border: `2px solid ${mode === "date" ? c.blue : c.line}`, borderRadius: 7, padding: "6px 14px", fontSize: 12, fontWeight: 700, color: mode === "date" ? c.blue : c.muted, cursor: "pointer" }}>
              Select Date Column {dateCol !== null && `(${colLetters[dateCol]})`}
            </button>
            <button onClick={() => setMode("value")} style={{ background: mode === "value" ? "#DCFCE7" : "#fff", border: `2px solid ${mode === "value" ? c.green : c.line}`, borderRadius: 7, padding: "6px 14px", fontSize: 12, fontWeight: 700, color: mode === "value" ? c.green : c.muted, cursor: "pointer" }}>
              Select Value Column {valueCol !== null && `(${colLetters[valueCol]})`}
            </button>
          </div>

          {/* Spreadsheet grid */}
          <div style={{ overflowX: "auto", border: `1px solid ${c.line}`, borderRadius: 8, marginBottom: 12 }}>
            <table style={{ borderCollapse: "collapse", fontSize: 11, minWidth: 600 }}>
              <thead>
                <tr>
                  <th style={{ padding: "5px 8px", background: "#F1F5F9", border: `1px solid ${c.line}`, fontSize: 10, color: c.muted }}>#</th>
                  {colLetters.map((letter, colIdx) => (
                    <th key={colIdx} onClick={() => handleCellClick(colIdx)}
                      style={{ padding: "5px 8px", background: colIdx === dateCol ? "#DBEAFE" : colIdx === valueCol ? "#DCFCE7" : "#F1F5F9", border: `1px solid ${c.line}`, fontSize: 10, fontWeight: 700, color: colIdx === dateCol ? c.blue : colIdx === valueCol ? c.green : c.muted, cursor: "pointer", minWidth: 60 }}>
                      {letter}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, rowIdx) => (
                  <tr key={rowIdx}>
                    <td style={{ padding: "4px 8px", background: "#F9FAFB", border: `1px solid ${c.line}`, fontSize: 10, color: c.muted, fontWeight: 600 }}>{rowIdx + 1}</td>
                    {colLetters.map((_, colIdx) => {
                      const cellVal = row[colIdx] || "";
                      const isDateCol = colIdx === dateCol;
                      const isValueCol = colIdx === valueCol;
                      return (
                        <td key={colIdx} onClick={() => handleCellClick(colIdx)}
                          style={{ padding: "4px 8px", border: `1px solid ${c.line}`, maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "pointer", background: isDateCol ? "#EFF6FF" : isValueCol ? "#F0FDF4" : "transparent", fontWeight: (isDateCol || isValueCol) ? 600 : 400, color: isDateCol ? c.blue : isValueCol ? c.green : c.ink }}>
                          {String(cellVal).substring(0, 15)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Summary */}
          <div style={{ fontSize: 12, color: c.muted, marginBottom: 12, display: "flex", gap: 16 }}>
            <span>Date: <strong style={{ color: dateCol !== null ? c.blue : c.muted }}>{dateCol !== null ? `Column ${colLetters[dateCol]}` : "not selected"}</strong></span>
            <span>Value: <strong style={{ color: valueCol !== null ? c.green : c.muted }}>{valueCol !== null ? `Column ${colLetters[valueCol]}${rows[2] && rows[2][valueCol] ? ` (${rows[2][valueCol]})` : ""}` : "not selected"}</strong></span>
          </div>

          {/* Save */}
          <button onClick={handleSave} disabled={saving || dateCol === null || valueCol === null} style={{ background: (dateCol !== null && valueCol !== null) ? c.green : c.line, color: (dateCol !== null && valueCol !== null) ? "#fff" : c.muted, border: "none", borderRadius: 7, padding: "8px 16px", fontSize: 12, fontWeight: 700, cursor: (dateCol !== null && valueCol !== null) ? "pointer" : "not-allowed" }}>
            {saving ? "Saving…" : saved ? "Saved ✓" : "Save Configuration"}
          </button>
        </>
      )}
    </div>
  );
}

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
  const [advUrls, setAdvUrls] = useState([]);
  const [pubUrls, setPubUrls] = useState([]);
  const [pubMappingExists, setPubMappingExists] = useState(true);
  const [advMappingExists, setAdvMappingExists] = useState(true);

  // Auto-populate URLs from sheet_urls table + check mappings
  useEffect(() => {
    if (!campaign.advertiser_data_url && campaign.advertiser_name) {
      getSheetUrls("advertiser", campaign.advertiser_name).then((d) => {
        const urls = d.urls || [];
        setAdvUrls(urls);
        if (urls.length === 1) setAdvDataUrl(urls[0].url);
      }).catch(() => {});
    }
    if (!campaign.publisher_data_url && campaign.publisher_name) {
      getSheetUrls("publisher", campaign.publisher_name).then((d) => {
        const urls = d.urls || [];
        setPubUrls(urls);
        if (urls.length === 1) setPubDataUrl(urls[0].url);
      }).catch(() => {});
    }
    // Check if mappings or known URLs exist (either means no mapper needed)
    if (campaign.publisher_name) {
      Promise.all([
        getColumnMappings(campaign.publisher_name, "publisher"),
        getSheetUrls("publisher", campaign.publisher_name),
      ]).then(([mRes, uRes]) => {
        const hasMappingOrUrl = (mRes.mappings && mRes.mappings.length > 0) || (uRes.urls && uRes.urls.length > 0);
        setPubMappingExists(hasMappingOrUrl);
      }).catch(() => {});
    }
    if (campaign.advertiser_name) {
      Promise.all([
        getColumnMappings(campaign.advertiser_name, "advertiser"),
        getSheetUrls("advertiser", campaign.advertiser_name),
      ]).then(([mRes, uRes]) => {
        const hasMappingOrUrl = (mRes.mappings && mRes.mappings.length > 0) || (uRes.urls && uRes.urls.length > 0);
        setAdvMappingExists(hasMappingOrUrl);
      }).catch(() => {});
    }
  }, [campaign.campaign_id]);

  const handleSubmit = async () => {
    if (!pubDataUrl.trim()) { alert("Publisher Data Sheet URL is required"); return; }
    setSubmitting(true);
    try { await submitTrackingSetup(campaign.campaign_id, { campaign_type: "Single Campaign Sheet", advertiser_data_url: advDataUrl, publisher_data_url: pubDataUrl, segment_pub: segmentPub, segment_adv: segmentAdv, goals_json: "{}", metrics_json: "{}", additional_context: "" }); onReload(); }
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
          {[["Advertiser Data URL", campaign.advertiser_data_url], ["Publisher Data URL", campaign.publisher_data_url], ["Segment (Publisher)", campaign.segment_pub], ["Segment (Advertiser)", campaign.segment_adv]].map(([label, val]) => (
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
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: c.muted, display: "block", marginBottom: 4 }}>Advertiser Data Sheet URL</label>
          {advUrls.length > 1 ? (
            <select style={{ border: `1px solid ${c.line}`, borderRadius: 7, padding: "9px 12px", fontSize: 13, width: "100%", outline: "none" }} value={advDataUrl} onChange={(e) => setAdvDataUrl(e.target.value)}>
              <option value="">Select URL...</option>
              {advUrls.map((u, i) => <option key={i} value={u.url}>{u.url.substring(0, 60)}...</option>)}
            </select>
          ) : (
            <input style={{ border: `1px solid ${c.line}`, borderRadius: 7, padding: "9px 12px", fontSize: 13, width: "100%", outline: "none" }} value={advDataUrl} onChange={(e) => setAdvDataUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..." />
          )}
          {advDataUrl && <a href={advDataUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: c.blue, marginTop: 3, display: "inline-block" }}>Open sheet ↗</a>}
        </div>
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: c.muted, display: "block", marginBottom: 4 }}>Publisher Data Sheet URL</label>
          {pubUrls.length > 1 ? (
            <select style={{ border: `1px solid ${c.line}`, borderRadius: 7, padding: "9px 12px", fontSize: 13, width: "100%", outline: "none" }} value={pubDataUrl} onChange={(e) => setPubDataUrl(e.target.value)}>
              <option value="">Select URL...</option>
              {pubUrls.map((u, i) => <option key={i} value={u.url}>{u.url.substring(0, 60)}...</option>)}
            </select>
          ) : (
            <input style={{ border: `1px solid ${c.line}`, borderRadius: 7, padding: "9px 12px", fontSize: 13, width: "100%", outline: "none" }} value={pubDataUrl} onChange={(e) => setPubDataUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..." />
          )}
          {pubDataUrl && <a href={pubDataUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: c.blue, marginTop: 3, display: "inline-block" }}>Open sheet ↗</a>}
        </div>
        <div><label style={{ fontSize: 11, fontWeight: 600, color: c.muted, display: "block", marginBottom: 4 }}>Segment (Publisher) *</label><select style={{ border: `1px solid ${c.line}`, borderRadius: 7, padding: "9px 12px", fontSize: 13, width: "100%", outline: "none" }} value={segmentPub} onChange={(e) => setSegmentPub(e.target.value)}><option value="">Select…</option>{segments.map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
        <div><label style={{ fontSize: 11, fontWeight: 600, color: c.muted, display: "block", marginBottom: 4 }}>Segment (Advertiser) *</label><input style={{ border: `1px solid ${c.line}`, borderRadius: 7, padding: "9px 12px", fontSize: 13, width: "100%", outline: "none" }} value={segmentAdv} onChange={(e) => setSegmentAdv(e.target.value)} placeholder="e.g. Partnership_Razorpay" /></div>
      </div>

      {/* Publisher: auto-detected, no mapper needed. Advertiser: visual picker */}
      {advDataUrl && !advMappingExists && <VisualSheetPicker sheetUrl={advDataUrl} name={campaign.advertiser_name} onSaved={() => setAdvMappingExists(true)} />}


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
