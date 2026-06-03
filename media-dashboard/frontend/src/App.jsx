import React, { useState, useEffect, useCallback } from "react";
import Dashboard from "./components/Dashboard";
import AdvertiserPerformance from "./components/AdvertiserPerformance";
import PublisherPerformance from "./components/PublisherPerformance";
import AdvertiserHealth from "./components/AdvertiserHealth";
import DataFreshness from "./components/DataFreshness";
import Budget from "./components/Budget";
import MonthlySpend from "./components/MonthlySpend";
import GlobalKPIs from "./components/GlobalKPIs";
import FilterBar from "./components/FilterBar";
import ChatBot from "./components/ChatBot";
import CampaignOnboarding from "./components/CampaignOnboarding";
import AdvertiserReporting from "./components/AdvertiserReporting";
import PublisherReporting from "./components/PublisherReporting";
import { getFilters, getHealth, refreshCache, recordView, getViewStats } from "./api";

const TABS = [
  { id: "dashboard",        label: "📊 Dashboard" },
  { id: "adv-perf",         label: "🏢 Advertiser Performance" },
  { id: "pub-perf",         label: "📡 Publisher Performance" },
  { id: "adv-health",       label: "❤️ Advertiser Health" },
  { id: "freshness",        label: "🕐 Data Freshness" },
  { id: "budget",           label: "💰 Budget" },
  { id: "monthly",          label: "📅 Monthly Spend" },
  { id: "kpis",             label: "🎯 Global KPIs" },
  { id: "onboarding",       label: "📋 Campaign Onboarding" },
  { id: "adv-reporting",    label: "📈 Advertiser Reporting" },
  { id: "pub-reporting",    label: "📉 Publisher Reporting" },
];

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
  app: { minHeight: "100vh", background: "#f5f5f5" },
  header: {
    background: "linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%)",
    color: "#fff",
    padding: "10px 24px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
    gap: 16,
  },
  headerLeft: { flexShrink: 0 },
  headerTitle: { fontSize: 18, fontWeight: 700, letterSpacing: 0.5 },
  headerSub: { fontSize: 11, opacity: 0.75, marginTop: 1 },

  // ── Stats strip (centre of header) ────────────────────────────────
  statsStrip: {
    display: "flex",
    alignItems: "center",
    gap: 0,
    flex: 1,
    justifyContent: "center",
    borderLeft: "1px solid rgba(255,255,255,0.15)",
    borderRight: "1px solid rgba(255,255,255,0.15)",
    padding: "0 16px",
    overflowX: "auto",
  },
  statsLabel: {
    fontSize: 9,
    fontWeight: 800,
    color: "rgba(255,255,255,0.5)",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginRight: 14,
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    gap: 5,
  },
  statItem: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    padding: "4px 12px",
    borderRight: "1px solid rgba(255,255,255,0.1)",
    flexShrink: 0,
    minWidth: 52,
  },
  statItemLast: {
    borderRight: "none",
  },
  statLabel: {
    fontSize: 8,
    fontWeight: 700,
    color: "rgba(255,255,255,0.5)",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginBottom: 2,
    whiteSpace: "nowrap",
  },
  statValue: {
    fontSize: 15,
    fontWeight: 700,
    color: "#fff",
    lineHeight: 1,
  },

  // ── Right side (cache / refresh) ──────────────────────────────────
  cacheInfo: { fontSize: 11, opacity: 0.75, textAlign: "right", flexShrink: 0 },
  refreshBtn: {
    background: "rgba(255,255,255,0.15)",
    border: "1px solid rgba(255,255,255,0.3)",
    color: "#fff",
    padding: "4px 10px",
    borderRadius: 4,
    cursor: "pointer",
    fontSize: 12,
    marginTop: 4,
  },

  tabBar: {
    background: "#fff",
    borderBottom: "1px solid #e0e0e0",
    display: "flex",
    overflowX: "auto",
    padding: "0 16px",
    boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
  },
  tab: {
    padding: "12px 18px",
    border: "none",
    background: "none",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 500,
    color: "#555",
    borderBottom: "3px solid transparent",
    whiteSpace: "nowrap",
    transition: "all 0.15s",
  },
  tabActive: { color: "#2563eb", borderBottom: "3px solid #2563eb", fontWeight: 700 },
  content: { padding: "20px 24px" },
  errorBanner: {
    background: "#fee2e2",
    border: "1px solid #fca5a5",
    borderRadius: 6,
    padding: "12px 16px",
    marginBottom: 16,
    color: "#dc2626",
    fontSize: 13,
  },
};

