import React, { useState, useEffect, useRef } from "react";
import { getPublisherPerformance, getFilters } from "../api";
import MetricsManager, { buildColumns, formatCell } from "./MetricsManager";

// Built-in columns (order = display order). Users can hide these or add
// custom ones via the ⚙ Metrics modal; the effective list comes back from
// the API as `metric_config` and is merged by buildColumns().
// NB: the old static header mislabelled adv_spends/pub_spends as
// "Spends"/"CPM" — corrected here.
const BUILTIN_COLUMNS = [
  { key: "impressions", label: "Impressions", fmt: "number", delta: true },
  { key: "clicks", label: "Clicks / Redirections", fmt: "number", delta: true },
  { key: "ctr", label: "CTR", fmt: "percent", delta: true },
  { key: "adv_spends", label: "Adv Spends", fmt: "currency", delta: true },
  { key: "pub_spends", label: "Pub Spends", fmt: "currency", delta: true },
  { key: "ql", label: "QL", fmt: "number", delta: true },
  { key: "qqg", label: "QQG", fmt: "number", delta: true },
  { key: "revenue", label: "Revenue", fmt: "currency", delta: true },
  { key: "goal", label: "Goal", fmt: "goal", delta: false },
  { key: "roas", label: "ROAS", fmt: "multiple", delta: false },
  { key: "cac", label: "CAC", fmt: "currency", delta: false },
];

