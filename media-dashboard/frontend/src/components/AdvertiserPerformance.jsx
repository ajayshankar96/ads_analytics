import React, { useState, useEffect, useRef } from "react";
import { getAdvertiserPerformance, getFilters } from "../api";

function MultiSelect({ options, value, onChange, placeholder = "All" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const toggle = (v) => {
    onChange(value.includes(v) ? value.filter(x => x !== v) : [...value, v]);
  };

  const label = value.length === 0 ? placeholder
    : value.length === 1 ? value[0]
    : `${value.length} selected`;

  return (
    <div ref={ref} style={{ position: "relative", minWidth: 200 }}>
      <div
        onClick={() => setOpen(!open)}
        style={{
          border: "1px solid #d1d5db", borderRadius: 5, padding: "5px 10px",
          fontSize: 13, cursor: "pointer", background: "#fff", userSelect: "none",
          display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8,
        }}
      >
        <span style={{ color: value.length ? "#1e293b" : "#9ca3af" }}>{label}</span>
        <span style={{ fontSize: 10, color: "#6b7280" }}>{open ? "▲" : "▼"}</span>
      </div>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 999,
          background: "#fff", border: "1px solid #e2e8f0", borderRadius: 6,
          boxShadow: "0 4px 16px rgba(0,0,0,0.12)", minWidth: "100%", maxHeight: 260,
          overflowY: "auto",
        }}>
          {value.length > 0 && (
            <div
              onClick={() => { onChange([]); setOpen(false); }}
              style={{ padding: "7px 12px", fontSize: 12, color: "#ef4444", cursor: "pointer", borderBottom: "1px solid #f1f5f9", fontWeight: 600 }}
            >
              ✕ Clear all
            </div>
          )}
          {options.map(opt => (
            <label key={opt} style={{
              display: "flex", alignItems: "center", gap: 8, padding: "7px 12px",
              cursor: "pointer", fontSize: 13, background: value.includes(opt) ? "#eff6ff" : "#fff",
            }}>
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
  indent1: { paddingLeft: 24 },
  indent2: { paddingLeft: 48 },
  loading: { textAlign: "center", padding: 40, color: "#888" },
  badge: { display: "inline-block", padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 600 },
  viewBtns: { display: "flex", gap: 6 },
  viewBtn: { padding: "4px 12px", border: "1px solid #d1d5db", borderRadius: 4, cursor: "pointer", fontSize: 12, background: "#f9fafb" },
  viewBtnActive: { background: "#2563eb", color: "#fff", borderColor: "#2563eb" },
};

function fmt(n) {
  if (n === undefined || n === null || n === "N/A") return "—";
  if (typeof n === "string") return n;
  if (n >= 1e7) return `${(n / 1e7).toFixed(1)}Cr`;
  if (n >= 1e5) return `${(n / 1e5).toFixed(1)}L`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toLocaleString();
}

function AdvRow({ adv, depth = 0 }) {
  const [open, setOpen] = useState(depth === 0);
  const indent = depth === 0 ? {} : depth === 1 ? { paddingLeft: 24 } : { paddingLeft: 48 };
  const bg = depth === 0 ? "#f8fafc" : depth === 1 ? "#fff" : "#fafafa";

  const hasChildren = (adv.publishers || adv.advertisers || adv.segments || []).length > 0;
  const children = adv.publishers || adv.advertisers || adv.segments || [];
  const childKey = adv.publishers ? "publishers" : adv.advertisers ? "advertisers" : "segments";

  return (
    <>
      <tr style={{ background: bg, cursor: hasChildren ? "pointer" : "default" }}
          onClick={() => hasChildren && setOpen(!open)}>
        <td style={{ ...s.td, ...indent, fontWeight: depth === 0 ? 700 : depth === 1 ? 600 : 400 }}>
          {hasChildren && (
            <span style={s.expandBtn}>{open ? "▼" : "▶"}</span>
          )}
          {adv.name}
        </td>
        <td style={s.td}>{fmt(adv.impressions)}</td>
        <td style={s.td}>{fmt(adv.clicks)}</td>
        <td style={s.td}>{adv.ctr}%</td>
        <td style={s.td}>₹{fmt(adv.spends)}</td>
        <td style={s.td}>{adv.cpm ? `₹${adv.cpm}` : "—"}</td>
        <td style={s.td}>{fmt(adv.ql)}</td>
        <td style={s.td}>{adv.cpql ? `₹${adv.cpql}` : "—"}</td>
      </tr>
      {open && children.map((child, i) => (
        <AdvRow key={i} adv={child} depth={depth + 1} />
      ))}
    </>
  );
}

export default function AdvertiserPerformance({ filters }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState("weekly");
  const [selectedAdv, setSelectedAdv] = useState([]);
  const [advOptions, setAdvOptions] = useState([]);

  useEffect(() => {
    getFilters().then(f => setAdvOptions(f.advertisers || [])).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    getAdvertiserPerformance({
      // merge in-tab advertiser selection with the global filter bar
      advertisers: [...new Set([...(selectedAdv || []), ...(filters.advertiser || [])])],
      publishers: filters.publisher || [],
      segments: filters.segment || [],
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      viewMode,
    })
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [filters, viewMode, selectedAdv]);

  if (loading) return <div style={s.loading}>Loading advertiser performance…</div>;
  const advertisers = data?.advertisers || [];

  return (
    <div>
      <div style={s.controls}>
        <div style={s.viewBtns}>
          {["weekly", "monthly", "mtd"].map((v) => (
            <button
              key={v}
              style={{ ...s.viewBtn, ...(viewMode === v ? s.viewBtnActive : {}) }}
              onClick={() => setViewMode(v)}
            >
              {v.toUpperCase()}
            </button>
          ))}
        </div>
        <MultiSelect
          options={advOptions}
          value={selectedAdv}
          onChange={setSelectedAdv}
          placeholder="All Advertisers"
        />
      </div>

      {advertisers.length === 0 ? (
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
                <th style={s.th}>CPQL</th>
              </tr>
            </thead>
            <tbody>
              {advertisers.map((adv, i) => (
                <AdvRow key={i} adv={adv} depth={0} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
