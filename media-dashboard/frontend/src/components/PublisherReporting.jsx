import React, { useState, useEffect } from "react";
import {
  getPublisherReports,
  getPublisherMetrics,
  getPublisherAdvertisers,
  createPublisherReport,
  refreshPublisherReport,
  deletePublisherReport,
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
  grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 },
  grid3: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 16 },
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
  checkGroup: { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4 },
  btn: (variant = "primary") => ({
    padding: "8px 18px",
    borderRadius: 6,
    border: "none",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 600,
    background:
      variant === "primary" ? "#2563eb"
      : variant === "danger"  ? "#dc2626"
      : variant === "success" ? "#16a34a"
      : variant === "ghost"   ? "#f3f4f6"
      : "#6b7280",
    color: variant === "ghost" ? "#374151" : "#fff",
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
      variant === "primary" ? "#2563eb"
      : variant === "danger"  ? "#fee2e2"
      : variant === "success" ? "#dcfce7"
      : "#f3f4f6",
    color:
      variant === "primary" ? "#fff"
      : variant === "danger"  ? "#dc2626"
      : variant === "success" ? "#16a34a"
      : "#374151",
  }),
  advCard: (checked) => ({
    border: `1px solid ${checked ? "#2563eb" : "#e5e7eb"}`,
    borderRadius: 8,
    padding: "12px 14px",
    background: checked ? "#eff6ff" : "#fff",
    cursor: "pointer",
    transition: "all 0.15s",
  }),
  advName: (checked) => ({
    fontWeight: 700,
    fontSize: 13,
    color: checked ? "#2563eb" : "#1e3a5f",
    marginBottom: 6,
    display: "flex",
    alignItems: "center",
    gap: 6,
  }),
  chipList: { display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 },
  chip: (color) => ({
    padding: "2px 8px",
    borderRadius: 10,
    fontSize: 11,
    background: color === "blue" ? "#dbeafe" : color === "purple" ? "#ede9fe" : "#f3f4f6",
    color: color === "blue" ? "#1d4ed8" : color === "purple" ? "#7c3aed" : "#374151",
    fontWeight: 500,
  }),
  banner: (type) => ({
    padding: "12px 16px",
    borderRadius: 6,
    marginBottom: 16,
    fontSize: 13,
    background: type === "error" ? "#fee2e2" : "#dcfce7",
    color: type === "error" ? "#dc2626" : "#16a34a",
    border: `1px solid ${type === "error" ? "#fca5a5" : "#86efac"}`,
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
  divider: { borderTop: "1px solid #e5e7eb", margin: "16px 0" },
};

const LEVEL_OPTIONS = [
  { id: "daily",  label: "📅 Daily (Default)", desc: "Day-by-day breakdown" },
  { id: "weekly", label: "📆 Weekly",           desc: "Week-by-week aggregation" },
  { id: "mtd",    label: "📊 MTD",              desc: "Month-to-date aggregation" },
];

// ── Advertiser Card ───────────────────────────────────────────────────────────
function AdvCard({ adv, checked, onToggle }) {
  return (
    <div style={S.advCard(checked)} onClick={onToggle}>
      <div style={S.advName(checked)}>
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          onClick={(e) => e.stopPropagation()}
          style={{ accentColor: "#2563eb" }}
        />
        {adv.name}
        <span style={{ ...S.chip("blue"), marginLeft: "auto" }}>
          {adv.comboCount} combo{adv.comboCount !== 1 ? "s" : ""}
        </span>
      </div>
      {adv.segments.length > 0 && (
        <div style={S.chipList}>
          {adv.segments.map((s) => (
            <span key={s} style={S.chip("blue")}>{s}</span>
          ))}
        </div>
      )}
      {adv.offers.length > 0 && (
        <div style={{ ...S.chipList, marginTop: 4 }}>
          {adv.offers.slice(0, 4).map((o) => (
            <span key={o} style={S.chip("purple")}>{o}</span>
          ))}
          {adv.offers.length > 4 && (
            <span style={S.chip("")}>+{adv.offers.length - 4} more</span>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function PublisherReporting({ filterOptions = {} }) {
  const [publishers, setPublishers] = useState([]);
  const [fixedMetrics, setFixedMetrics] = useState([]);
  const [extraMetrics, setExtraMetrics] = useState([]);
  const [reports, setReports] = useState([]);
  const [loadingReports, setLoadingReports] = useState(true);

  // Form state
  const [form, setForm] = useState({
    publisher: "",
    reportName: "",
    dateRangeType: "all", // "all" | "custom"
    dateFrom: "",
    dateTo: "",
    reportingLevels: ["daily"],
    selectedExtraMetrics: [],
  });
  const [advLoading, setAdvLoading] = useState(false);
  const [availableAdvs, setAvailableAdvs] = useState([]); // [{name, segments, offers, comboCount}]
  const [selectedAdvs, setSelectedAdvs] = useState(new Set());

  const [submitting, setSubmitting] = useState(false);
  const [formMsg, setFormMsg] = useState(null);

  // Per-report actions
  const [refreshingId, setRefreshingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  // ── Load initial data ────────────────────────────────────────────────────
  useEffect(() => {
    setPublishers(filterOptions.publishers || []);

    getPublisherMetrics()
      .then((d) => {
        setFixedMetrics(d.fixedMetrics || []);
        setExtraMetrics(d.extraMetrics || []);
      })
      .catch(console.error);

    loadReports();
  }, []); // eslint-disable-line

  const loadReports = () => {
    setLoadingReports(true);
    getPublisherReports()
      .then((d) => setReports(d.reports || []))
      .catch(console.error)
      .finally(() => setLoadingReports(false));
  };

  // ── Load advertisers for publisher ───────────────────────────────────────
  const handleLoadAdvertisers = async () => {
    if (!form.publisher) return;
    setAdvLoading(true);
    setAvailableAdvs([]);
    setSelectedAdvs(new Set());
    try {
      const dateFrom = form.dateRangeType === "custom" ? form.dateFrom : undefined;
      const dateTo = form.dateRangeType === "custom" ? form.dateTo : undefined;
      const d = await getPublisherAdvertisers(form.publisher, dateFrom, dateTo);
      setAvailableAdvs(d.advertisers || []);
      // Select all by default
      setSelectedAdvs(new Set((d.advertisers || []).map((a) => a.name)));
    } catch (e) {
      alert("Failed to load advertisers: " + e.message);
    } finally {
      setAdvLoading(false);
    }
  };

  // ── Toggle advertiser ────────────────────────────────────────────────────
  const toggleAdv = (name) => {
    setSelectedAdvs((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const selectAllAdvs = () => setSelectedAdvs(new Set(availableAdvs.map((a) => a.name)));
  const deselectAllAdvs = () => setSelectedAdvs(new Set());

  // ── Toggle level ─────────────────────────────────────────────────────────
  const toggleLevel = (level) => {
    setForm((f) => ({
      ...f,
      reportingLevels: f.reportingLevels.includes(level)
        ? f.reportingLevels.filter((l) => l !== level)
        : [...f.reportingLevels, level],
    }));
  };

  const toggleExtraMetric = (m) => {
    setForm((f) => ({
      ...f,
      selectedExtraMetrics: f.selectedExtraMetrics.includes(m)
        ? f.selectedExtraMetrics.filter((x) => x !== m)
        : [...f.selectedExtraMetrics, m],
    }));
  };

  // ── Submit ───────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!form.publisher) return setFormMsg({ type: "error", text: "Select a publisher." });
    if (!form.reportName.trim()) return setFormMsg({ type: "error", text: "Enter a report name." });
    if (!form.reportingLevels.length) return setFormMsg({ type: "error", text: "Select at least one reporting level." });
    if (!availableAdvs.length) return setFormMsg({ type: "error", text: "Load advertisers first." });

    const chosenAdvs = availableAdvs.filter((a) => selectedAdvs.has(a.name));
    if (!chosenAdvs.length) return setFormMsg({ type: "error", text: "Select at least one advertiser." });

    setSubmitting(true);
    setFormMsg(null);
    try {
      const res = await createPublisherReport({
        reportName: form.reportName.trim(),
        publisher: form.publisher,
        dateFrom: form.dateRangeType === "custom" ? form.dateFrom || null : null,
        dateTo: form.dateRangeType === "custom" ? form.dateTo || null : null,
        reportingLevels: form.reportingLevels,
        advertisers: chosenAdvs.map((a) => ({
          name: a.name,
          segments: a.segments,
          metrics: form.selectedExtraMetrics,
        })),
        extraMetrics: form.selectedExtraMetrics,
      });
      setFormMsg({
        type: "success",
        text: `✅ Publisher report created for ${res.advertisers.length} advertiser(s). `,
        url: res.spreadsheetUrl,
      });
      setForm({
        publisher: "",
        reportName: "",
        dateRangeType: "all",
        dateFrom: "",
        dateTo: "",
        reportingLevels: ["daily"],
        selectedExtraMetrics: [],
      });
      setAvailableAdvs([]);
      setSelectedAdvs(new Set());
      loadReports();
    } catch (e) {
      setFormMsg({ type: "error", text: e.message });
    } finally {
      setSubmitting(false);
    }
  };

  // ── Report actions ───────────────────────────────────────────────────────
  const handleRefresh = async (id) => {
    setRefreshingId(id);
    try {
      await refreshPublisherReport(id);
      loadReports();
    } catch (e) {
      alert("Refresh failed: " + e.message);
    } finally {
      setRefreshingId(null);
    }
  };

  const handleDelete = async (id, name) => {
    if (!window.confirm(`Delete report "${name}"?`)) return;
    setDeletingId(id);
    try {
      await deletePublisherReport(id);
      loadReports();
    } catch (e) {
      alert("Delete failed: " + e.message);
    } finally {
      setDeletingId(null);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={S.wrap}>
      {/* ── Create Report Form ── */}
      <div style={S.card}>
        <div style={S.sectionTitle}>📡 Create Publisher Report</div>

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

        {/* Row 1: publisher + report name */}
        <div style={S.grid2}>
          <div>
            <div style={S.label}>Publisher *</div>
            <select
              style={S.select}
              value={form.publisher}
              onChange={(e) => {
                setForm((f) => ({ ...f, publisher: e.target.value }));
                setAvailableAdvs([]);
                setSelectedAdvs(new Set());
              }}
            >
              <option value="">— Select publisher —</option>
              {publishers.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <div style={S.label}>Report Name *</div>
            <input
              style={S.input}
              placeholder="e.g. Weekly Publisher Summary"
              value={form.reportName}
              onChange={(e) => setForm((f) => ({ ...f, reportName: e.target.value }))}
            />
          </div>
        </div>

        {/* Date range */}
        <div style={{ marginBottom: 16 }}>
          <div style={S.label}>Date Range</div>
          <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <input
                type="radio"
                checked={form.dateRangeType === "all"}
                onChange={() => setForm((f) => ({ ...f, dateRangeType: "all", dateFrom: "", dateTo: "" }))}
              />
              All time
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <input
                type="radio"
                checked={form.dateRangeType === "custom"}
                onChange={() => setForm((f) => ({ ...f, dateRangeType: "custom" }))}
              />
              Custom range
            </label>
            {form.dateRangeType === "custom" && (
              <>
                <input
                  type="date"
                  style={{ ...S.input, width: "auto" }}
                  value={form.dateFrom}
                  onChange={(e) => setForm((f) => ({ ...f, dateFrom: e.target.value }))}
                  placeholder="From"
                />
                <span style={{ fontSize: 12, color: "#9ca3af" }}>to</span>
                <input
                  type="date"
                  style={{ ...S.input, width: "auto" }}
                  value={form.dateTo}
                  onChange={(e) => setForm((f) => ({ ...f, dateTo: e.target.value }))}
                  placeholder="To"
                />
              </>
            )}
          </div>
        </div>

        {/* Reporting levels */}
        <div style={{ marginBottom: 16 }}>
          <div style={S.label}>Reporting Levels *</div>
          <div style={S.checkGroup}>
            {LEVEL_OPTIONS.map((l) => (
              <span
                key={l.id}
                style={S.checkChip(form.reportingLevels.includes(l.id))}
                onClick={() => toggleLevel(l.id)}
                title={l.desc}
              >
                {form.reportingLevels.includes(l.id) ? "✓ " : ""}{l.label}
              </span>
            ))}
          </div>
        </div>

        {/* Load advertisers button */}
        <div style={{ marginBottom: 16 }}>
          <button
            style={{ ...S.btn("ghost"), border: "1px solid #d1d5db", opacity: advLoading ? 0.6 : 1 }}
            onClick={handleLoadAdvertisers}
            disabled={!form.publisher || advLoading}
          >
            {advLoading ? "Loading advertisers…" : "🔍 Load Advertisers"}
          </button>
          {!form.publisher && (
            <span style={{ fontSize: 12, color: "#9ca3af", marginLeft: 10 }}>
              Select a publisher first
            </span>
          )}
        </div>

        {/* Advertiser cards */}
        {availableAdvs.length > 0 && (
          <>
            <div style={S.divider} />
            <div style={{ marginBottom: 12 }}>
              <div style={{ ...S.sectionTitle, fontSize: 14, marginBottom: 8 }}>
                Advertisers
                <span style={{ fontSize: 12, color: "#6b7280", fontWeight: 400 }}>
                  ({selectedAdvs.size}/{availableAdvs.length} selected)
                </span>
                <button
                  style={{ ...S.btnSm("primary"), marginLeft: "auto" }}
                  onClick={selectAllAdvs}
                >
                  Select All
                </button>
                <button style={S.btnSm()} onClick={deselectAllAdvs}>
                  Deselect All
                </button>
              </div>
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
                gap: 10,
              }}>
                {availableAdvs.map((adv) => (
                  <AdvCard
                    key={adv.name}
                    adv={adv}
                    checked={selectedAdvs.has(adv.name)}
                    onToggle={() => toggleAdv(adv.name)}
                  />
                ))}
              </div>
            </div>

            {/* Extra metrics */}
            {extraMetrics.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={S.divider} />
                <div style={S.label}>
                  Extra Metrics (beyond fixed: {["Impressions", "Distribution", "Clicks", "Redirections"].join(", ")})
                </div>
                <div style={S.checkGroup}>
                  {extraMetrics.map((m) => (
                    <span
                      key={m}
                      style={S.checkChip(form.selectedExtraMetrics.includes(m))}
                      onClick={() => toggleExtraMetric(m)}
                    >
                      {form.selectedExtraMetrics.includes(m) ? "✓ " : ""}{m}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        <div style={{ marginTop: 16 }}>
          <button
            style={{ ...S.btn("primary"), opacity: submitting ? 0.6 : 1 }}
            onClick={handleSubmit}
            disabled={submitting}
          >
            {submitting ? "Creating…" : "📡 Create Publisher Report"}
          </button>
        </div>
      </div>

      {/* ── Existing Reports ── */}
      <div style={S.card}>
        <div style={S.sectionTitle}>📋 Existing Publisher Reports</div>

        {loadingReports ? (
          <div style={{ color: "#9ca3af", fontSize: 13 }}>Loading reports…</div>
        ) : reports.length === 0 ? (
          <div style={{ color: "#9ca3af", fontSize: 13 }}>No publisher reports yet. Create one above!</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={S.table}>
              <thead>
                <tr>
                  {["Report Name", "Publisher", "Advertisers", "Date Range", "Reporting Level",
                    "Created Date", "Last Refreshed", "Actions"].map((h) => (
                    <th key={h} style={S.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => {
                  const advNames = Array.isArray(r.advertisers)
                    ? r.advertisers.map((a) => (typeof a === "string" ? a : a.name))
                    : [];
                  return (
                    <tr key={r.id}>
                      <td style={S.td}>
                        <a href={r.spreadsheetUrl} target="_blank" rel="noopener noreferrer"
                          style={{ color: "#2563eb", textDecoration: "none", fontWeight: 600 }}>
                          {r.reportName} ↗
                        </a>
                      </td>
                      <td style={S.td}>{r.publisher}</td>
                      <td style={S.td}>
                        {advNames.slice(0, 3).map((n) => (
                          <span key={n} style={{ ...S.chip("blue"), display: "inline-block", marginRight: 3, marginBottom: 2 }}>
                            {n}
                          </span>
                        ))}
                        {advNames.length > 3 && (
                          <span style={{ fontSize: 11, color: "#9ca3af" }}>+{advNames.length - 3} more</span>
                        )}
                      </td>
                      <td style={S.td}>
                        {r.dateFrom && r.dateFrom !== "All"
                          ? `${r.dateFrom}${r.dateTo ? ` → ${r.dateTo}` : " →"}`
                          : "All time"}
                      </td>
                      <td style={S.td}>
                        {(r.reportingLevels || []).map((l) => (
                          <span key={l} style={{
                            display: "inline-block", padding: "2px 8px", borderRadius: 10,
                            background: "#eff6ff", color: "#2563eb", fontSize: 11, marginRight: 4
                          }}>{l}</span>
                        ))}
                      </td>
                      <td style={S.td}>{r.createdDate ? r.createdDate.slice(0, 10) : "—"}</td>
                      <td style={S.td}>{r.lastRefreshed ? r.lastRefreshed.slice(0, 16) : "—"}</td>
                      <td style={S.td}>
                        <div style={{ display: "flex", gap: 6 }}>
                          <a href={r.spreadsheetUrl} target="_blank" rel="noopener noreferrer">
                            <button style={S.btnSm("primary")}>↗ Open</button>
                          </a>
                          <button
                            style={{ ...S.btnSm("success"), opacity: refreshingId === r.id ? 0.6 : 1 }}
                            onClick={() => handleRefresh(r.id)}
                            disabled={refreshingId === r.id}
                          >
                            {refreshingId === r.id ? "…" : "🔄"}
                          </button>
                          <button
                            style={{ ...S.btnSm("danger"), opacity: deletingId === r.id ? 0.6 : 1 }}
                            onClick={() => handleDelete(r.id, r.reportName)}
                            disabled={deletingId === r.id}
                          >
                            🗑️
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