function MultiSelect({ options, value, onChange, placeholder = "All" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);
  const toggle = (v) => onChange(value.includes(v) ? value.filter(x => x !== v) : [...value, v]);
  const label = value.length === 0 ? placeholder : value.length === 1 ? value[0] : `${value.length} selected`;
  return (
    <div ref={ref} style={{ position: "relative", minWidth: 200 }}>
      <div onClick={() => setOpen(!open)} style={{ border: "1px solid #d1d5db", borderRadius: 5, padding: "5px 10px", fontSize: 13, cursor: "pointer", background: "#fff", userSelect: "none", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span style={{ color: value.length ? "#1e293b" : "#9ca3af" }}>{label}</span>
        <span style={{ fontSize: 10, color: "#6b7280" }}>{open ? "▲" : "▼"}</span>
      </div>
      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 999, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 6, boxShadow: "0 4px 16px rgba(0,0,0,0.12)", minWidth: "100%", maxHeight: 260, overflowY: "auto" }}>
          {value.length > 0 && <div onClick={() => { onChange([]); setOpen(false); }} style={{ padding: "7px 12px", fontSize: 12, color: "#ef4444", cursor: "pointer", borderBottom: "1px solid #f1f5f9", fontWeight: 600 }}>✕ Clear all</div>}
          {options.map(opt => (
            <label key={opt} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", cursor: "pointer", fontSize: 13, background: value.includes(opt) ? "#eff6ff" : "#fff" }}>
              <input type="checkbox" checked={value.includes(opt)} onChange={() => toggle(opt)} style={{ cursor: "pointer" }} />
              {opt}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

const s = {
  card: { background: "#fff", borderRadius: 8, padding: 16, boxShadow: "0 1px 4px rgba(0,0,0,0.07)", marginBottom: 12 },
  controls: { display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap", alignItems: "center" },
  select: { border: "1px solid #d1d5db", borderRadius: 5, padding: "5px 8px", fontSize: 13, minWidth: 180 },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { background: "#f8fafc", padding: "8px 10px", textAlign: "left", fontWeight: 600, color: "#64748b", fontSize: 11, borderBottom: "1px solid #e2e8f0", textTransform: "uppercase" },
  td: { padding: "8px 10px", borderBottom: "1px solid #f1f5f9", color: "#1e293b" },
  expandBtn: { background: "none", border: "none", cursor: "pointer", fontSize: 14, marginRight: 6 },
  loading: { textAlign: "center", padding: 40, color: "#888" },
  viewBtns: { display: "flex", gap: 6 },
  viewBtn: { padding: "4px 12px", border: "1px solid #d1d5db", borderRadius: 4, cursor: "pointer", fontSize: 12, background: "#f9fafb" },
  viewBtnActive: { background: "#2563eb", color: "#fff", borderColor: "#2563eb" },
};

const VIEW_TOOLTIPS = {
  weekly: "Current week — Monday to today",
  monthly: "Current month — 1st to today",
  mtd: "Month-to-date — 1st to today",
};

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d)) return iso;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function PeriodLabel({ period, compare }) {
  if (!period) return null;
  const range = period.start && period.end ? ` · ${fmtDate(period.start)} – ${fmtDate(period.end)}` : "";
  const cmp = compare && compare.start && compare.end
    ? <span style={{ color: "#94a3b8" }}>{"   vs   "}{fmtDate(compare.start)} – {fmtDate(compare.end)}</span>
    : null;
  return (
    <div style={{ fontSize: 12, color: "#64748b", margin: "0 0 12px 2px" }}>
      📅 Showing <b style={{ color: "#334155" }}>{period.label}</b>{range}{cmp}
    </div>
  );
}

function Delta({ pct }) {
  if (pct === null || pct === undefined) return null;
  const up = pct >= 0;
  return (
    <span style={{ marginLeft: 5, fontSize: 10, fontWeight: 700, color: up ? "#059669" : "#dc2626", whiteSpace: "nowrap" }}>
      {up ? "▲" : "▼"}{Math.abs(pct)}%
    </span>
  );
}

const RAG_COLORS = { GREEN: "#0F8C6A", AMBER: "#B7791F", RED: "#C8321E" };

// Red/Amber/Green chip vs the advertiser's brand goal (only on advertiser rows).
function RagBadge({ status, goal }) {
  if (!status) return null;
  const col = RAG_COLORS[status] || "#64748b";
  const title = goal
    ? (goal.goal_type === "CAC"
        ? `Goal: CAC ≤ ₹${goal.target_cac}`
        : `Goal: ROAS ≥ ${goal.target_roas}x`)
    : "";
  return (
    <span title={title} style={{
      marginLeft: 8, padding: "1px 7px", borderRadius: 10, fontSize: 10, fontWeight: 800,
      letterSpacing: ".03em", color: "#fff", background: col, verticalAlign: "middle",
    }}>{status}</span>
  );
}

function PubRow({ item, columns, depth = 0 }) {
  const [open, setOpen] = useState(depth === 0);
  const indent = { paddingLeft: depth * 24 };
  const bg = depth === 0 ? "#f8fafc" : depth === 1 ? "#fff" : depth === 2 ? "#fafafa" : "#f4f6f8";
  // Hierarchy: publisher → advertisers → segments → offers.
  const children = item.advertisers || item.segments || item.offers || [];
  const hasChildren = children.length > 0;

  return (
    <>
      <tr style={{ background: bg, cursor: hasChildren ? "pointer" : "default" }}
          onClick={() => hasChildren && setOpen(!open)}>
        <td style={{ ...s.td, ...indent, fontWeight: 700 - depth * 100 }}>
          {hasChildren && <span style={s.expandBtn}>{open ? "▼" : "▶"}</span>}
          {item.name}
          <RagBadge status={item.rag} goal={item.goal} />
        </td>
        {columns.map((col) => (
          <td key={col.key} style={col.fmt === "goal" ? { ...s.td, whiteSpace: "nowrap", color: "#64748b" } : s.td}>
            {formatCell(item, col)}
            {col.delta && <Delta pct={item.deltas?.[col.key]} />}
          </td>
        ))}
      </tr>
      {open && children.map((child, i) => (
        <PubRow key={i} item={child} columns={columns} depth={depth + 1} />
      ))}
    </>
  );
}

export default function PublisherPerformance({ filters, userRole }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState("weekly");
  const [selectedPub, setSelectedPub] = useState([]);
  const [pubOptions, setPubOptions] = useState([]);
  const [compare, setCompare] = useState(false);
  const [comparePeriods, setComparePeriods] = useState(1);
  const [showMetricsMgr, setShowMetricsMgr] = useState(false);
  const [reload, setReload] = useState(0); // bumped after a metric-config save

  useEffect(() => {
    getFilters().then(f => setPubOptions(f.publishers || [])).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    getPublisherPerformance({
      // merge in-tab publisher selection with the global filter bar
      publishers: [...new Set([...(selectedPub || []), ...(filters.publisher || [])])],
      advertisers: filters.advertiser || [],
      segments: filters.segment || [],
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      viewMode,
      compare,
      comparePeriods,
    })
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [filters, viewMode, selectedPub, compare, comparePeriods, reload]);

  if (loading) return <div style={s.loading}>Loading publisher performance…</div>;
  const publishers = data?.publishers || [];
  const columns = buildColumns(BUILTIN_COLUMNS, data?.metric_config);
  const canManageMetrics = ["CREATOR", "ADMIN", "OPS"].includes(userRole);

  return (
    <div>
      <div style={s.controls}>
        <div style={s.viewBtns}>
          {["weekly", "monthly", "mtd"].map((v) => (
            <button key={v} title={VIEW_TOOLTIPS[v]} style={{ ...s.viewBtn, ...(viewMode === v ? s.viewBtnActive : {}) }} onClick={() => setViewMode(v)}>
              {v.toUpperCase()}
            </button>
          ))}
        </div>
        <MultiSelect options={pubOptions} value={selectedPub} onChange={setSelectedPub} placeholder="All Publishers" />
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer", color: "#334155" }}>
          <input type="checkbox" checked={compare} onChange={e => setCompare(e.target.checked)} />
          Compare vs previous
        </label>
        {compare && (
          <select value={comparePeriods} onChange={e => setComparePeriods(Number(e.target.value))} style={s.select}>
            <option value={1}>vs last period</option>
            <option value={2}>vs 2 periods ago</option>
            <option value={3}>vs 3 periods ago</option>
          </select>
        )}
        {canManageMetrics && (
          <button
            title="Add, remove or hide metrics on this table"
            style={{ ...s.viewBtn, marginLeft: "auto", display: "flex", alignItems: "center", gap: 5 }}
            onClick={() => setShowMetricsMgr(true)}
          >
            ⚙ Metrics
          </button>
        )}
      </div>

      {data?.period && <PeriodLabel period={data.period} compare={data.compare} />}

      {publishers.length === 0 ? (
        <div style={s.loading}>No data for selected filters</div>
      ) : (
        <div style={s.card}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Name</th>
                {columns.map((col) => (
                  <th key={col.key} style={s.th}>{col.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {publishers.map((pub, i) => <PubRow key={i} item={pub} columns={columns} depth={0} />)}
            </tbody>
          </table>
        </div>
      )}

      {showMetricsMgr && (
        <MetricsManager
          scope="publisher"
          builtins={BUILTIN_COLUMNS}
          onClose={() => setShowMetricsMgr(false)}
          onSaved={() => setReload((r) => r + 1)}
        />
      )}
    </div>
  );
}
