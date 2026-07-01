import React, { useState, useEffect, useMemo } from "react";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import {
  getDashboardAggregates,
  getDashboardTimeSeries,
  getDashboardBreakdowns,
  getPgAggregates,
  getPgTimeseries,
  getPgBreakdowns,
} from "../api";

const COLORS = ["#2563eb", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899"];

const s = {
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 20 },
  kpiCard: {
    background: "#fff",
    borderRadius: 8,
    padding: "14px 16px",
    boxShadow: "0 1px 4px rgba(0,0,0,0.07)",
  },
  kpiLabel: { fontSize: 11, color: "#888", textTransform: "uppercase", fontWeight: 600, marginBottom: 4 },
  kpiValue: { fontSize: 22, fontWeight: 700, color: "#1e293b" },
  kpiSub: { fontSize: 11, color: "#94a3b8", marginTop: 2 },
  card: {
    background: "#fff",
    borderRadius: 8,
    padding: "16px",
    boxShadow: "0 1px 4px rgba(0,0,0,0.07)",
    marginBottom: 16,
  },
  cardTitle: { fontSize: 14, fontWeight: 700, color: "#1e293b", marginBottom: 12 },
  row: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 },
  loading: { textAlign: "center", padding: 40, color: "#888" },
  groupBtns: { display: "flex", gap: 6, marginBottom: 12 },
  groupBtn: {
    padding: "4px 10px",
    border: "1px solid #d1d5db",
    borderRadius: 4,
    cursor: "pointer",
    fontSize: 12,
    background: "#f9fafb",
  },
  groupBtnActive: { background: "#2563eb", color: "#fff", borderColor: "#2563eb" },
};

function fmt(n) {
  if (n === undefined || n === null) return "—";
  if (typeof n === "string") return n;
  if (n >= 1e7) return `${(n / 1e7).toFixed(1)}Cr`;
  if (n >= 1e5) return `${(n / 1e5).toFixed(1)}L`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toLocaleString();
}

function KPICard({ label, value, sub }) {
  return (
    <div style={s.kpiCard}>
      <div style={s.kpiLabel}>{label}</div>
      <div style={s.kpiValue}>{value}</div>
      {sub && <div style={s.kpiSub}>{sub}</div>}
    </div>
  );
}

