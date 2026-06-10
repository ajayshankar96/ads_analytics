import React, { useState, useEffect, useRef } from "react";
import {
  getAdvertiserReports,
  getAdvertiserReportColumns,
  createAdvertiserReport,
  refreshAdvertiserReport,
  deleteAdvertiserReport,
  refreshAllAdvertiserReports,
} from "../api";

// ── Styles ────────────────────────────────────────────────────────────────────
const S = {
  wrap: { maxWidth: 1200, margin: "0 auto" },
  card: {
    background: "#fff",
    borderRadius: 8,
    boxShadow: "0 1px 6px rgba(0,0,0,0.08)",
    padding: "20px 24px",
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 700,
    color: "#1e3a5f",
    marginBottom: 16,
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  grid2: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 16,
    marginBottom: 16,
  },
  label: { fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 4 },
  input: {
    width: "100%",
    padding: "8px 10px",
    border: "1px solid #d1d5db",
    borderRadius: 6,
    fontSize: 13,
    boxSizing: "border-box",
  },
  select: {
    width: "100%",
    padding: "8px 10px",
    border: "1px solid #d1d5db",
    borderRadius: 6,
    fontSize: 13,
    background: "#fff",
    boxSizing: "border-box",
  },
  checkGroup: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 4,
  },
  checkChip: (checked) => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "5px 12px",
    borderRadius: 20,
    border: `1px solid ${checked ? "#2563eb" : "#d1d5db"}`,
    background: checked ? "#eff6ff" : "#f9fafb",
    color: checked ? "#2563eb" : "#555",
    fontSize: 12,
    fontWeight: checked ? 600 : 400,
    cursor: "pointer",
    userSelect: "none",
    transition: "all 0.15s",
  }),
  colList: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    minHeight: 48,
    padding: "10px",
    border: "1px solid #e5e7eb",
    borderRadius: 6,
    background: "#f9fafb",
    marginTop: 8,
  },
  colChip: (dragging) => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "4px 10px",
    borderRadius: 16,
    background: dragging ? "#dbeafe" : "#2563eb",
    color: "#fff",
    fontSize: 12,
    cursor: "grab",
    userSelect: "none",
    opacity: dragging ? 0.5 : 1,
  }),
  removeBtn: {
    background: "none",
    border: "none",
    color: "rgba(255,255,255,0.8)",
    cursor: "pointer",
    padding: 0,
    fontSize: 14,
    lineHeight: 1,
  },
  btn: (variant = "primary") => ({
    padding: "8px 18px",
    borderRadius: 6,
    border: "none",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 600,
    background:
      variant === "primary"
        ? "#2563eb"
        : variant === "danger"
        ? "#dc2626"
        : variant === "warning"
        ? "#d97706"
        : "#6b7280",
    color: "#fff",
    transition: "opacity 0.15s",
  }),
  btnSm: (variant = "secondary") => ({
    padding: "4px 10px",
    borderRadius: 4,
    border: "none",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 500,
    background:
      variant === "primary"
        ? "#2563eb"
        : variant === "danger"
        ? "#fee2e2"
        : variant === "success"
        ? "#dcfce7"
        : "#f3f4f6",
    color:
      variant === "primary"
        ? "#fff"
        : variant === "danger"
        ? "#dc2626"
        : variant === "success"
        ? "#16a34a"
        : "#374151",
  }),
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: {
    padding: "10px 12px",
    background: "#f3f4f6",
    color: "#374151",
    fontWeight: 600,
    textAlign: "left",
    borderBottom: "1px solid #e5e7eb",
    whiteSpace: "nowrap",
  },
  td: {
    padding: "10px 12px",
    borderBottom: "1px solid #f3f4f6",
    verticalAlign: "middle",
    color: "#374151",
  },
  actionRow: { display: "flex", gap: 6, alignItems: "center" },
  banner: (type) => ({
    padding: "12px 16px",
    borderRadius: 6,
    marginBottom: 16,
    fontSize: 13,
    background: type === "error" ? "#fee2e2" : "#dcfce7",
    color: type === "error" ? "#dc2626" : "#16a34a",
    border: `1px solid ${type === "error" ? "#fca5a5" : "#86efac"}`,
  }),
  hint: { fontSize: 11, color: "#9ca3af", marginTop: 4 },
  forced: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "4px 10px",
    borderRadius: 16,
    background: "#fef3c7",
    color: "#92400e",
    fontSize: 12,
    border: "1px solid #fcd34d",
  },
};

