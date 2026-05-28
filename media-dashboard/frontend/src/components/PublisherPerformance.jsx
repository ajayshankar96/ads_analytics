import React, { useState, useEffect } from "react";
import { getPublisherPerformance, getFilters } from "../api";

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

function fmt(n) {
  if (n === undefined || n === null) return "—";
  if (n >= 1e7) return `${(n / 1e7).toFixed(1)}Cr`;
  if (n >= 1e5) return `${(n / 1e5).toFixed(1)}L`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toLocaleString();
}

function PubRow({ item, depth = 0 }) {
  const [open, setOpen] = useState(depth === 0);
  const indent = { paddingLeft: depth * 24 };
  const bg = depth === 0 ? "#f8fafc" : depth === 1 ? "#fff" : "#fafafa";
  const children = item.advertisers || item.segments || [];
  const hasChildren = children.length > 0;

  return (
    <>
      <tr style={{ background: bg, cursor: hasChildren ? "pointer" : "default" }}
          onClick={() => hasChildren && setOpen(!open)}>
        <td style={{ ...s.td, ...indent, fontWeight: 700 - depth * 100 }}>
          {hasChildren && <span style={s.expandBtn}>{open ? "▼" : "▶"}</span>}
          {item.name}
        </td>
        <td style={s.td}>{fmt(item.impressions)}</td>
        <td style={s.td}>{fmt(item.clicks)}</td>
        <td style={s.td}>{item.ctr}%</td>
        <td style={s.td}>₹{fmt(item.spends)}</td>
        <td style={s.td}>{item.cpm ? `₹${item.cpm}` : "—"}</td>
        <td style={s.td}>{fmt(item.ql)}</td>
        <td style={s.td}>{fmt(item.qqg)}</td>
      </tr>
      {open && children.map((child, i) => (
        <PubRow key={i} item={child} depth={depth + 1} />
      ))}
    </>
  );
}

export default function PublisherPerformance({ filters }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState("weekly");
  const [selectedPub, setSelectedPub] = useState([]);
  const [pubOptions, setPubOptions] = useState([]);

  useEffect(() => {
    getFilters().then(f => setPubOptions(f.publishers || [])).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    getPublisherPerformance({
      publishers: selectedPub,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      viewMode,
    })
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [filters, viewMode, selectedPub]);

  if (loading) return <div style={s.loading}>Loading publisher performance…</div>;
  const publishers = data?.publishers || [];

  return (
    <div>
      <div style={s.controls}>
        <div style={s.viewBtns}>
          {["weekly", "monthly", "mtd"].map((v) => (
            <button key={v} style={{ ...s.viewBtn, ...(viewMode === v ? s.viewBtnActive : {}) }} onClick={() => setViewMode(v)}>
              {v.toUpperCase()}
            </button>
          ))}
        </div>
        <select multiple value={selectedPub} style={{ ...s.select, height: 34 }}
          onChange={(e) => setSelectedPub(Array.from(e.target.selectedOptions).map(o => o.value))}>
          {pubOptions.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        {selectedPub.length > 0 && (
          <button style={{ ...s.viewBtn, fontSize: 11 }} onClick={() => setSelectedPub([])}>
            Clear ({selectedPub.length})
          </button>
        )}
      </div>

      {publishers.length === 0 ? (
        <div style={s.loading}>No data for selected filters</div>
      ) : (
        <div style={s.card}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Name</th>
                <th style={s.th}>Impressions</th>
                <th style={s.th}>Clicks</th>
                <th style={s.th}>CTR</th>
                <th style={s.th}>Spends</th>
                <th style={s.th}>CPM</th>
                <th style={s.th}>QL</th>
                <th style={s.th}>QQG</th>
              </tr>
            </thead>
            <tbody>
              {publishers.map((pub, i) => <PubRow key={i} item={pub} depth={0} />)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
