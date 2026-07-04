import React, { useState, useEffect } from "react";
import { getWorkflowCampaigns, getFilters, submitTrackingSetup, syncCampaign, getCampaignMetrics, runAttribution, getSheetUrls, getSheetPreview, getColumnMappings, saveColumnMapping, previewColumnMapping, getBillingConfig, addBillingConfig, recomputeMetrics } from "../api";

const c = { blue: "#2E5BFF", ink: "#0F1724", sub: "#52606D", line: "#E6EAF0", muted: "#768EA7", green: "#0F8C6A", red: "#C8321E", amber: "#B7791F", bg: "#F7F8FA" };

const PUBLISHER_METRICS = [
  { key: "impressions", label: "Impressions", default: true },
  { key: "clicks", label: "Clicks", default: true },
  { key: "spends", label: "Spends" },
  { key: "distribution", label: "Distribution" },
  { key: "scratches", label: "Scratches" },
  { key: "redirections", label: "Redirections" },
];
const ADVERTISER_METRICS = [
  { key: "spends", label: "Spends" },
  { key: "sessions", label: "Sessions" },
  { key: "orders", label: "Orders" },
  { key: "revenue", label: "Revenue" },
  { key: "leads", label: "Leads" },
  { key: "ipa", label: "In Principal Approval" },
];
const METRIC_COLORS = ["#0F8C6A", "#7C3AED", "#B7791F", "#0891B2", "#C8321E"];
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
  const tabs = [
    { id: "setup", label: "Setup" },
    { id: "sync", label: "Data Sync" },
    { id: "billing", label: "Billing" },
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
      {activeTab === "billing" && <BillingTab campaign={campaign} canEdit={canEdit} />}
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

// ── Tab month detection (mirrors backend etl_worker._parse_tab_month) ─────────
// Full month names first so "june" wins over "jun". The trailing (?![a-z])
// guard stops brand substrings ("Maya"→may, "Decathlon"→dec). The leading
// (?<![a-z]) boundary is emulated manually below (Babel won't transpile regex
// lookbehind, so it would break older Safari at runtime).
const MONTH_NAMES_RE_SRC =
  "(january|february|march|april|may|june|july|august|september|october|november|december|" +
  "jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)(?![a-z])";
const NUM_MONTH_YEAR_RE = /\b(0?[1-9]|1[0-2])[/\-.](20\d{2})\b/;
const NUM_YEAR_MONTH_RE = /\b(20\d{2})[/\-.](0?[1-9]|1[0-2])\b/;

function findMonthToken(tabName) {
  if (!tabName) return null;
  const re = new RegExp(MONTH_NAMES_RE_SRC, "gi");
  let m;
  while ((m = re.exec(tabName)) !== null) {
    const before = m.index > 0 ? tabName[m.index - 1] : "";
    if (!/[a-z]/i.test(before)) return m; // emulate (?<![a-z])
    if (m.index === re.lastIndex) re.lastIndex++; // guard against zero-length loops
  }
  return null;
}

function tabHasMonth(tabName) {
  if (!tabName) return false;
  if (findMonthToken(tabName)) return true;
  return NUM_MONTH_YEAR_RE.test(tabName) || NUM_YEAR_MONTH_RE.test(tabName);
}

// Strip the month token (plus any adjacent year/separators) from a monthly tab
// name to propose a stable rolling-match pattern. The pattern is used as a
// case-insensitive substring on the backend, so "RZP_Ctrl8 June" → "RZP_Ctrl8"
// matches both the June and July tabs.
function proposeTabPattern(tabName) {
  if (!tabName) return { pattern: "", hasMonth: false };
  let stripped = null;
  const m = findMonthToken(tabName);
  if (m) {
    const end = m.index + m[0].length;
    const tailYear = tabName.slice(end).match(/^[\s\-_.']*((?:20)?\d{2})\b/);
    const realEnd = tailYear ? end + tailYear[0].length : end;
    stripped = tabName.slice(0, m.index) + tabName.slice(realEnd);
  } else {
    const num = tabName.match(NUM_MONTH_YEAR_RE) || tabName.match(NUM_YEAR_MONTH_RE);
    if (num) stripped = tabName.slice(0, num.index) + tabName.slice(num.index + num[0].length);
  }
  if (stripped === null) return { pattern: tabName, hasMonth: false };
  const pattern = stripped.replace(/^[\s\-_.']+|[\s\-_.']+$/g, "").trim();
  return { pattern, hasMonth: true };
}

// ── Visual Sheet Picker (works for both publisher and advertiser) ─────────────
function VisualSheetPicker({ sheetUrl, name, campaignId, metrics = [], onSaved, pickerType = "advertiser" }) {
  const isPub = pickerType === "publisher";
  const [tabs, setTabs] = useState([]);
  const [selectedTab, setSelectedTab] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState("date");
  const [dateCell, setDateCell] = useState(null);
  const [metricCells, setMetricCells] = useState({});
  const [segCell, setSegCell] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [open, setOpen] = useState(false);
  const [existingConfig, setExistingConfig] = useState(null);
  const [matchMode, setMatchMode] = useState("exact");
  const [tabPattern, setTabPattern] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    if (name) {
      setExistingConfig(null);
      setSelectedTab("");
      setRows([]);
      setTabs([]);
      setDateCell(null);
      setMetricCells({});
      setSegCell(null);
      setMatchMode("exact");
      setTabPattern("");
      getColumnMappings(name, pickerType, sheetUrl, campaignId).then((d) => {
        if (d.mappings && d.mappings.length > 0) {
          const m = d.mappings[0];
          setExistingConfig(m);
          setSelectedTab(m.tab_name || "");
          setMatchMode(m.tab_match_mode || "exact");
          setTabPattern(m.tab_pattern || "");
          const mapping = m.mapping || {};
          if (mapping.date_col_index != null) {
            const startRow = mapping.date_start_row || mapping.data_start_row || 1;
            setDateCell({ row: startRow - 1, col: mapping.date_col_index });
          }
          if (isPub && mapping.segment_col_index != null) {
            setSegCell({ col: mapping.segment_col_index });
          }
          if (mapping.metrics) {
            const restored = {};
            Object.entries(mapping.metrics).forEach(([key, val]) => {
              if (val && val.col != null) {
                const r = val.start_row || mapping.data_start_row || 1;
                restored[key] = { row: r - 1, col: val.col };
              }
            });
            setMetricCells(restored);
          }
        }
      }).catch(() => {});
    }
  }, [name, pickerType, sheetUrl, campaignId, isPub]);

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

  const handleTabChange = (t) => {
    setSelectedTab(t);
    const { pattern, hasMonth } = proposeTabPattern(t);
    if (hasMonth) { setMatchMode("rolling"); setTabPattern(pattern); }
    else { setMatchMode("exact"); setTabPattern(""); }
    loadSheet(t);
  };

  const handleCellClick = (rowIdx, colIdx) => {
    if (mode === "date") setDateCell({ row: rowIdx, col: colIdx });
    else if (mode === "segment") setSegCell({ col: colIdx });
    else setMetricCells((prev) => ({ ...prev, [mode]: { row: rowIdx, col: colIdx } }));
  };

  // Build the visual mapping exactly the same way for both save and preview so
  // the dry-run can never disagree with what a real sync would ingest.
  const buildMapping = () => {
    const metricsMapping = {};
    Object.keys(metricCells).forEach((key) => {
      const cell = metricCells[key];
      const cellContent = rows[cell.row] && rows[cell.row][cell.col] ? rows[cell.row][cell.col].trim() : `col_${cell.col}`;
      metricsMapping[key] = isPub
        ? { col: cell.col, header: cellContent }
        : { col: cell.col, start_row: cell.row + 1, header: cellContent };
    });
    return isPub
      ? { date_col_index: dateCell.col, data_start_row: dateCell.row + 1, segment_col_index: segCell ? segCell.col : null, metrics: metricsMapping }
      : { date_col_index: dateCell.col, date_start_row: dateCell.row + 1, metrics: metricsMapping };
  };

  const handlePreview = async () => {
    if (!dateCell) { alert("Select where dates start first"); return; }
    if (matchMode === "rolling" && !tabPattern.trim()) {
      alert("Enter a tab pattern for auto-detect, or switch to exact match.");
      return;
    }
    setPreviewing(true);
    setPreview(null);
    try {
      const r = await previewColumnMapping({
        name, type: pickerType, campaign_id: campaignId, sheet_url: sheetUrl, tab_name: selectedTab || "",
        mapping: buildMapping(),
        format_type: "visual",
        tab_pattern: matchMode === "rolling" ? tabPattern.trim() : null,
        tab_match_mode: matchMode,
      });
      setPreview(r);
    } catch (e) { alert("Preview failed: " + e.message); }
    finally { setPreviewing(false); }
  };

  const handleSave = async () => {
    if (!dateCell) { alert("Please select where dates start"); return; }
    const mappedMetrics = Object.keys(metricCells);
    if (mappedMetrics.length === 0) { alert("Please select at least one metric column"); return; }
    if (matchMode === "rolling" && !tabPattern.trim()) {
      alert("Enter a tab pattern for auto-detect, or switch to exact match.");
      return;
    }
    setSaving(true);
    try {
      await saveColumnMapping({
        name, type: pickerType, campaign_id: campaignId, sheet_url: sheetUrl, tab_name: selectedTab || "",
        header_row: dateCell.row + 1,
        data_start_row: dateCell.row + 1,
        mapping: buildMapping(),
        format_type: "visual",
        tab_pattern: matchMode === "rolling" ? tabPattern.trim() : null,
        tab_match_mode: matchMode,
      });
      setSaved(true);
      if (onSaved) onSaved();
      setTimeout(() => setSaved(false), 2000);
    } catch (e) { alert("Save failed: " + e.message); }
    finally { setSaving(false); }
  };

  const label = isPub ? "Publisher" : "Advertiser";
  const accentColor = isPub ? c.blue : c.blue;

  if (!open) {
    return (
      <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 10 }}>
        <button onClick={() => { setOpen(true); if (!rows.length) loadSheet(selectedTab || undefined); }} style={{ background: accentColor, color: "#fff", border: "none", borderRadius: 7, padding: "8px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
          {existingConfig ? `Edit ${label} Sheet Config` : `Configure ${label} Sheet`}
        </button>
        {existingConfig && <span style={{ fontSize: 11, color: c.green, fontWeight: 600 }}>✓ Configured — {Object.keys(existingConfig.mapping?.metrics || {}).length || 1} metric(s) mapped</span>}
      </div>
    );
  }

  const maxCols = rows.length > 0 ? Math.max(...rows.map((r) => r.length)) : 0;
  const colLetters = Array.from({ length: maxCols }, (_, i) => { let s = "", n = i; do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0); return s; });
  const allModes = [{ key: "date", label: "Date", color: c.blue }]
    .concat(isPub ? [{ key: "segment", label: "Segment (optional)", color: c.amber }] : [])
    .concat(metrics.map((m, i) => ({ key: m.key, label: m.label, color: METRIC_COLORS[i % METRIC_COLORS.length] })));

  const getMetricColor = (key) => {
    const idx = metrics.findIndex((m) => m.key === key);
    return idx >= 0 ? METRIC_COLORS[idx % METRIC_COLORS.length] : c.green;
  };
  const hasAllSelections = dateCell && metrics.length > 0 && metrics.every((m) => metricCells[m.key]);

  return (
    <div style={{ border: `1px solid ${c.line}`, borderRadius: 12, padding: "16px", marginTop: 10, background: "#fff" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: c.ink }}>Configure {label} Sheet — {name}</div>
        <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: c.muted }}>✕</button>
      </div>

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

      {tabs.length > 0 && (
        <div style={{ border: `1px solid ${matchMode === "rolling" ? c.green : c.line}`, borderRadius: 8, padding: "10px 12px", marginBottom: 12, background: matchMode === "rolling" ? "#F0FDF4" : c.bg }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 700, color: c.ink, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={matchMode === "rolling"}
              onChange={(e) => {
                if (e.target.checked) {
                  const { pattern } = proposeTabPattern(selectedTab);
                  setMatchMode("rolling");
                  if (!tabPattern.trim()) setTabPattern(pattern);
                } else {
                  setMatchMode("exact");
                }
              }}
            />
            Auto-detect new monthly tabs (rolling match)
          </label>
          {matchMode === "rolling" ? (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 11, color: c.sub, marginBottom: 5 }}>
                Reads every tab that contains this text <em>and</em> a month name (e.g. “June”, “Jul’26”). Future months are picked up automatically each sync — no re-config needed.
              </div>
              <input
                value={tabPattern}
                onChange={(e) => setTabPattern(e.target.value)}
                placeholder="e.g. RZP_Ctrl8"
                style={{ width: "100%", maxWidth: 320, border: `1px solid ${c.line}`, borderRadius: 6, padding: "6px 10px", fontSize: 12, boxSizing: "border-box" }}
              />
              {(() => {
                const p = tabPattern.trim().toLowerCase();
                const matched = tabs.filter((t) => (!p || t.toLowerCase().includes(p)) && tabHasMonth(t));
                return (
                  <div style={{ fontSize: 11, color: matched.length ? c.green : c.red, marginTop: 6 }}>
                    {!p
                      ? "Enter a pattern to preview matches."
                      : matched.length
                        ? `Matches ${matched.length} existing tab(s): ${matched.slice(0, 6).join(", ")}${matched.length > 6 ? " …" : ""}`
                        : "No existing tabs match — check the pattern."}
                  </div>
                );
              })()}
            </div>
          ) : (
            <div style={{ fontSize: 11, color: c.muted, marginTop: 6 }}>
              Reads only the selected tab “{selectedTab || "—"}”. Enable rolling match for sheets that add a new tab each month.
            </div>
          )}
        </div>
      )}

      {rows.length > 0 && (
        <>
          <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
            {allModes.map((m) => {
              const active = mode === m.key;
              const selected = m.key === "date" ? dateCell : m.key === "segment" ? segCell : metricCells[m.key];
              return (
                <button key={m.key} onClick={() => setMode(m.key)} style={{ background: active ? `${m.color}15` : "#fff", border: `2px solid ${active ? m.color : c.line}`, borderRadius: 7, padding: "5px 12px", fontSize: 11, fontWeight: 700, color: active ? m.color : c.muted, cursor: "pointer" }}>
                  {m.label} {selected ? "✓" : ""}
                </button>
              );
            })}
          </div>
          <div style={{ fontSize: 11, color: c.muted, marginBottom: 10 }}>
            {mode === "date" ? "Click the first cell that has a date" : mode === "segment" ? "Click any cell in the Segment column (optional)" : `Click the cell where "${metrics.find((m) => m.key === mode)?.label || mode}" data starts`}
          </div>

          <div style={{ overflowX: "auto", border: `1px solid ${c.line}`, borderRadius: 8, marginBottom: 12, maxHeight: 400, overflowY: "auto" }}>
            <table style={{ borderCollapse: "collapse", fontSize: 11, minWidth: 600 }}>
              <thead>
                <tr>
                  <th style={{ padding: "5px 8px", background: "#F1F5F9", border: `1px solid ${c.line}`, fontSize: 10, color: c.muted, position: "sticky", top: 0, zIndex: 1 }}>#</th>
                  {colLetters.map((letter, colIdx) => (
                    <th key={colIdx} style={{ padding: "5px 8px", background: "#F1F5F9", border: `1px solid ${c.line}`, fontSize: 10, fontWeight: 700, color: c.muted, minWidth: 60, position: "sticky", top: 0, zIndex: 1 }}>{letter}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, rowIdx) => (
                  <tr key={rowIdx}>
                    <td style={{ padding: "4px 8px", background: "#F9FAFB", border: `1px solid ${c.line}`, fontSize: 10, color: c.muted, fontWeight: 600 }}>{rowIdx + 1}</td>
                    {colLetters.map((_, colIdx) => {
                      const cellVal = row[colIdx] || "";
                      const isDateSel = dateCell && dateCell.row === rowIdx && dateCell.col === colIdx;
                      const isDateCol = dateCell && dateCell.col === colIdx && rowIdx >= dateCell.row;
                      const isSegCol = segCell && segCell.col === colIdx;
                      let metricMatch = null;
                      let metricColMatch = null;
                      for (const [mk, mc] of Object.entries(metricCells)) {
                        if (mc.row === rowIdx && mc.col === colIdx) { metricMatch = mk; break; }
                        if (mc.col === colIdx && rowIdx >= (dateCell ? dateCell.row : 0)) metricColMatch = mk;
                      }
                      let bg = "transparent";
                      let fontW = 400;
                      let color = c.ink;
                      if (isDateSel) { bg = "#BFDBFE"; fontW = 700; color = c.blue; }
                      else if (metricMatch) { bg = `${getMetricColor(metricMatch)}20`; fontW = 700; color = getMetricColor(metricMatch); }
                      else if (isSegCol) { bg = "#FEF3E2"; }
                      else if (isDateCol) { bg = "#EFF6FF"; }
                      else if (metricColMatch) { bg = `${getMetricColor(metricColMatch)}08`; }
                      return (
                        <td key={colIdx} onClick={() => handleCellClick(rowIdx, colIdx)}
                          style={{ padding: "4px 8px", border: `1px solid ${c.line}`, maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "pointer", background: bg, fontWeight: fontW, color, transition: "background 0.1s" }}>
                          {String(cellVal).substring(0, 15)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ fontSize: 12, color: c.muted, marginBottom: 12, display: "flex", gap: 12, flexWrap: "wrap" }}>
            <span>Date: <strong style={{ color: dateCell ? c.blue : c.muted }}>{dateCell ? `${colLetters[dateCell.col]}${dateCell.row + 1}` : "—"}</strong></span>
            {isPub && segCell && <span>Segment: <strong style={{ color: c.amber }}>Col {colLetters[segCell.col]}</strong></span>}
            {metrics.map((m, i) => {
              const cell = metricCells[m.key];
              const col = METRIC_COLORS[i % METRIC_COLORS.length];
              return <span key={m.key}>{m.label}: <strong style={{ color: cell ? col : c.muted }}>{cell ? `${colLetters[cell.col]}${cell.row + 1}` : "—"}</strong></span>;
            })}
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button onClick={handleSave} disabled={saving || !hasAllSelections} style={{ background: hasAllSelections ? c.green : c.line, color: hasAllSelections ? "#fff" : c.muted, border: "none", borderRadius: 7, padding: "8px 16px", fontSize: 12, fontWeight: 700, cursor: hasAllSelections ? "pointer" : "not-allowed" }}>
              {saving ? "Saving…" : saved ? "Saved ✓" : "Save Configuration"}
            </button>
            <button onClick={handlePreview} disabled={previewing || !dateCell} title="Read-only dry run — checks which tabs/months this config will pull and whether data is filled, without writing anything" style={{ background: "#fff", color: dateCell ? c.blue : c.muted, border: `1px solid ${dateCell ? c.blue : c.line}`, borderRadius: 7, padding: "8px 16px", fontSize: 12, fontWeight: 700, cursor: dateCell ? "pointer" : "not-allowed" }}>
              {previewing ? "Checking…" : "Preview / Dry-run"}
            </button>
          </div>

          {preview && <PreviewResults preview={preview} />}
        </>
      )}
    </div>
  );
}

// ── Dry-run results: which tabs/months this config will ingest, and whether the
//    advertiser/publisher has actually filled them yet. "Awaiting data" is an
//    expected state, not an error — we don't own the sheet; the next sync picks
//    it up automatically once the counterparty fills it.
const PREVIEW_STATUS = {
  ready: { color: c.green, bg: "#E3F6EE", label: "Ready" },
  awaiting_data: { color: c.amber, bg: "#FEF3E2", label: "Awaiting data" },
  check_config: { color: c.red, bg: "#FDE7E2", label: "Check config" },
};

function PreviewResults({ preview }) {
  const matched = preview.matched || [];
  const skipped = preview.skipped || [];
  const readyCount = matched.filter((t) => t.status === "ready").length;
  const awaiting = matched.filter((t) => t.status === "awaiting_data").length;
  const issues = matched.filter((t) => t.status === "check_config").length;

  return (
    <div style={{ marginTop: 14, border: `1px solid ${c.line}`, borderRadius: 10, overflow: "hidden" }}>
      <div style={{ padding: "10px 12px", background: c.bg, borderBottom: `1px solid ${c.line}`, fontSize: 12, color: c.ink, fontWeight: 700, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <span>Dry-run — {preview.match_mode === "rolling" ? `rolling “${preview.pattern}”` : `exact “${preview.tab_name || "—"}”`}</span>
        <span style={{ fontWeight: 600, color: c.muted }}>
          {matched.length} tab(s) matched · {readyCount} ready · {awaiting} awaiting · {issues} to check
        </span>
      </div>

      {preview.error && (
        <div style={{ padding: "10px 12px", fontSize: 12, color: c.red, background: "#FDE7E2" }}>{preview.error}</div>
      )}
      {preview.converted_office_file && (
        <div style={{ padding: "6px 12px", fontSize: 11, color: c.muted }}>Note: this is an uploaded Excel file — read via a temporary conversion (same as sync).</div>
      )}

      {matched.length > 0 && (
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 11 }}>
          <thead>
            <tr style={{ background: "#F1F5F9", color: c.muted }}>
              {["Tab", "Month", "Status", "Dated rows", "Rows w/ data", "Date range", "Note"].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: "6px 10px", fontWeight: 700, borderBottom: `1px solid ${c.line}` }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matched.map((t) => {
              const s = PREVIEW_STATUS[t.status] || PREVIEW_STATUS.check_config;
              return (
                <tr key={t.tab} style={{ borderBottom: `1px solid #F1F5F9` }}>
                  <td style={{ padding: "6px 10px", fontWeight: 600, color: c.ink }}>{t.tab}</td>
                  <td style={{ padding: "6px 10px", color: c.sub }}>{t.month || "—"}</td>
                  <td style={{ padding: "6px 10px" }}>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10, background: s.bg, color: s.color }}>{s.label}</span>
                  </td>
                  <td style={{ padding: "6px 10px", color: c.sub }}>{t.dated_rows}</td>
                  <td style={{ padding: "6px 10px", color: c.sub }}>{t.rows_with_data}</td>
                  <td style={{ padding: "6px 10px", color: c.sub }}>{t.date_min ? `${t.date_min} → ${t.date_max}` : "—"}</td>
                  <td style={{ padding: "6px 10px", color: c.muted }}>{t.note}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {matched.length === 0 && !preview.error && (
        <div style={{ padding: "10px 12px", fontSize: 12, color: c.amber }}>No tabs match this configuration yet.</div>
      )}

      {skipped.length > 0 && (
        <div style={{ padding: "8px 12px", fontSize: 11, color: c.muted, borderTop: `1px solid ${c.line}` }}>
          Skipped {skipped.length} tab(s) matching the pattern but with no month token: {skipped.slice(0, 6).map((s) => s.tab).join(", ")}{skipped.length > 6 ? " …" : ""}
        </div>
      )}
      {awaiting > 0 && issues === 0 && (
        <div style={{ padding: "8px 12px", fontSize: 11, color: c.sub, borderTop: `1px solid ${c.line}`, background: "#FFFBEB" }}>
          “Awaiting data” tabs are configured correctly — they’ll be captured automatically on the next sync once the advertiser/publisher fills them.
        </div>
      )}
    </div>
  );
}

function parseTrackingMetrics(raw) {
  try { return JSON.parse(raw || "{}"); } catch { return {}; }
}

function SetupTab({ campaign, segments, canEdit, onReload }) {
  const initialMetrics = parseTrackingMetrics(campaign.metrics_json);
  const [advDataUrl, setAdvDataUrl] = useState(campaign.advertiser_data_url || "");
  const [pubDataUrl, setPubDataUrl] = useState(campaign.publisher_data_url || "");
  const [segmentPub, setSegmentPub] = useState(campaign.segment_pub || "");
  const [segmentAdv, setSegmentAdv] = useState(campaign.segment_adv || "");
  const [pubMetrics, setPubMetrics] = useState(initialMetrics.publisher_metrics || PUBLISHER_METRICS.filter((m) => m.default).map((m) => m.key));
  const [advMetrics, setAdvMetrics] = useState(initialMetrics.advertiser_metrics || []);
  const [submitting, setSubmitting] = useState(false);
  const [advUrls, setAdvUrls] = useState([]);
  const [pubUrls, setPubUrls] = useState([]);
  const [isEditingSubmitted, setIsEditingSubmitted] = useState(false);

  useEffect(() => {
    const metrics = parseTrackingMetrics(campaign.metrics_json);
    setAdvDataUrl(campaign.advertiser_data_url || "");
    setPubDataUrl(campaign.publisher_data_url || "");
    setSegmentPub(campaign.segment_pub || "");
    setSegmentAdv(campaign.segment_adv || "");
    setPubMetrics(metrics.publisher_metrics || PUBLISHER_METRICS.filter((m) => m.default).map((m) => m.key));
    setAdvMetrics(metrics.advertiser_metrics || []);
    setIsEditingSubmitted(false);
  }, [
    campaign.campaign_id,
    campaign.advertiser_data_url,
    campaign.publisher_data_url,
    campaign.segment_pub,
    campaign.segment_adv,
    campaign.metrics_json,
  ]);

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
  }, [campaign.campaign_id]);

  const handleSubmit = async () => {
    if (!pubDataUrl.trim()) { alert("Publisher Data Sheet URL is required"); return; }
    if (advMetrics.length === 0) { alert("Select at least one advertiser metric"); return; }
    if (!segmentPub.trim()) { alert("Segment (Publisher) is required"); return; }
    if (!segmentAdv.trim()) { alert("Segment (Advertiser) is required"); return; }
    setSubmitting(true);
    const metricsPayload = JSON.stringify({
      publisher_metrics: pubMetrics, advertiser_metrics: advMetrics,
    });
    try {
      await submitTrackingSetup(campaign.campaign_id, { campaign_type: "Single Campaign Sheet", advertiser_data_url: advDataUrl, publisher_data_url: pubDataUrl, segment_pub: segmentPub, segment_adv: segmentAdv, metrics_json: metricsPayload, additional_context: "" });
      setIsEditingSubmitted(false);
      onReload();
    }
    catch (e) { alert("Failed: " + e.message); }
    finally { setSubmitting(false); }
  };

  if (campaign.tracking_submitted && !isEditingSubmitted) {
    const selectedPubMetrics = (initialMetrics.publisher_metrics || []).map((key) => PUBLISHER_METRICS.find((m) => m.key === key)?.label || key).join(", ");
    const selectedAdvMetrics = (initialMetrics.advertiser_metrics || []).map((key) => ADVERTISER_METRICS.find((m) => m.key === key)?.label || key).join(", ");
    return (
      <div>
        <div style={{ background: "#E3F6EE", borderRadius: 10, padding: "12px 14px", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: c.green }}>✅ Tracking submitted</div>
            <div style={{ fontSize: 12, color: c.sub, marginTop: 3 }}>Current setup is active for sync and reporting.</div>
          </div>
          {canEdit && (
            <button onClick={() => setIsEditingSubmitted(true)} style={{ background: c.blue, color: "#fff", border: "none", borderRadius: 7, padding: "8px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
              Edit Setup
            </button>
          )}
        </div>
        <div style={{ border: `1px solid ${c.line}`, borderRadius: 10, padding: "14px" }}>
          {[["Advertiser Data URL", campaign.advertiser_data_url], ["Publisher Data URL", campaign.publisher_data_url], ["Segment (Publisher)", campaign.segment_pub], ["Segment (Advertiser)", campaign.segment_adv], ["Publisher Metrics", selectedPubMetrics], ["Advertiser Metrics", selectedAdvMetrics]].map(([label, val]) => (
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
      {campaign.tracking_submitted && (
        <div style={{ background: "#F0F4FF", border: `1px solid ${c.blue}22`, borderRadius: 10, padding: "12px 14px", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: c.blue }}>Editing tracking setup</div>
            <div style={{ fontSize: 12, color: c.sub, marginTop: 3 }}>Saving will update this campaign's active tracking configuration.</div>
          </div>
          <button onClick={() => setIsEditingSubmitted(false)} style={{ background: "#fff", color: c.sub, border: `1px solid ${c.line}`, borderRadius: 7, padding: "8px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
            Cancel
          </button>
        </div>
      )}
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
        <div><label style={{ fontSize: 11, fontWeight: 600, color: c.muted, display: "block", marginBottom: 4 }}>Segment (Publisher) *</label><input style={{ border: `1px solid ${c.line}`, borderRadius: 7, padding: "9px 12px", fontSize: 13, width: "100%", outline: "none" }} value={segmentPub} onChange={(e) => setSegmentPub(e.target.value)} placeholder="e.g. Razorpay_Boat" /></div>
        <div><label style={{ fontSize: 11, fontWeight: 600, color: c.muted, display: "block", marginBottom: 4 }}>Segment (Advertiser) *</label><input style={{ border: `1px solid ${c.line}`, borderRadius: 7, padding: "9px 12px", fontSize: 13, width: "100%", outline: "none" }} value={segmentAdv} onChange={(e) => setSegmentAdv(e.target.value)} placeholder="e.g. Partnership_Razorpay" /></div>
      </div>

      {/* Metric Selection */}
      <div style={{ border: `1px solid ${c.line}`, borderRadius: 10, padding: "14px", marginBottom: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: c.ink, marginBottom: 10 }}>Publisher Metrics</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
          {PUBLISHER_METRICS.map((m) => (
            <label key={m.key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: c.ink, cursor: "pointer", padding: "4px 10px", borderRadius: 6, border: `1px solid ${pubMetrics.includes(m.key) ? c.blue : c.line}`, background: pubMetrics.includes(m.key) ? "#EAF0FF" : "#fff" }}>
              <input type="checkbox" checked={pubMetrics.includes(m.key)} onChange={(e) => setPubMetrics(e.target.checked ? [...pubMetrics, m.key] : pubMetrics.filter((k) => k !== m.key))} style={{ accentColor: c.blue }} />
              {m.label}
            </label>
          ))}
        </div>
        <div style={{ fontSize: 12, fontWeight: 700, color: c.ink, marginBottom: 10 }}>Advertiser Metrics</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {ADVERTISER_METRICS.map((m) => (
            <label key={m.key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: c.ink, cursor: "pointer", padding: "4px 10px", borderRadius: 6, border: `1px solid ${advMetrics.includes(m.key) ? c.green : c.line}`, background: advMetrics.includes(m.key) ? "#E3F6EE" : "#fff" }}>
              <input type="checkbox" checked={advMetrics.includes(m.key)} onChange={(e) => setAdvMetrics(e.target.checked ? [...advMetrics, m.key] : advMetrics.filter((k) => k !== m.key))} style={{ accentColor: c.green }} />
              {m.label}
            </label>
          ))}
        </div>
      </div>


      {/* Publisher sheet config — always visible */}
      {pubDataUrl && (
        <VisualSheetPicker
          pickerType="publisher"
          sheetUrl={pubDataUrl}
          name={campaign.publisher_name || ""}
          campaignId={campaign.campaign_id}
          metrics={PUBLISHER_METRICS.filter((m) => pubMetrics.includes(m.key)).map((m) => ({ key: m.key, label: m.label }))}
          onSaved={() => {}}
        />
      )}

      {/* Advertiser sheet config — shows when metrics are selected */}
      {advDataUrl && advMetrics.length > 0 && (
        <VisualSheetPicker
          pickerType="advertiser"
          sheetUrl={advDataUrl}
          name={campaign.advertiser_name || ""}
          campaignId={campaign.campaign_id}
          metrics={ADVERTISER_METRICS.filter((m) => advMetrics.includes(m.key))}
          onSaved={() => {}}
        />
      )}

      <button onClick={handleSubmit} disabled={submitting} style={{ background: c.green, color: "#fff", border: "none", borderRadius: 8, padding: "10px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer", marginTop: 14 }}>{submitting ? "Saving…" : campaign.tracking_submitted ? "Save Setup Changes ✓" : "Submit Tracking & Complete ✓"}</button>
    </div>
  );
}

// ── Sync Tab ─────────────────────────────────────────────────────────────────
function SyncTab({ campaign, canEdit }) {
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [recomputing, setRecomputing] = useState(false);
  const [recomputeResult, setRecomputeResult] = useState(null);
  const [metrics, setMetrics] = useState(null);

  useEffect(() => { getCampaignMetrics(campaign.campaign_id).then(setMetrics).catch(() => {}); }, [campaign.campaign_id]);

  const handleSync = async () => {
    setSyncing(true); setSyncResult(null);
    try { const r = await syncCampaign(campaign.campaign_id); setSyncResult(r); getCampaignMetrics(campaign.campaign_id).then(setMetrics); }
    catch (e) { setSyncResult({ error: e.message }); }
    finally { setSyncing(false); }
  };

  const handleRecompute = async () => {
    setRecomputing(true); setRecomputeResult(null);
    try { const r = await recomputeMetrics(campaign.campaign_id); setRecomputeResult(r); getCampaignMetrics(campaign.campaign_id).then(setMetrics); }
    catch (e) { setRecomputeResult({ error: e.message }); }
    finally { setRecomputing(false); }
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
        <div style={{ display: "flex", gap: 8 }}>
          {canEdit && <button onClick={handleRecompute} disabled={recomputing || !metrics || metrics.rows === 0} style={{ background: "#fff", color: c.blue, border: `1px solid ${c.blue}`, borderRadius: 7, padding: "8px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>{recomputing ? "Recomputing…" : "♻ Recompute"}</button>}
          {canEdit && <button onClick={handleSync} disabled={syncing} style={{ background: c.blue, color: "#fff", border: "none", borderRadius: 7, padding: "8px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>{syncing ? "Syncing…" : "⟳ Sync Now"}</button>}
        </div>
      </div>
      {syncResult && <div style={{ fontSize: 12, color: syncResult.error ? c.red : c.green, marginBottom: 10 }}>{syncResult.error ? `Error: ${syncResult.error}` : `✓ Synced ${syncResult.rows} rows`}</div>}
      {recomputeResult && <div style={{ fontSize: 12, color: recomputeResult.error ? c.red : c.green, marginBottom: 10 }}>{recomputeResult.error ? `Error: ${recomputeResult.error}` : `✓ Recomputed ${recomputeResult.recomputed} rows`}</div>}
      <div style={{ fontSize: 12, color: c.muted }}>Data is automatically synced every 6 hours via scheduled job. Use "Recompute" to re-evaluate formulas on existing data without re-fetching from sheets.</div>
    </div>
  );
}

// ── Billing Tab ─────────────────────────────────────────────────────────────
const PUBLISHER_BILLING_MODELS = [
  { value: "cpc", label: "CPC (Cost Per Click)" },
  { value: "cpm", label: "CPM (Cost Per Mille)" },
];
const ADVERTISER_BILLING_MODELS = [
  { value: "roas", label: "ROAS (Revenue / ROAS)" },
  { value: "cpc", label: "CPC (Cost Per Click)" },
];
const BILLING_MODEL_LABELS = { cpc: "CPC", cpm: "CPM", roas: "ROAS" };
const BILLING_RATE_LABELS = {
  cpc: "Rate (₹ per click)",
  cpm: "Rate (₹ per 1000 impressions)",
  roas: "ROAS multiplier",
};
const billingModelsForSide = (side) => side === "advertiser" ? ADVERTISER_BILLING_MODELS : PUBLISHER_BILLING_MODELS;

function BillingTab({ campaign, canEdit }) {
  const [configs, setConfigs] = useState([]);
  const [spends, setSpends] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(null); // 'publisher' or 'advertiser'
  const [formModel, setFormModel] = useState("cpc");
  const [formRate, setFormRate] = useState("");
  const [formDate, setFormDate] = useState(new Date().toISOString().split("T")[0]);
  const [editingConfigId, setEditingConfigId] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const data = await getBillingConfig(campaign.campaign_id);
      setConfigs(data.configs || []);
      setSpends(data.spends || null);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, [campaign.campaign_id]);

  const handleSave = async () => {
    if (!formRate || !showForm) return;
    setSaving(true);
    try {
      await addBillingConfig(campaign.campaign_id, { side: showForm, billing_model: formModel, rate: parseFloat(formRate), start_date: formDate, replace_config_id: editingConfigId });
      setShowForm(null); setFormRate(""); setFormModel("cpc"); setEditingConfigId(null);
      await load();
    } catch (e) { alert("Error: " + e.message); }
    finally { setSaving(false); }
  };

  const fmtCurrency = (v) => {
    if (!v && v !== 0) return "—";
    return "₹" + Number(v).toLocaleString("en-IN", { maximumFractionDigits: 0 });
  };

  if (loading) return <div style={{ padding: 20, color: c.muted }}>Loading billing config…</div>;

  const pubConfigs = configs.filter((x) => x.side === "publisher");
  const advConfigs = configs.filter((x) => x.side === "advertiser");

  const ConfigTable = ({ title, rows, side }) => (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <h4 style={{ fontSize: 14, fontWeight: 700, color: c.ink, margin: 0 }}>{title}</h4>
        {canEdit && <button onClick={() => { setShowForm(side); setFormModel(billingModelsForSide(side)[0].value); setFormRate(""); setFormDate(new Date().toISOString().split("T")[0]); setEditingConfigId(null); }} style={{ fontSize: 11, fontWeight: 600, color: c.blue, background: "none", border: `1px solid ${c.blue}`, borderRadius: 5, padding: "4px 10px", cursor: "pointer" }}>+ Add / Change</button>}
      </div>
      {rows.length === 0 && <div style={{ fontSize: 12, color: c.muted, padding: "10px 0" }}>No billing config set yet.</div>}
      {rows.length > 0 && (
        <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${c.line}` }}>
              <th style={{ textAlign: "left", padding: "6px 8px", color: c.muted, fontWeight: 600 }}>Model</th>
              <th style={{ textAlign: "right", padding: "6px 8px", color: c.muted, fontWeight: 600 }}>Rate (₹)</th>
              <th style={{ textAlign: "left", padding: "6px 8px", color: c.muted, fontWeight: 600 }}>From</th>
              <th style={{ textAlign: "left", padding: "6px 8px", color: c.muted, fontWeight: 600 }}>To</th>
              {canEdit && <th style={{ textAlign: "right", padding: "6px 8px", color: c.muted, fontWeight: 600 }}>Edit</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={{ borderBottom: `1px solid ${c.line}` }}>
                <td style={{ padding: "7px 8px", fontWeight: 600 }}>{BILLING_MODEL_LABELS[r.billing_model] || r.billing_model.toUpperCase()}</td>
                <td style={{ padding: "7px 8px", textAlign: "right" }}>{r.rate}</td>
                <td style={{ padding: "7px 8px" }}>{r.start_date}</td>
                <td style={{ padding: "7px 8px", color: r.end_date ? c.ink : c.green }}>{r.end_date || "Active"}</td>
                {canEdit && (
                  <td style={{ padding: "7px 8px", textAlign: "right" }}>
                    <button onClick={() => { setShowForm(side); setFormModel(r.billing_model); setFormRate(String(r.rate)); setFormDate(r.start_date); setEditingConfigId(r.id); }} style={{ background: "none", border: "none", color: c.blue, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Edit</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {showForm === side && (
        <div style={{ background: c.bg, borderRadius: 8, padding: 14, marginTop: 8, display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div>
            <label style={{ fontSize: 11, color: c.muted, display: "block", marginBottom: 3 }}>Model</label>
            <select value={formModel} onChange={(e) => setFormModel(e.target.value)} style={{ padding: "6px 8px", borderRadius: 5, border: `1px solid ${c.line}`, fontSize: 12 }}>
              {billingModelsForSide(side).map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, color: c.muted, display: "block", marginBottom: 3 }}>{BILLING_RATE_LABELS[formModel] || "Rate"}</label>
            <input type="number" step="0.01" value={formRate} onChange={(e) => setFormRate(e.target.value)} placeholder="e.g. 5.00" style={{ padding: "6px 8px", borderRadius: 5, border: `1px solid ${c.line}`, fontSize: 12, width: 90 }} />
          </div>
          <div>
            <label style={{ fontSize: 11, color: c.muted, display: "block", marginBottom: 3 }}>Effective From</label>
            <input type="date" value={formDate} onChange={(e) => setFormDate(e.target.value)} style={{ padding: "6px 8px", borderRadius: 5, border: `1px solid ${c.line}`, fontSize: 12 }} />
          </div>
          <button onClick={handleSave} disabled={saving} style={{ background: c.green, color: "#fff", border: "none", borderRadius: 6, padding: "7px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>{saving ? "Saving…" : editingConfigId ? "Update" : "Save"}</button>
          <button onClick={() => { setShowForm(null); setEditingConfigId(null); }} style={{ background: "none", border: "none", color: c.muted, fontSize: 12, cursor: "pointer" }}>Cancel</button>
        </div>
      )}
    </div>
  );

  return (
    <div>
      <ConfigTable title="Publisher Billing" rows={pubConfigs} side="publisher" />
      <ConfigTable title="Advertiser Billing" rows={advConfigs} side="advertiser" />

      {spends && (spends.publisher > 0 || spends.advertiser > 0) && (
        <div style={{ background: c.bg, borderRadius: 10, padding: 16, marginTop: 10 }}>
          <h4 style={{ fontSize: 13, fontWeight: 700, color: c.ink, margin: "0 0 10px" }}>Calculated Spends (last 30 days)</h4>
          <div style={{ display: "flex", gap: 24, fontSize: 13 }}>
            <div><span style={{ color: c.muted }}>Publisher:</span> <b>{fmtCurrency(spends.publisher)}</b></div>
            <div><span style={{ color: c.muted }}>Advertiser:</span> <b>{fmtCurrency(spends.advertiser)}</b></div>
            <div><span style={{ color: c.muted }}>Margin:</span> <b style={{ color: spends.margin >= 0 ? c.green : c.red }}>{fmtCurrency(spends.margin)} ({spends.margin_pct}%)</b></div>
          </div>
        </div>
      )}
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