export default function App() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [filters, setFilters] = useState({});
  const [filterOptions, setFilterOptions] = useState({});
  const [apiStatus, setApiStatus] = useState("unknown");
  const [cacheAge, setCacheAge] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [viewStats, setViewStats] = useState(null);

  // Check API health on mount
  useEffect(() => {
    getHealth()
      .then((h) => {
        setApiStatus(h.cache);
        setCacheAge(h.cacheAgeSecs);
        setError(null);
      })
      .catch(() => setApiStatus("error"));
  }, []);

  // Load filter options
  useEffect(() => {
    getFilters()
      .then(setFilterOptions)
      .catch((e) => console.error("Filter load error:", e));
  }, []);

  // Record this view and fetch stats
  useEffect(() => {
    recordView().catch(() => {});
    getViewStats()
      .then(setViewStats)
      .catch(() => {});
  }, []);

  const handleRefreshCache = async () => {
    setRefreshing(true);
    try {
      await refreshCache();
      const h = await getHealth();
      setApiStatus(h.cache);
      setCacheAge(h.cacheAgeSecs);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setRefreshing(false);
    }
  };

  const handleFilterChange = useCallback((newFilters) => {
    setFilters(newFilters);
  }, []);

  const renderTab = () => {
    const props = { filters };
    switch (activeTab) {
      case "dashboard":      return <Dashboard {...props} />;
      case "adv-perf":       return <AdvertiserPerformance {...props} />;
      case "pub-perf":       return <PublisherPerformance {...props} />;
      case "adv-health":     return <AdvertiserHealth />;
      case "freshness":      return <DataFreshness />;
      case "budget":         return <Budget />;
      case "monthly":        return <MonthlySpend />;
      case "kpis":           return <GlobalKPIs />;
      case "onboarding":     return <CampaignOnboarding filterOptions={filterOptions} />;
      case "adv-reporting":  return <AdvertiserReporting filterOptions={filterOptions} />;
      case "pub-reporting":  return <PublisherReporting filterOptions={filterOptions} />;
      default:               return null;
    }
  };

  return (
    <div style={styles.app}>
      {/* ── Header ── */}
      <header style={styles.header}>

        {/* Left: title */}
        <div style={styles.headerLeft}>
          <div style={styles.headerTitle}>Razorpay Media Network Dashboard</div>
          <div style={styles.headerSub}>Advertising Analytics Platform</div>
        </div>

        {/* Centre: view stats strip */}
        <div style={styles.statsStrip}>
          <div style={styles.statsLabel}>
            <span>📊</span> STATS
          </div>
          {STAT_ITEMS.map((item, idx) => (
            <div
              key={item.key}
              style={{
                ...styles.statItem,
                ...(idx === STAT_ITEMS.length - 1 ? styles.statItemLast : {}),
              }}
            >
              <div style={styles.statLabel}>{item.label}</div>
              <div style={styles.statValue}>
                {viewStats === null
                  ? "—"
                  : (viewStats[item.key] ?? 0).toLocaleString()}
              </div>
            </div>
          ))}
        </div>

        {/* Right: cache status */}
        <div style={styles.cacheInfo}>
          {apiStatus === "error" ? (
            <span style={{ color: "#fca5a5" }}>⚠ Backend unreachable</span>
          ) : (
            <>
              Cache: {apiStatus === "warm" ? "🟢 warm" : "🟡 cold"}
              {cacheAge !== null && ` (${cacheAge}s ago)`}
            </>
          )}
          <br />
          <button
            style={styles.refreshBtn}
            onClick={handleRefreshCache}
            disabled={refreshing}
          >
            {refreshing ? "Refreshing…" : "⟳ Refresh Cache"}
          </button>
        </div>

      </header>

      {/* ── Tab bar ── */}
      <nav style={styles.tabBar}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            style={{ ...styles.tab, ...(activeTab === tab.id ? styles.tabActive : {}) }}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {/* ── Filter bar (shown on most tabs) ── */}
      {!["freshness", "kpis", "onboarding", "adv-reporting", "pub-reporting"].includes(activeTab) && (
        <FilterBar
          options={filterOptions}
          filters={filters}
          onChange={handleFilterChange}
        />
      )}

      {/* ── Content ── */}
      <main style={styles.content}>
        {error && <div style={styles.errorBanner}>Error: {error}</div>}
        {renderTab()}
      </main>

      {/* ── Chatbot ── */}
      <ChatBot />
    </div>
  );
}
