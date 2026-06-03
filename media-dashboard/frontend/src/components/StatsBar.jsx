import React, { useEffect, useState } from "react";
import { recordView, getViewStats } from "../api";

const STAT_ITEMS = [
  { key: "today",       label: "TODAY" },
  { key: "yesterday",   label: "YESTERDAY" },
  { key: "thisWeek",    label: "THIS WEEK" },
  { key: "lastWeek",    label: "LAST WEEK" },
  { key: "thisMonth",   label: "THIS MONTH" },
  { key: "lastMonth",   label: "LAST MONTH" },
  { key: "thisYear",    label: "THIS YEAR" },
  { key: "uniqueViews", label: "UNIQUE VIEWS" },
  { key: "total",       label: "TOTAL" },
];

const styles = {
  bar: {
    background: "#0f1923",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    padding: "0 16px",
    overflowX: "auto",
    flexShrink: 0,
    borderBottom: "1px solid #1e2d3d",
    minHeight: 48,
    gap: 0,
  },
  label: {
    fontSize: 10,
    fontWeight: 700,
    color: "#5b8db8",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    display: "flex",
    alignItems: "center",
    gap: 4,
    whiteSpace: "nowrap",
  },
  icon: {
    fontSize: 13,
    color: "#5b8db8",
    marginRight: 6,
  },
  statsLabel: {
    fontSize: 10,
    fontWeight: 700,
    color: "#5b8db8",
    letterSpacing: 1,
    padding: "0 14px 0 0",
    display: "flex",
    alignItems: "center",
    gap: 6,
    whiteSpace: "nowrap",
    borderRight: "1px solid #1e3a5f",
    marginRight: 6,
  },
  item: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    padding: "8px 14px",
    borderRight: "1px solid #1a2a3a",
    minWidth: 70,
    flexShrink: 0,
  },
  itemLabel: {
    fontSize: 9,
    fontWeight: 700,
    color: "#5b8db8",
    letterSpacing: 0.5,
    marginBottom: 2,
    whiteSpace: "nowrap",
  },
  itemValue: {
    fontSize: 16,
    fontWeight: 700,
    color: "#ffffff",
    lineHeight: 1,
  },
  itemValueSmall: {
    fontSize: 13,
    fontWeight: 700,
    color: "#ffffff",
    lineHeight: 1,
  },
  loading: {
    fontSize: 11,
    color: "#5b8db8",
    padding: "0 12px",
  },
};

export default function StatsBar() {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    // Record this page view and fetch stats
    recordView().catch(() => {});
    getViewStats()
      .then(setStats)
      .catch(() => {});
  }, []);

  return (
    <div style={styles.bar}>
      {/* Label */}
      <div style={styles.statsLabel}>
        <span style={{ fontSize: 14 }}>📊</span>
        STATS
      </div>

      {stats === null ? (
        <div style={styles.loading}>Loading view stats…</div>
      ) : (
        STAT_ITEMS.map((item, idx) => (
          <div key={item.key} style={styles.item}>
            <div style={styles.itemLabel}>{item.label}</div>
            <div style={item.key === "total" || item.key === "thisYear" ? styles.itemValueSmall : styles.itemValue}>
              {(stats[item.key] ?? 0).toLocaleString()}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
