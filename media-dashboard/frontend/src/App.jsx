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

// ── Tab groups ────────────────────────────────────────────────────────────────
const TAB_GROUPS = [
  {
    label: "Analytics",
    color: "#2563eb",
    tabs: [
      { id: "dashboard",   label: "Dashboard",              icon: "📊" },
      { id: "adv-perf",    label: "Advertiser Performance", icon: "🏢" },
      { id: "pub-perf",    label: "Publisher Performance",  icon: "📡" },
      { id: "adv-health",  label: "Advertiser Health",      icon: "❤️" },
    ],
  },
  {
    label: "Data",
    color: "#0891b2",
    tabs: [
      { id: "freshness",   label: "Data Freshness",  icon: "🕐" },
      { id: "budget",      label: "Budget",          icon: "💰" },
      { id: "monthly",     label: "Monthly Spend",   icon: "📅" },
    ],
  },
  {
    label: "Manage",
    color: "#7c3aed",
    tabs: [
      { id: "kpis",        label: "Global KPIs",         icon: "🎯" },
      { id: "onboarding",  label: "Campaign Onboarding", icon: "📋" },
    ],
  },
  {
    label: "Reports",
    color: "#059669",
    tabs: [
      { id: "adv-reporting", label: "Advertiser Report", icon: "📈" },
      { id: "pub-reporting", label: "Publisher Report",  icon: "📉" },
    ],
  },
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

// ── Tab pill component ────────────────────────────────────────────────────────
function TabPill({ tab, active, groupColor, onClick }) {
  const [hovered, setHovered] = useState(false);

  const base = {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "6px 13px",
    borderRadius: 20,
    border: "none",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: active ? 600 : 500,
    whiteSpace: "nowrap",
    outline: "none",
    transition: "all 0.18s ease",
    letterSpacing: 0.1,
  };

  const activeStyle = {
    background: groupColor,
    color: "#fff",
    boxShadow: `0 2px 10px ${groupColor}55`,
    transform: "translateY(-1px)",
  };

  const hoveredStyle = {
    background: `${groupColor}14`,
    color: groupColor,
    transform: "translateY(-1px)",
  };

  const defaultStyle = {
    background: "transparent",
    color: "#64748b",
  };

  return (
    <button
      style={{
        ...base,
        ...(active ? activeStyle : hovered ? hoveredStyle : defaultStyle),
      }}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span style={{ fontSize: 13, lineHeight: 1 }}>{tab.icon}</span>
      {tab.label}
    </button>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const S = {
  app: { minHeight: "100vh", background: "#f1f5f9" },

  // Header
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

  // Stats strip
  statsStrip: {
    display: "flex",
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    borderLeft: "1px solid rgba(255,255,255,0.15)",
    borderRight: "1px solid rgba(255,255,255,0.15)",
    padding: "0 16px",
    overflowX: "auto",
    gap: 0,
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

  // Cache
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

  // Tab bar
  tabBar: {
    background: "#fff",
    borderBottom: "2px solid #e8edf5",
    display: "flex",
    alignItems: "center",
    padding: "6px 20px",
    gap: 2,
    overflowX: "auto",
    boxShadow: "0 2px 6px rgba(0,0,0,0.05)",
  },

  // Group separator
  separator: {
    width: 1,
    height: 22,
    background: "#e2e8f0",
    margin: "0 8px",
    flexShrink: 0,
  },

  // Group label
  groupLabel: {
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: 1,
    textTransform: "uppercase",
    padding: "0 4px 0 2px",
    flexShrink: 0,
  },

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

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [filters, setFilters] = useState({});
  const [filterOptions, setFilterOptions] = useState({});
  const [apiStatus, setApiStatus] = useState("unknown");
  const [cacheAge, setCacheAge] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [viewStats, setViewStats] = useState(null);

  useEffect(() => {
    getHealth()
      .then((h) => { setApiStatus(h.cache); setCacheAge(h.cacheAgeSecs); setError(null); })
      .catch(() => setApiStatus("error"));
  }, []);

  useEffect(() => {
    getFilters()
      .then(setFilterOptions)
      .catch((e) => console.error("Filter load error:", e));
  }, []);

  useEffect(() => {
    recordView()
      .catch(() => {})
      .finally(() => {
        getViewStats().then(setViewStats).catch(() => {});
      });
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

  const handleFilterChange = useCallback((newFilters) => setFilters(newFilters), []);

  const NO_FILTER_TABS = new Set(["freshness", "kpis", "onboarding", "adv-reporting", "pub-reporting"]);

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
    <div style={S.app}>
      {/* ── Header ── */}
      <header style={S.header}>
        <div style={S.headerLeft}>
          <div style={S.headerTitle}>Razorpay Media Network Dashboard</div>
          <div style={S.headerSub}>Advertising Analytics Platform</div>
        </div>

        {/* Stats strip */}
        <div style={S.statsStrip}>
          <div style={S.statsLabel}><span>📊</span> STATS</div>
          {STAT_ITEMS.map((item, idx) => (
            <div
              key={item.key}
              style={{ ...S.statItem, ...(idx === STAT_ITEMS.length - 1 ? { borderRight: "none" } : {}) }}
            >
              <div style={S.statLabel}>{item.label}</div>
              <div style={S.statValue}>
                {viewStats === null ? "—" : (viewStats[item.key] ?? 0).toLocaleString()}
              </div>
            </div>
          ))}
        </div>

        {/* Cache status */}
        <div style={S.cacheInfo}>
          {apiStatus === "error"
            ? <span style={{ color: "#fca5a5" }}>⚠ Backend unreachable</span>
            : <>{apiStatus === "warm" ? "🟢" : "🟡"} Cache {apiStatus === "warm" ? "warm" : "cold"}
                {cacheAge !== null && ` · ${cacheAge}s ago`}</>
          }
          <br />
          <button style={S.refreshBtn} onClick={handleRefreshCache} disabled={refreshing}>
            {refreshing ? "Refreshing…" : "⟳ Refresh Cache"}
          </button>
        </div>
      </header>

      {/* ── Tab bar ── */}
      <nav style={S.tabBar}>
        {TAB_GROUPS.map((group, gi) => (
          <React.Fragment key={group.label}>
            {/* Group separator (not before first group) */}
            {gi > 0 && <div style={S.separator} />}

            {/* Group label */}
            <span style={{ ...S.groupLabel, color: group.color }}>
              {group.label}
            </span>

            {/* Tabs */}
            {group.tabs.map((tab) => (
              <TabPill
                key={tab.id}
                tab={tab}
                active={activeTab === tab.id}
                groupColor={group.color}
                onClick={() => setActiveTab(tab.id)}
              />
            ))}
          </React.Fragment>
        ))}
      </nav>

      {/* ── Filter bar ── */}
      {!NO_FILTER_TABS.has(activeTab) && (
        <FilterBar options={filterOptions} filters={filters} onChange={handleFilterChange} />
      )}

      {/* ── Content ── */}
      <main style={S.content}>
        {error && <div style={S.errorBanner}>Error: {error}</div>}
        {renderTab()}
      </main>

      {/* ── Chatbot ── */}
      <ChatBot />
    </div>
  );
}
