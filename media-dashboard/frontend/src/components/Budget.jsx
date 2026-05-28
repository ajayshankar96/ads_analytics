import React, { useState, useEffect } from "react";
import { getBudget } from "../api";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from "recharts";

const s = {
  card: { background: "#fff", borderRadius: 8, padding: 16, boxShadow: "0 1px 4px rgba(0,0,0,0.07)", marginBottom: 12 },
  controls: { display: "flex", gap: 10, marginBottom: 16, alignItems: "center" },
  select: { border: "1px solid #d1d5db", borderRadius: 5, padding: "5px 8px", fontSize: 13 },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { background: "#f8fafc", padding: "8px 10px", textAlign: "left", fontWeight: 600, color: "#64748b", fontSize: 11, borderBottom: "1px solid #e2e8f0", textTransform: "uppercase" },
  td: { padding: "8px 10px", borderBottom: "1px solid #f1f5f9", color: "#1e293b" },
  loading: { textAlign: "center", padding: 40, color: "#888" },
  label: { fontSize: 11, color: "#888", fontWeight: 600 },
  progressBg: { background: "#e5e7eb", borderRadius: 4, height: 8, marginTop: 2 },
  progressBar: { height: 8, borderRadius: 4, transition: "width 0.3s" },
  sectionTitle: { fontSize: 15, fontWeight: 700, color: "#1e293b", marginBottom: 12 },
};

function fmt(n) {
  if (!n && n !== 0) return "—";
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(1)}Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)}L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
  return `₹${n.toLocaleString()}`;
}

function UtilBar({ pct }) {
  const color = pct > 90 ? "#ef4444" : pct > 70 ? "#f59e0b" : "#10b981";
  return (
    <div style={{ minWidth: 80 }}>
      <div style={{ fontSize: 11, marginBottom: 2, color }}>{pct}%</div>
      <div style={s.progressBg}>
        <div style={{ ...s.progressBar, width: `${Math.min(pct, 100)}%`, background: color }} />
      </div>
    </div>
  );
}

export default function Budget() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState("");

  useEffect(() => {
    setLoading(true);
    getBudget({ month: selectedMonth || undefined })
      .then((d) => {
        setData(d);
        if (!selectedMonth && d.selectedMonth) setSelectedMonth(d.selectedMonth);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [selectedMonth]);

  if (loading) return <div style={s.loading}>Loading budget data…</div>;
  if (!data) return <div style={s.loading}>No data</div>;

  const { advertiserLevel = [], publisherLevel = [], availableMonths = [] } = data;

  return (
    <div>
      <div style={s.controls}>
        <span style={s.label}>Month:</span>
        <select style={s.select} value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)}>
          {availableMonths.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>

      {/* Chart */}
      {advertiserLevel.length > 0 && (
        <div style={s.card}>
          <div style={s.sectionTitle}>MTD Spends vs Budget by Advertiser</div>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={advertiserLevel.slice(0, 12)} margin={{ top: 5, right: 10, left: 10, bottom: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="advertiser" tick={{ fontSize: 10 }} angle={-25} textAnchor="end" interval={0} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => v >= 1e5 ? `${(v / 1e5).toFixed(0)}L` : v} />
              <Tooltip formatter={(v) => fmt(v)} />
              <Legend />
              <Bar dataKey="mtdSpends" name="MTD Spends" fill="#2563eb" radius={[3, 3, 0, 0]} />
              <Bar dataKey="totalBudget" name="Total Budget" fill="#e5e7eb" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Advertiser table */}
      <div style={s.card}>
        <div style={s.sectionTitle}>Advertiser Budget Tracker</div>
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>Advertiser</th>
              <th style={s.th}>MTD Spends</th>
              <th style={s.th}>Total Budget</th>
              <th style={s.th}>Remaining</th>
              <th style={s.th}>Utilization</th>
            </tr>
          </thead>
          <tbody>
            {advertiserLevel.map((row, i) => (
              <tr key={i}>
                <td style={{ ...s.td, fontWeight: 600 }}>{row.advertiser}</td>
                <td style={s.td}>{fmt(row.mtdSpends || row.spends)}</td>
                <td style={s.td}>{row.totalBudget ? fmt(row.totalBudget) : "—"}</td>
                <td style={s.td}>{row.budgetRemaining ? fmt(row.budgetRemaining) : "—"}</td>
                <td style={s.td}>
                  {row.totalBudget ? <UtilBar pct={row.budgetUtilization} /> : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