const VIEW_OPTIONS = [
  { id: "consolidated", label: "📋 Consolidated", desc: "All rows, chronological" },
  { id: "monthly",      label: "📅 Monthly",      desc: "Grouped by month" },
  { id: "weekly",       label: "📆 Weekly",        desc: "Grouped by week" },
  { id: "segmentWeekly", label: "🏷️ Segment Weekly", desc: "Segment × week breakdown" },
];

// Simple drag-and-drop reorder for column chips
function DraggableColList({ cols, onRemove, onReorder }) {
  const dragIdx = useRef(null);
  const dragOverIdx = useRef(null);

  const handleDragStart = (e, idx) => {
    dragIdx.current = idx;
    e.dataTransfer.effectAllowed = "move";
  };
  const handleDragOver = (e, idx) => {
    e.preventDefault();
    dragOverIdx.current = idx;
    e.dataTransfer.dropEffect = "move";
  };
  const handleDrop = () => {
    if (dragIdx.current === null || dragOverIdx.current === null) return;
    if (dragIdx.current === dragOverIdx.current) return;
    const reordered = [...cols];
    const [moved] = reordered.splice(dragIdx.current, 1);
    reordered.splice(dragOverIdx.current, 0, moved);
    onReorder(reordered);
    dragIdx.current = null;
    dragOverIdx.current = null;
  };

  if (!cols.length) return (
    <div style={{ color: "#9ca3af", fontSize: 12, padding: 8 }}>
      No columns selected — check boxes above to add columns
    </div>
  );

  return (
    <div style={S.colList} onDrop={handleDrop} onDragOver={(e) => e.preventDefault()}>
      {cols.map((col, idx) => (
        <span
          key={col}
          draggable
          onDragStart={(e) => handleDragStart(e, idx)}
          onDragOver={(e) => handleDragOver(e, idx)}
          style={S.colChip(false)}
        >
          ⠿ {col}
          <button style={S.removeBtn} onClick={() => onRemove(col)}>×</button>
        </span>
      ))}
    </div>
  );
}

