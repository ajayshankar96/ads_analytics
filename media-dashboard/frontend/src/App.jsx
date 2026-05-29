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
import { getFilters, getHealth, refreshCache } from "./api";

const TABS = [
  { id: "dashboard",    label: "📊 Dashboard" },
  { id: "adv-perf",     label: "🏢 Advertiser Performance" },
  { id: "pub-perf",     label: "📡 Publisher Performance" },
  { id: "adv-health",   label: "❤️ Advertiser Health" },
  { id: "freshness",    label: "🕐 Data Freshness" },
  { id: "budget",       label: "💰 Budget" },
  { id: "monthly",      label: "📅 Monthly Spend" },
  { id: "kpis",         label: "🎯 Global KPIs" },
];

const styles = {
  app: { minHeight: "100vh", background: "#f5f5f5" },
  header: {
    background: "linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%)",
    color: "#fff",
    padding: "12px 24px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
  },
  headerTitle: { fontSize: 20, fontWeight: 700, letterSpacing: 0.5 },
  headerSub: { fontSize: 12, opacity: 0.8, marginTop: 2 },
  cacheInfo: { fontSize: 11, opacity: 0.75, textAlign: "right" },
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
      case "dashboard":    return <Dashboard {...props} />;
      case "adv-perf":     return <AdvertiserPerformance {...props} />;
      case "pub-perf":     return <PublisherPerformance {...props} />;
      case "adv-health":   return <AdvertiserHealth />;
      case "freshness":    return <DataFreshness />;
      case "budget":       return <Budget />;
      case "monthly":      return <MonthlySpend />;
      case "kpis":         return <GlobalKPIs />;
      default:             return null;
    }
  };

  return (
    <div style={styles.app}>
      {/* Header */}
      <header style={styles.header}>
        <div>
          <div style={styles.headerTitle}>Razorpay Media Network Dashboard</div>
          <div style={styles.headerSub}>Advertising Analytics Platform</div>
        </div>
        <div style={styles.cacheInfo}>
          {apiStatus === "error" ? (
            <span style={{ color: "#fca5a5" }}>⚠ Backend unreachable — is uvicorn running?</span>
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

      {/* Tab bar */}
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

      {/* Filter bar (shown on most tabs) */}
      {!["freshness", "kpis"].includes(activeTab) && (
        <FilterBar
          options={filterOptions}
          filters={filters}
          onChange={handleFilterChange}
        />
      )}

      {/* Content */}
      <main style={styles.content}>
        {error && <div style={styles.errorBanner}>Error: {error}</div>}
        {renderTab()}
      </main>

      {/* Chatbot */}
      <ChatBot />
    </div>
  );
}
