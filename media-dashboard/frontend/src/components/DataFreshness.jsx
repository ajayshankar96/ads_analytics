import React, { useState, useEffect } from "react";
import { getDataFreshness } from "../api";

const s = {
  card: { background: "#fff", borderRadius: 8, padding: 16, boxShadow: "0 1px 4px rgba(0,0,0,0.07)", marginBottom: 12 },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { background: "#f8fafc", padding: "8px 10px", textAlign: "left", fontWeight: 600, color: "#64748b", fontSize: 11, borderBottom: "1px solid #e2e8f0", textTransform: "uppercase" },
  td: { padding: "8px 10px", borderBottom: "1px solid #f1f5f9", color: "#1e293b" },
  loading: { textAlign: "center", padding: 40, color: "#888" },
  summaryGrid: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 },
  summaryCard: { background: "#fff", borderRadius: 8, padding: "12px 16px", boxShadow: "0 1px 4px rgba(0,0,0,0.07)", textAlign: "center" },
  summaryNum: { fontSize: 28, fontWeight: 700 },
  summaryLabel: { fontSize: 12, color: "#888", marginTop: 4 },
  badge: { display: "inline-block", padding: "2px 10px", borderRadius: 10, fontSize: 11, fontWeight: 600 },
};

const STATUS_STYLES = {
  fresh: { background: "#d1fae5", color: "#065f46" },
  warning: { background: "#fef3c7", color: "#92400e" },
  stale: { background: "#fee2e2", color: "#991b1b" },
};

export default function DataFreshness() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getDataFreshness()
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={s.loading}>Loading data freshness…</div>;
  if (!data) return <div style={s.loading}>No data</div>;

  const { advertisers = [], freshCount = 0, warningCount = 0, staleCount = 0, totalAdvertisers = 0 } = data;

  return (
    <div>
      <div style={s.summaryGrid}>
        <div style={s.summaryCard}>
          <div style={{ ...s.summaryNum, color: "#2563eb" }}>{totalAdvertisers}</div>
          <div style={s.summaryLabel}>Total Advertisers</div>
        </div>
        <div style={s.summaryCard}>
          <div style={{ ...s.summaryNum, color: "#10b981" }}>{freshCount}</div>
          <div style={s.summaryLabel}>🟢 Fresh (≤1 day)</div>
        </div>
        <div style={s.summaryCard}>
          <div style={{ ...s.summaryNum, color: "#f59e0b" }}>{warningCount}</div>
          <div style={s.summaryLabel}>🟡 Warning (2–3 days)</div>
        </div>
        <div style={s.summaryCard}>
          <div style={{ ...s.summaryNum, color: "#ef4444" }}>{staleCount}</div>
          <div style={s.summaryLabel}>🔴 Stale (&gt;3 days)</div>
        </div>
      </div>

      <div style={s.card}>
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>Advertiser</th>
              <th style={s.th}>Last Data Date</th>
              <th style={s.th}>Days Stale</th>
              <th style={s.th}>Status</th>
            </tr>
          </thead>
          <tbody>
            {advertisers.map((a, i) => (
              <tr key={i}>
                <td style={{ ...s.td, fontWeight: 600 }}>{a.advertiser}</td>
                <td style={s.td}>{a.lastDate}</td>
                <td style={s.td}>{a.daysStale}</td>
                <td style={s.td}>
                  <span style={{ ...s.badge, ...STATUS_STYLES[a.status] }}>
                    {a.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 8 }}>
        Computed at: {data.computedAt ? new Date(data.computedAt).toLocaleString() : "—"}
      </div>
    </div>
  );
}