export default function AdvertiserReporting({ filterOptions = {} }) {
  const [advertisers, setAdvertisers] = useState([]);
  const [availableCols, setAvailableCols] = useState([]);
  const [forcedCols, setForcedCols] = useState([]);
  const [reports, setReports] = useState([]);
  const [loadingReports, setLoadingReports] = useState(true);

  // Form state
  const [form, setForm] = useState({
    advertiser: "",
    reportName: "",
    dateFrom: "",
    selectedColumns: [],
    viewsToCreate: ["consolidated"],
  });
  const [submitting, setSubmitting] = useState(false);
  const [formMsg, setFormMsg] = useState(null); // {type, text}

  // Per-report actions
  const [refreshingId, setRefreshingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [refreshingAll, setRefreshingAll] = useState(false);

  // ── Load initial data ────────────────────────────────────────────────────
  useEffect(() => {
    const advList = filterOptions.advertisers || [];
    setAdvertisers(advList);

    getAdvertiserReportColumns()
      .then((d) => {
        setAvailableCols(d.columns || []);
        setForcedCols(d.forcedColumns || []);
      })
      .catch(console.error);

    loadReports();
  }, []); // eslint-disable-line

  const loadReports = () => {
    setLoadingReports(true);
    getAdvertiserReports()
      .then((d) => {
        const sorted = [...(d.reports || [])].sort(
          (a, b) => String(b.createdDate || "").localeCompare(String(a.createdDate || ""))
        );
        setReports(sorted);
      })
      .catch(console.error)
      .finally(() => setLoadingReports(false));
  };

  // ── Form helpers ─────────────────────────────────────────────────────────
  const toggleColumn = (col) => {
    setForm((f) => ({
      ...f,
      selectedColumns: f.selectedColumns.includes(col)
        ? f.selectedColumns.filter((c) => c !== col)
        : [...f.selectedColumns, col],
    }));
  };

  const toggleView = (view) => {
    setForm((f) => ({
      ...f,
      viewsToCreate: f.viewsToCreate.includes(view)
        ? f.viewsToCreate.filter((v) => v !== view)
        : [...f.viewsToCreate, view],
    }));
  };

  const handleSubmit = async () => {
    if (!form.advertiser) return setFormMsg({ type: "error", text: "Select an advertiser." });
    if (!form.reportName.trim()) return setFormMsg({ type: "error", text: "Enter a report name." });
    if (!form.viewsToCreate.length) return setFormMsg({ type: "error", text: "Select at least one view." });

    setSubmitting(true);
    setFormMsg(null);
    try {
      const res = await createAdvertiserReport({
        reportName: form.reportName.trim(),
        advertiser: form.advertiser,
        dateFrom: form.dateFrom || null,
        selectedColumns: form.selectedColumns,
        viewsToCreate: form.viewsToCreate,
      });
      setFormMsg({
        type: "success",
        text: `✅ Report created! Sheets: ${res.sheets.join(", ")}. `,
        url: res.spreadsheetUrl,
      });
      setForm({ advertiser: "", reportName: "", dateFrom: "", selectedColumns: [], viewsToCreate: ["consolidated"] });
      loadReports();
    } catch (e) {
      setFormMsg({ type: "error", text: e.message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleRefresh = async (id) => {
    setRefreshingId(id);
    try {
      await refreshAdvertiserReport(id);
      loadReports();
    } catch (e) {
      alert("Refresh failed: " + e.message);
    } finally {
      setRefreshingId(null);
    }
  };

  const handleDelete = async (id, name) => {
    if (!window.confirm(`Delete report "${name}"? This cannot be undone.`)) return;
    setDeletingId(id);
    try {
      await deleteAdvertiserReport(id);
      loadReports();
    } catch (e) {
      alert("Delete failed: " + e.message);
    } finally {
      setDeletingId(null);
    }
  };

  const handleRefreshAll = async () => {
    if (!window.confirm("Refresh all advertiser reports? This may take a few minutes.")) return;
    setRefreshingAll(true);
    try {
      await refreshAllAdvertiserReports();
      loadReports();
    } catch (e) {
      alert("Refresh all failed: " + e.message);
    } finally {
      setRefreshingAll(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={S.wrap}>
      {/* ── Create Report Form ── */}
      <div style={S.card}>
        <div style={S.sectionTitle}>📊 Create Advertiser Report</div>

        {formMsg && (
          <div style={S.banner(formMsg.type)}>
            {formMsg.text}
            {formMsg.url && (
              <a href={formMsg.url} target="_blank" rel="noopener noreferrer"
                style={{ color: "inherit", fontWeight: 700 }}>
                Open Spreadsheet ↗
              </a>
            )}
          </div>
        )}

        <div style={S.grid2}>
          <div>
            <div style={S.label}>Advertiser *</div>
            <select
              style={S.select}
              value={form.advertiser}
              onChange={(e) => setForm((f) => ({ ...f, advertiser: e.target.value }))}
            >
              <option value="">— Select advertiser —</option>
              {advertisers.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <div style={S.label}>Report Name *</div>
            <input
              style={S.input}
              placeholder="e.g. Weekly Performance Report"
              value={form.reportName}
              onChange={(e) => setForm((f) => ({ ...f, reportName: e.target.value }))}
            />
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={S.label}>Date Range</div>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <input
                type="radio"
                checked={!form.dateFrom}
                onChange={() => setForm((f) => ({ ...f, dateFrom: "" }))}
              />
              All time
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <input
                type="radio"
                checked={!!form.dateFrom}
                onChange={() => setForm((f) => ({ ...f, dateFrom: new Date().toISOString().slice(0, 10) }))}
              />
              From date
            </label>
            {form.dateFrom && (
              <input
                type="date"
                style={{ ...S.input, width: "auto" }}
                value={form.dateFrom}
                onChange={(e) => setForm((f) => ({ ...f, dateFrom: e.target.value }))}
              />
            )}
          </div>
        </div>

        {/* Column selection */}
        <div style={{ marginBottom: 16 }}>
          <div style={S.label}>Columns</div>
          <div style={S.hint}>
            Always included (not configurable):&nbsp;
            {forcedCols.map((c) => <span key={c} style={{ ...S.forced, marginRight: 4 }}>{c}</span>)}
          </div>
          <div style={S.checkGroup}>
            {availableCols.map((col) => (
              <span
                key={col}
                style={S.checkChip(form.selectedColumns.includes(col))}
                onClick={() => toggleColumn(col)}
              >
                {form.selectedColumns.includes(col) ? "✓ " : ""}{col}
              </span>
            ))}
          </div>
        </div>

        {/* Selected column order */}
        {form.selectedColumns.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={S.label}>Column Order <span style={S.hint}>(drag to reorder)</span></div>
            <DraggableColList
              cols={form.selectedColumns}
              onRemove={(col) => setForm((f) => ({ ...f, selectedColumns: f.selectedColumns.filter((c) => c !== col) }))}
              onReorder={(cols) => setForm((f) => ({ ...f, selectedColumns: cols }))}
            />
          </div>
        )}

        {/* View selection */}
        <div style={{ marginBottom: 20 }}>
          <div style={S.label}>Views to Create *</div>
          <div style={S.checkGroup}>
            {VIEW_OPTIONS.map((v) => (
              <span
                key={v.id}
                style={S.checkChip(form.viewsToCreate.includes(v.id))}
                onClick={() => toggleView(v.id)}
                title={v.desc}
              >
                {form.viewsToCreate.includes(v.id) ? "✓ " : ""}{v.label}
              </span>
            ))}
          </div>
        </div>

        <button
          style={{ ...S.btn("primary"), opacity: submitting ? 0.6 : 1 }}
          onClick={handleSubmit}
          disabled={submitting}
        >
          {submitting ? "Creating…" : "📊 Create Report"}
        </button>
      </div>

      {/* ── Existing Reports ── */}
      <div style={S.card}>
        <div style={{ ...S.sectionTitle, justifyContent: "space-between" }}>
          <span>📋 Existing Advertiser Reports</span>
          <button
            style={{ ...S.btn("warning"), opacity: refreshingAll ? 0.6 : 1 }}
            onClick={handleRefreshAll}
            disabled={refreshingAll}
            title="Refresh all reports with latest data"
          >
            {refreshingAll ? "Refreshing all…" : "🔄 Refresh All"}
          </button>
        </div>

        {loadingReports ? (
          <div style={{ color: "#9ca3af", fontSize: 13 }}>Loading reports…</div>
        ) : reports.length === 0 ? (
          <div style={{ color: "#9ca3af", fontSize: 13 }}>No advertiser reports yet. Create one above!</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={S.table}>
              <thead>
                <tr>
                  {["Report Name", "Advertiser", "Date Range", "Views", "Created By", "Created Date", "Last Refreshed", "Actions"].map((h) => (
                    <th key={h} style={S.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => (
                  <tr key={r.id}>
                    <td style={S.td}>
                      <a href={r.spreadsheetUrl} target="_blank" rel="noopener noreferrer"
                        style={{ color: "#2563eb", textDecoration: "none", fontWeight: 600 }}>
                        {r.reportName} ↗
                      </a>
                    </td>
                    <td style={S.td}>{r.advertiser}</td>
                    <td style={S.td}>{r.dateFrom === "All" || !r.dateFrom ? "All time" : `From ${r.dateFrom}`}</td>
                    <td style={S.td}>
                      {(r.views || []).map((v) => (
                        <span key={v} style={{
                          display: "inline-block", padding: "2px 8px", borderRadius: 10,
                          background: "#eff6ff", color: "#2563eb", fontSize: 11, marginRight: 4, marginBottom: 2
                        }}>{v}</span>
                      ))}
                    </td>
                    <td style={S.td}>{r.createdBy}</td>
                    <td style={S.td}>{r.createdDate ? r.createdDate.slice(0, 10) : "—"}</td>
                    <td style={S.td}>{r.lastRefreshed ? r.lastRefreshed.slice(0, 16) : "—"}</td>
                    <td style={S.td}>
                      <div style={S.actionRow}>
                        <a href={r.spreadsheetUrl} target="_blank" rel="noopener noreferrer">
                          <button style={S.btnSm("primary")} title="Open spreadsheet">↗ Open</button>
                        </a>
                        <button
                          style={{ ...S.btnSm("success"), opacity: refreshingId === r.id ? 0.6 : 1 }}
                          onClick={() => handleRefresh(r.id)}
                          disabled={refreshingId === r.id}
                          title="Refresh with latest data"
                        >
                          {refreshingId === r.id ? "…" : "🔄"}
                        </button>
                        <button
                          style={{ ...S.btnSm("danger"), opacity: deletingId === r.id ? 0.6 : 1 }}
                          onClick={() => handleDelete(r.id, r.reportName)}
                          disabled={deletingId === r.id}
                          title="Delete report"
                        >
                          🗑️
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
