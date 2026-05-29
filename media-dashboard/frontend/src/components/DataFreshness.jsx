import React, { useState, useEffect } from "react";
import { getDataFreshness } from "../api";

const STATUS_CARDS = [
  { key: "upToDateCount",          label: "UP TO DATE",               bg: "#22c55e", icon: "✓" },
  { key: "publisherOutdatedCount", label: "PUBLISHER DATA OUTDATED",   bg: "#f97316", icon: "!" },
  { key: "advertiserOutdatedCount",label: "ADVERTISER DATA OUTDATED",  bg: "#f59e0b", icon: "!" },
  { key: "bothOutdatedCount",      label: "BOTH OUTDATED",             bg: "#ef4444", icon: "✕" },
];

const BADGE = {
  up_to_date:           { bg: "#dcfce7", color: "#166534", label: "Up to Date" },
  publisher_outdated:   { bg: "#ffedd5", color: "#9a3412", label: "Publisher Outdated" },
  advertiser_outdated:  { bg: "#fef9c3", color: "#854d0e", label: "Advertiser Outdated" },
  both_outdated:        { bg: "#fee2e2", color: "#991b1b", label: "Both Outdated" },
};

export default function DataFreshness() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState({});

  const load = () => {
    setLoading(true);
    getDataFreshness()
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const toggle = (d) => setExpanded(p => ({ ...p, [d]: !p[d] }));

  if (loading) return <div style={{ textAlign: "center", padding: 40, color: "#888" }}>Loading data freshness…</div>;
  if (!data)   return <div style={{ textAlign: "center", padding: 40, color: "#888" }}>No data</div>;

  return (
    <div>
      {/* ── Header ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16, color: "#1e293b" }}>
            Advertiser Data Freshness Monitoring
          </div>
          {!loading && (
            <div style={{ fontSize: 12, color: "#16a34a", marginTop: 2 }}>✓ Fresh data (just computed)</div>
          )}
        </div>
        <button
          onClick={load}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 7, border: "1px solid #e2e8f0", background: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 500 }}
        >
          ↻ Refresh Status
        </button>
      </div>

      {/* ── 4 status cards ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 28 }}>
        {STATUS_CARDS.map(({ key, label, bg, icon }) => (
          <div key={key} style={{ background: bg, borderRadius: 10, padding: "20px 18px", display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{
              background: "rgba(255,255,255,0.28)", borderRadius: 8, minWidth: 42, height: 42,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 20, color: "#fff", fontWeight: 800,
            }}>
              {icon}
            </div>
            <div>
              <div style={{ fontSize: 34, fontWeight: 800, color: "#fff", lineHeight: 1 }}>{data[key] ?? 0}</div>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.92)", fontWeight: 700, marginTop: 5, textTransform: "uppercase", letterSpacing: 0.5 }}>
                {label}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Breakdown by date ── */}
      <div style={{ fontWeight: 700, fontSize: 14, color: "#1e293b", marginBottom: 10 }}>
        Last Updated Date — Advertiser Breakdown{" "}
        <span style={{ fontWeight: 400, color: "#94a3b8", fontSize: 12 }}>(Click to expand)</span>
      </div>

      {(data.byDate || []).map(({ date: d, advertisers }) => (
        <div key={d} style={{ border: "1px solid #e2e8f0", borderRadius: 8, marginBottom: 8, overflow: "hidden", background: "#fff" }}>
          <div
            onClick={() => toggle(d)}
            style={{ padding: "11px 16px", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, userSelect: "none" }}
          >
            <span style={{ fontSize: 9, color: "#64748b", marginTop: 1 }}>{expanded[d] ? "▼" : "▶"}</span>
            <span style={{ fontWeight: 700, fontSize: 13, color: "#1e293b" }}>{d}</span>
            <span style={{ color: "#94a3b8", fontSize: 12 }}>
              [{advertisers.length} advertiser{advertisers.length !== 1 ? "s" : ""}]
            </span>
          </div>

          {expanded[d] && (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#f8fafc" }}>
                  {["Advertiser", "Publisher Last Date", "Advertiser Last Date", "Status"].map(h => (
                    <th key={h} style={{ padding: "7px 16px", textAlign: "left", color: "#64748b", fontWeight: 600, fontSize: 11, textTransform: "uppercase", borderTop: "1px solid #e2e8f0" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {advertisers.map((a, i) => {
                  const b = BADGE[a.status] || { bg: "#f1f5f9", color: "#64748b", label: a.status };
                  return (
                    <tr key={i} style={{ borderTop: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "7px 16px", fontWeight: 600, color: "#1e293b" }}>{a.advertiser}</td>
                      <td style={{ padding: "7px 16px", color: "#475569" }}>{a.pubLastDate}</td>
                      <td style={{ padding: "7px 16px", color: "#475569" }}>{a.advLastDate}</td>
                      <td style={{ padding: "7px 16px" }}>
                        <span style={{ display: "inline-block", padding: "2px 10px", borderRadius: 10, fontSize: 11, fontWeight: 600, background: b.bg, color: b.color }}>
                          {b.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      ))}

      <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 8 }}>
        Computed at: {data.computedAt ? new Date(data.computedAt).toLocaleString() : "—"}
      </div>
    </div>
  );
}
