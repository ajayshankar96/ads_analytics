import React, { useState, useEffect } from "react";
import { getAdvertiserHealth } from "../api";

const s = {
  card: { background: "#fff", borderRadius: 8, padding: 16, boxShadow: "0 1px 4px rgba(0,0,0,0.07)", marginBottom: 12 },
  controls: { display: "flex", gap: 8, marginBottom: 16 },
  viewBtn: { padding: "5px 14px", border: "1px solid #d1d5db", borderRadius: 4, cursor: "pointer", fontSize: 12, background: "#f9fafb" },
  viewBtnActive: { background: "#2563eb", color: "#fff", borderColor: "#2563eb" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { background: "#f8fafc", padding: "8px 10px", textAlign: "left", fontWeight: 600, color: "#64748b", fontSize: 11, borderBottom: "1px solid #e2e8f0", textTransform: "uppercase" },
  td: { padding: "8px 10px", borderBottom: "1px solid #f1f5f9", color: "#1e293b" },
  loading: { textAlign: "center", padding: 40, color: "#888" },
  badge: { display: "inline-block", padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 600 },
  up: { color: "#10b981" },
  down: { color: "#ef4444" },
  neutral: { color: "#94a3b8" },
  summaryGrid: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 16 },
  summaryCard: { background: "#fff", borderRadius: 8, padding: "12px 16px", boxShadow: "0 1px 4px rgba(0,0,0,0.07)", textAlign: "center" },
  summaryNum: { fontSize: 28, fontWeight: 700 },
  summaryLabel: { fontSize: 12, color: "#888", marginTop: 4 },
};

function fmt(n) {
  if (!n && n !== 0) return "—";
  if (n >= 1e7) return `${(n / 1e7).toFixed(1)}Cr`;
  if (n >= 1e5) return `${(n / 1e5).toFixed(1)}L`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toLocaleString();
}

function Change({ pct }) {
  if (pct === null || pct === undefined) return <span style={s.neutral}>—</span>;
  const style = pct > 0 ? s.up : pct < 0 ? s.down : s.neutral;
  return <span style={style}>{pct > 0 ? "▲" : "▼"} {Math.abs(pct)}%</span>;
}

export default function AdvertiserHealth() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState("weekly");

  useEffect(() => {
    setLoading(true);
    getAdvertiserHealth(viewMode)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [viewMode]);

  if (loading) return <div style={s.loading}>Loading advertiser health…</div>;
  const advertisers = data?.advertisers || [];
  const active = advertisers.filter(a => a.status === "active").length;

  return (
    <div>
      <div style={s.controls}>
        {["weekly", "monthly", "mtd"].map((v) => (
          <button key={v} style={{ ...s.viewBtn, ...(viewMode === v ? s.viewBtnActive : {}) }} onClick={() => setViewMode(v)}>
            {v.toUpperCase()}
          </button>
        ))}
      </div>

      <div style={s.summaryGrid}>
        <div style={s.summaryCard}>
          <div style={{ ...s.summaryNum, color: "#2563eb" }}>{advertisers.length}</div>
          <div style={s.summaryLabel}>Total Advertisers</div>
        </div>
        <div style={s.summaryCard}>
          <div style={{ ...s.summaryNum, color: "#10b981" }}>{active}</div>
          <div style={s.summaryLabel}>Active This Period</div>
        </div>
        <div style={s.summaryCard}>
          <div style={{ ...s.summaryNum, color: "#f59e0b" }}>{advertisers.length - active}</div>
          <div style={s.summaryLabel}>No Activity</div>
        </div>
      </div>

      <div style={s.card}>
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>Advertiser</th>
              <th style={s.th}>Status</th>
              <th style={s.th}>Impressions (curr)</th>
              <th style={s.th}>vs Prior</th>
              <th style={s.th}>Clicks (curr)</th>
              <th style={s.th}>vs Prior</th>
              <th style={s.th}>Spends (curr)</th>
              <th style={s.th}>vs Prior</th>
              <th style={s.th}>QL (curr)</th>
              <th style={s.th}>vs Prior</th>
            </tr>
          </thead>
          <tbody>
            {advertisers.map((a, i) => (
              <tr key={i} style={{ background: a.status === "inactive" ? "#fafafa" : "#fff" }}>
                <td style={{ ...s.td, fontWeight: 600 }}>{a.advertiser}</td>
                <td style={s.td}>
                  <span style={{
                    ...s.badge,
                    background: a.status === "active" ? "#d1fae5" : "#f3f4f6",
                    color: a.status === "active" ? "#065f46" : "#6b7280",
                  }}>
                    {a.status}
                  </span>
                </td>
                <td style={s.td}>{fmt(a.current.impressions)}</td>
                <td style={s.td}><Change pct={a.change.impressions} /></td>
                <td style={s.td}>{fmt(a.current.clicks)}</td>
                <td style={s.td}><Change pct={a.change.clicks} /></td>
                <td style={s.td}>₹{fmt(a.current.spends)}</td>
                <td style={s.td}><Change pct={a.change.spends} /></td>
                <td style={s.td}>{fmt(a.current.ql)}</td>
                <td style={s.td}><Change pct={a.change.ql} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