export default function Dashboard({ filters, dataSource = "sheet" }) {
  const [aggs, setAggs] = useState(null);
  const [series, setSeries] = useState(null);
  const [breakdowns, setBreakdowns] = useState(null);
  const [groupBy, setGroupBy] = useState("day");
  const [loading, setLoading] = useState(true);
  const [seriesMetric, setSeriesMetric] = useState("impressions");
  const [rangeKey, setRangeKey] = useState("90d"); // default: last 90 days

  const RANGES = [
    { key: "30d",  label: "30D",  days: 30 },
    { key: "90d",  label: "90D",  days: 90 },
    { key: "6m",   label: "6M",   days: 183 },
    { key: "all",  label: "All",  days: null },
  ];

  useEffect(() => {
    setLoading(true);
    const readAggregates = dataSource === "postgres" ? getPgAggregates : getDashboardAggregates;
    const readTimeSeries = dataSource === "postgres" ? getPgTimeseries : getDashboardTimeSeries;
    const readBreakdowns = dataSource === "postgres" ? getPgBreakdowns : getDashboardBreakdowns;
    Promise.all([
      readAggregates(filters),
      readTimeSeries({ ...filters, groupBy }),
      readBreakdowns(filters),
    ])
      .then(([a, ts, bd]) => {
        setAggs(a);
        setSeries(ts.timeSeries || []);
        setBreakdowns(bd.breakdowns || {});
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [filters, groupBy, dataSource]);

  // Filter series to selected date range
  const filteredSeries = useMemo(() => {
    if (!series) return [];
    const rangeDays = RANGES.find(r => r.key === rangeKey)?.days;
    if (!rangeDays) return series; // "All"
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - rangeDays);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    return series.filter(d => d.date >= cutoffStr);
  }, [series, rangeKey]);

  if (loading) return <div style={s.loading}>Loading dashboard…</div>;
  if (!aggs) return <div style={s.loading}>No data available.</div>;

  const METRICS = [
    { key: "impressions", label: "Impressions" },
    { key: "clicks", label: "Clicks" },
    { key: "spends", label: "Spends (₹)" },
    { key: "ql", label: "QL" },
    { key: "qqg", label: "QQG" },
    { key: "ctr", label: "CTR %" },
    { key: "cpm", label: "CPM ₹" },
    { key: "cpc", label: "CPC ₹" },
  ];

  return (
    <div>
      {/* KPI Cards */}
      <div style={s.grid}>
        <KPICard label="Imp + Distribution" value={fmt(aggs.impressionsAndDistribution)} sub={`Imp: ${fmt(aggs.impressions)} | Dist: ${fmt(aggs.distribution)}`} />
        <KPICard label="Clicks" value={fmt(aggs.clicks)} sub={`CTR: ${aggs.ctr}%`} />
        <KPICard label="Pub Spends" value={`₹${fmt(aggs.spends)}`} sub={`CPM: ₹${aggs.cpm}`} />
        {aggs.hasQL && <KPICard label="QL" value={fmt(aggs.ql)} sub={`CPQL: ₹${aggs.cpql}`} />}
        {aggs.hasQQG && <KPICard label="QQG" value={fmt(aggs.qqg)} sub={`CPQQG: ₹${aggs.cpqqg}`} />}
        {aggs.hasCouponOrders && <KPICard label="Coupon Orders" value={fmt(aggs.couponOrders)} />}
        <KPICard label="Adv Spends" value={`₹${fmt(aggs.advertiser_spends || aggs.advertiserSpends || 0)}`} />
        <KPICard label="Adv Revenue" value={`₹${fmt(aggs.advertiser_revenue || aggs.revenue || 0)}`} />
        <KPICard label="Advertisers" value={aggs.advertiserCount ?? "—"} sub={`${aggs.publisherCount ?? "—"} Publishers`} />
        <KPICard label="Data Rows" value={fmt(aggs.totalRows)} sub={`Cache: ${aggs.cacheAge}s ago`} />
      </div>

      {/* Time Series */}
      <div style={s.card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={s.cardTitle}>Time Series</div>
            <span style={{ fontSize: 11, color: "#94a3b8" }}>
              {filteredSeries.length} data points
            </span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {/* Range selector */}
            <div style={s.groupBtns}>
              {RANGES.map((r) => (
                <button
                  key={r.key}
                  style={{ ...s.groupBtn, ...(rangeKey === r.key ? s.groupBtnActive : {}) }}
                  onClick={() => setRangeKey(r.key)}
                >
                  {r.label}
                </button>
              ))}
            </div>
            {/* Group by */}
            <div style={s.groupBtns}>
              {["day", "week", "month"].map((g) => (
                <button
                  key={g}
                  style={{ ...s.groupBtn, ...(groupBy === g ? s.groupBtnActive : {}) }}
                  onClick={() => setGroupBy(g)}
                >
                  {g.charAt(0).toUpperCase() + g.slice(1)}
                </button>
              ))}
            </div>
            <select
              style={{ ...s.groupBtn, padding: "4px 8px" }}
              value={seriesMetric}
              onChange={(e) => setSeriesMetric(e.target.value)}
            >
              {METRICS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={filteredSeries} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => fmt(v)} />
            <Tooltip formatter={(v) => fmt(v)} />
            <Line
              type="monotone"
              dataKey={seriesMetric}
              stroke="#2563eb"
              dot={false}
              strokeWidth={2}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Breakdowns */}
      <div style={s.row}>
        <div style={s.card}>
          <div style={s.cardTitle}>By Advertiser</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart
              data={(breakdowns.byAdvertiser || []).slice(0, 10)}
              margin={{ top: 5, right: 10, left: 10, bottom: 40 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-25} textAnchor="end" interval={0} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={fmt} />
              <Tooltip formatter={(v) => fmt(v)} />
              <Bar dataKey="spends" fill="#2563eb" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div style={s.card}>
          <div style={s.cardTitle}>By Publisher</div>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie
                data={(breakdowns.byPublisher || []).slice(0, 8)}
                dataKey="spends"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={80}
                label={({ name, percent }) =>
                  percent > 0.05 ? `${name} (${(percent * 100).toFixed(0)}%)` : ""
                }
                labelLine={false}
              >
                {(breakdowns.byPublisher || []).slice(0, 8).map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(v) => `₹${fmt(v)}`} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Segment breakdown */}
      {breakdowns.bySegment && breakdowns.bySegment.length > 0 && (
        <div style={s.card}>
          <div style={s.cardTitle}>By Segment</div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart
              data={(breakdowns.bySegment || []).slice(0, 12)}
              margin={{ top: 5, right: 10, left: 10, bottom: 40 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-25} textAnchor="end" interval={0} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={fmt} />
              <Tooltip formatter={(v) => fmt(v)} />
              <Bar dataKey="impressions" fill="#10b981" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
