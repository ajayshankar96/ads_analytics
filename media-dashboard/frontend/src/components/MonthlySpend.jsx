import React, { useState, useEffect } from "react";
import { getMonthlySpend } from "../api";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

const COLORS = ["#2563eb", "#10b981", "#f59e0b", "#ef4444"];

const s = {
  card: { background: "#fff", borderRadius: 8, padding: 16, boxShadow: "0 1px 4px rgba(0,0,0,0.07)", marginBottom: 12 },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { background: "#f8fafc", padding: "8px 10px", textAlign: "left", fontWeight: 600, color: "#64748b", fontSize: 11, borderBottom: "1px solid #e2e8f0", textTransform: "uppercase" },
  td: { padding: "8px 10px", borderBottom: "1px solid #f1f5f9", color: "#1e293b" },
  loading: { textAlign: "center", padding: 40, color: "#888" },
  sectionTitle: { fontSize: 15, fontWeight: 700, color: "#1e293b", marginBottom: 12 },
};

function fmt(n) {
  if (!n && n !== 0) return "—";
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(1)}Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)}L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
  return `₹${n.toLocaleString()}`;
}

export default function MonthlySpend() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getMonthlySpend()
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={s.loading}>Loading monthly spend…</div>;
  if (!data || !data.data) return <div style={s.loading}>No data</div>;

  const { data: rows, months } = data;

  // Build chart data: one entry per month, one bar per advertiser (top 8)
  const top8 = rows.slice(0, 8);
  const chartData = months.map((m) => {
    const entry = { month: m };
    top8.forEach((adv) => { entry[adv.advertiser] = adv[m] || 0; });
    return entry;
  });

  return (
    <div>
      {/* Stacked bar chart */}
      {chartData.length > 0 && (
        <div style={s.card}>
          <div style={s.sectionTitle}>Monthly Spends by Advertiser (Top 8)</div>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => v >= 1e5 ? `${(v / 1e5).toFixed(0)}L` : v} />
              <Tooltip formatter={(v) => fmt(v)} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {top8.map((adv, i) => (
                <Bar key={adv.advertiser} dataKey={adv.advertiser} stackId="a"
                  fill={COLORS[i % COLORS.length]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Table */}
      <div style={s.card}>
        <div style={s.sectionTitle}>Advertiser Monthly Spends</div>
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>Advertiser</th>
              {months.map((m) => <th key={m} style={s.th}>{m}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                <td style={{ ...s.td, fontWeight: 600 }}>{row.advertiser}</td>
                {months.map((m) => <td key={m} style={s.td}>{fmt(row[m])}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
