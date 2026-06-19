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
import SalesPipeline from "./components/SalesPipeline";
import CampaignOps from "./components/CampaignOps";
import BudgetAllocation from "./components/BudgetAllocation";
import CampaignTracking from "./components/CampaignTracking";
import { getFilters, getHealth, refreshCache, recordView, getViewStats, getConsoleAccess, getMyRole, setDataSource as setDataSourceApi } from "./api";
import QueryConsole from "./components/QueryConsole";
import RoleManager from "./components/RoleManager";

// ── Tab groups (Option C layout) ──────────────────────────────────────────────
const TAB_GROUPS = [
  {
    label: "Workflow",
    color: "#db2777",
    tabs: [
      { id: "sales",  label: "Sales Pipeline",     icon: "🤝" },
      { id: "pub-allocation", label: "Budget Allocation", icon: "💰" },
      { id: "ops",    label: "Campaign Ops",      icon: "🚦" },
      { id: "tracking", label: "Campaign Success & Tracking", icon: "📊" },
    ],
  },
  {
    label: "Analytics",
    color: "#2563eb",
    tabs: [
      { id: "dashboard",   label: "Dashboard",         icon: "📊" },
      {
        id: "performance", label: "Performance",        icon: "📈",
        children: [
          { id: "adv-perf", label: "Advertiser Performance", icon: "🏢" },
          { id: "pub-perf", label: "Publisher Performance",  icon: "📡" },
        ],
      },
      { id: "adv-health",  label: "Advertiser Health",  icon: "❤️" },
    ],
  },
  {
    label: "Data",
    color: "#0891b2",
    tabs: [
      { id: "freshness", label: "Data Freshness", icon: "🕐" },
      { id: "budget",    label: "Budget",         icon: "💰" },
      { id: "monthly",   label: "Monthly Spend",  icon: "📅" },
    ],
  },
  {
    label: "Manage",
    color: "#7c3aed",
    tabs: [
      { id: "kpis",       label: "Global KPIs",         icon: "🎯" },
      { id: "onboarding", label: "Campaign Onboarding", icon: "📋" },
      { id: "roles",      label: "User Roles",          icon: "🔑" },
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

const NO_FILTER = new Set([
  "freshness", "kpis", "onboarding", "adv-reporting", "pub-reporting", "sales", "ops", "pub-allocation", "tracking", "roles",
]);

// ── Tab pill ──────────────────────────────────────────────────────────────────
function TabPill({ tab, active, groupColor, onClick }) {
  const [hovered, setHovered] = useState(false);
  const hasChildren = !!(tab.children?.length);

  const style = {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "5px 12px",
    borderRadius: 16,
    border: "none",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: active ? 600 : 500,
    whiteSpace: "nowrap",
    outline: "none",
    transition: "all 0.18s ease",
    letterSpacing: 0.1,
    ...(active
      ? {
          background: groupColor,
          color: "#fff",
          boxShadow: `0 2px 10px ${groupColor}55`,
          transform: "translateY(-1px)",
        }
      : hovered
      ? {
          background: `${groupColor}14`,
          color: groupColor,
          transform: "translateY(-1px)",
        }
      : { background: "transparent", color: "#64748b" }),
  };

  return (
    <button
      style={style}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span style={{ fontSize: 12, lineHeight: 1 }}>{tab.icon}</span>
      {tab.label}
      {hasChildren && (
        <span style={{ fontSize: 9, opacity: 0.7, marginLeft: 1 }}>
          {active ? "▲" : "▼"}
        </span>
      )}
    </button>
  );
}

// ── Sub-tab pill (for Performance children) ───────────────────────────────────
function SubTabPill({ tab, active, groupColor, onClick }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "5px 14px",
        borderRadius: 16,
        border: active ? "none" : `1px solid ${groupColor}30`,
        cursor: "pointer",
        fontSize: 12,
        fontWeight: active ? 600 : 400,
        whiteSpace: "nowrap",
        outline: "none",
        transition: "all 0.15s ease",
        ...(active
          ? { background: `${groupColor}18`, color: groupColor, borderBottom: `2px solid ${groupColor}` }
          : hovered
          ? { background: `${groupColor}0c`, color: groupColor }
          : { background: "transparent", color: "#64748b" }),
      }}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span style={{ fontSize: 12 }}>{tab.icon}</span>
      {tab.label}
    </button>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const S = {
  app: { minHeight: "100vh", background: "#f1f5f9" },

  // Header — untouched height
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

  statsStrip: {
    display: "flex", alignItems: "center", flex: 1, justifyContent: "center",
    borderLeft: "1px solid rgba(255,255,255,0.15)",
    borderRight: "1px solid rgba(255,255,255,0.15)",
    padding: "0 16px", overflowX: "auto", gap: 0,
  },
  statsLabel: {
    fontSize: 9, fontWeight: 800, color: "rgba(255,255,255,0.5)",
    letterSpacing: 1.2, textTransform: "uppercase",
    marginRight: 14, flexShrink: 0, display: "flex", alignItems: "center", gap: 5,
  },
  statItem: {
    display: "flex", flexDirection: "column", alignItems: "center",
    padding: "4px 12px", borderRight: "1px solid rgba(255,255,255,0.1)",
    flexShrink: 0, minWidth: 52,
  },
  statLabel: {
    fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,0.5)",
    letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 2, whiteSpace: "nowrap",
  },
  statValue: { fontSize: 15, fontWeight: 700, color: "#fff", lineHeight: 1 },

  cacheInfo: { fontSize: 11, opacity: 0.75, textAlign: "right", flexShrink: 0 },
  refreshBtn: {
    background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.3)",
    color: "#fff", padding: "4px 10px", borderRadius: 4, cursor: "pointer", fontSize: 12, marginTop: 4,
  },

  // ── Option C tab bar ────────────────────────────────────────────────────────
  tabBar: {
    background: "#fff",
    display: "flex",
    alignItems: "stretch",
    overflowX: "auto",
    boxShadow: "0 2px 6px rgba(0,0,0,0.07)",
    borderBottom: "1px solid #e2e8f0",
  },
  // Each group column — centred
  groupSection: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    flexShrink: 0,
    borderRight: "1px solid #f0f4f8",
    paddingBottom: 7,
  },
  // Full-width accent bar (no side margins)
  groupAccent: {
    height: 4,
    width: "100%",
    borderRadius: "0 0 4px 4px",
    flexShrink: 0,
  },
  // Group label — larger font, centred
  groupLabelRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    padding: "5px 16px 3px 16px",
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: 0.9,
    textTransform: "uppercase",
    width: "100%",
  },
  groupDot: {
    width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
  },
  // Tab pills — centred within section
  groupTabs: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    padding: "2px 10px 0 10px",
  },

  // Sub-tab bar (for Performance dropdown)
  subTabBar: {
    background: "#f8fafc",
    borderBottom: "1px solid #e2e8f0",
    display: "flex",
    alignItems: "center",
    padding: "5px 28px",
    gap: 4,
    overflowX: "auto",
  },
  subTabLabel: {
    fontSize: 10, fontWeight: 600, letterSpacing: 0.5,
    textTransform: "uppercase", marginRight: 8, flexShrink: 0,
  },

  content: { padding: "20px 24px" },
  errorBanner: {
    background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: 6,
    padding: "12px 16px", marginBottom: 16, color: "#dc2626", fontSize: 13,
  },
};

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [activeTab, setActiveTab]         = useState("dashboard");
  const [activeSubTab, setActiveSubTab]   = useState(null);
  const [filters, setFilters]             = useState({});
  const [filterOptions, setFilterOptions] = useState({});
  const [apiStatus, setApiStatus]         = useState("unknown");
  const [cacheAge, setCacheAge]           = useState(null);
  const [refreshing, setRefreshing]       = useState(false);
  const [error, setError]                 = useState(null);
  const [viewStats, setViewStats]         = useState(null);
  const [isAdmin, setIsAdmin]             = useState(false);
  const [showConsole, setShowConsole]     = useState(false);
  const [userRole, setUserRole]           = useState("VIEWER");
  const [userEmail, setUserEmail]         = useState("");
  const [showProfile, setShowProfile]     = useState(false);
  const [showCache, setShowCache]         = useState(false);
  const [dataSource, setDataSource]       = useState(() => {
    const saved = localStorage.getItem("dataSource");
    return saved === "sheet" ? "sheet" : "postgres";
  });

  useEffect(() => {
    getHealth()
      .then((h) => { setApiStatus(h.cache); setCacheAge(h.cacheAgeSecs); })
      .catch(() => setApiStatus("error"));
    getConsoleAccess().then((d) => setIsAdmin(!!d.is_admin)).catch(() => {});
    getMyRole().then((d) => { setUserRole(d.role || "VIEWER"); setUserEmail(d.email || ""); }).catch(() => {});
    // Sync data source preference to backend
    const savedSource = localStorage.getItem("dataSource") === "sheet" ? "sheet" : "postgres";
    setDataSourceApi(savedSource).catch(() => {});
  }, []);

  useEffect(() => {
    getFilters().then(setFilterOptions).catch(console.error);
  }, []);

  useEffect(() => {
    recordView().catch(() => {}).finally(() => {
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
    } catch (e) { setError(e.message); }
    finally { setRefreshing(false); }
  };

  const handleFilterChange = useCallback((f) => setFilters(f), []);

  const handleTabClick = (tab) => {
    setActiveTab(tab.id);
    if (tab.children?.length) {
      setActiveSubTab(tab.children[0].id);
    } else {
      setActiveSubTab(null);
    }
  };

  const effectiveTab = activeSubTab || activeTab;

  // Find active parent's children + color for sub-bar
  let activeParent = null;
  for (const group of TAB_GROUPS) {
    for (const tab of group.tabs) {
      if (tab.id === activeTab && tab.children?.length) {
        activeParent = { tab, color: group.color };
      }
    }
  }

  const renderContent = () => {
    const props = { filters, dataSource };
    switch (effectiveTab) {
      case "dashboard":      return <Dashboard {...props} />;
      case "adv-perf":       return <AdvertiserPerformance {...props} />;
      case "pub-perf":       return <PublisherPerformance {...props} />;
      case "adv-health":     return <AdvertiserHealth />;
      case "freshness":      return <DataFreshness />;
      case "budget":         return <Budget />;
      case "monthly":        return <MonthlySpend />;
      case "kpis":           return <GlobalKPIs />;
      case "onboarding":     return <CampaignOnboarding filterOptions={filterOptions} />;
      case "sales":          return <SalesPipeline userRole={userRole} />;
      case "ops":            return <CampaignOps userRole={userRole} />;
      case "pub-allocation": return <BudgetAllocation userRole={userRole} />;
      case "tracking":       return <CampaignTracking userRole={userRole} />;
      case "roles":          return <RoleManager />;
      case "adv-reporting":  return <AdvertiserReporting filterOptions={filterOptions} />;
      case "pub-reporting":  return <PublisherReporting filterOptions={filterOptions} />;
      case "performance":    return <AdvertiserPerformance {...props} />;
      default:               return null;
    }
  };

  return (
    <div style={S.app}>

      {/* ── Header (height unchanged) ── */}
      <header style={S.header}>
        <div style={S.headerLeft}>
          <div style={S.headerTitle}>Razorpay Media Network Dashboard</div>
          <div style={S.headerSub}>Advertising Analytics Platform</div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {/* Cache icon with dropdown */}
          <div style={{ position: "relative" }}>
            <div
              onClick={() => { setShowProfile(false); setShowCache(!showCache); }}
              style={{ width: 34, height: 34, borderRadius: 10, background: "rgba(255,255,255,0.12)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", border: "1.5px solid rgba(255,255,255,0.3)" }}
              title="Cache status"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
              </svg>
            </div>
            {showCache && (
              <div style={{ position: "absolute", top: 42, right: 0, background: "#fff", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.15)", padding: "14px 18px", minWidth: 220, zIndex: 9999 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#1e293b", marginBottom: 8 }}>Data Source</div>
                <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
                  {[["sheet", "Google Sheet"], ["postgres", "Postgres"]].map(([val, label]) => (
                    <button key={val} onClick={() => { setDataSource(val); localStorage.setItem("dataSource", val); setDataSourceApi(val).catch(() => {}); }}
                      style={{ flex: 1, padding: "6px 10px", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer", border: dataSource === val ? "2px solid #2563eb" : "1px solid #e5e7eb", background: dataSource === val ? "#EAF0FF" : "#fff", color: dataSource === val ? "#2563eb" : "#64748b" }}>
                      {label}
                    </button>
                  ))}
                </div>
                {dataSource === "sheet" && (
                  <>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#64748b", marginBottom: 4 }}>Sheet Cache</div>
                    <div style={{ fontSize: 13, color: "#334155", marginBottom: 6 }}>
                      {apiStatus === "error" ? <span style={{ color: "#dc2626" }}>⚠ Backend unreachable</span>
                        : <>{apiStatus === "warm" ? "🟢" : "🟡"} {apiStatus}{cacheAge !== null && ` · ${cacheAge}s ago`}</>}
                    </div>
                    <button style={{ ...S.refreshBtn, background: "#2563eb", color: "#fff", border: "none", width: "100%", borderRadius: 6, padding: "8px" }} onClick={() => { handleRefreshCache(); setShowCache(false); }} disabled={refreshing}>
                      {refreshing ? "Refreshing…" : "⟳ Refresh Cache"}
                    </button>
                  </>
                )}
                {dataSource === "postgres" && (
                  <div style={{ fontSize: 12, color: "#334155" }}>
                    🟢 Reading from Postgres (rmn_campaign_metrics)
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Profile icon with dropdown */}
          <div style={{ position: "relative" }}>
            <div
              onClick={() => { setShowCache(false); setShowProfile(!showProfile); }}
              style={{ width: 34, height: 34, borderRadius: "50%", background: "#2E5BFF", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 13, fontWeight: 800, color: "#fff", border: "2px solid rgba(255,255,255,0.5)" }}
            >
              {(userEmail || "?").substring(0, 2).toUpperCase()}
            </div>
            {showProfile && (
              <div style={{ position: "absolute", top: 42, right: 0, background: "#fff", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.15)", padding: "14px 18px", minWidth: 220, zIndex: 9999 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b" }}>{userEmail || "Not signed in"}</div>
                <div style={{ fontSize: 12, color: "#64748b", marginTop: 6, display: "flex", alignItems: "center", gap: 6 }}>
                  Role: <span style={{ background: "#EAF0FF", color: "#2E5BFF", padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 700 }}>{userRole}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ── Option C Tab bar ── */}
      <nav style={S.tabBar}>
        {TAB_GROUPS.map((group, gi) => (
          <div
            key={group.label}
            style={{
              ...S.groupSection,
              ...(gi === TAB_GROUPS.length - 1 ? { borderRight: "none" } : {}),
            }}
          >
            {/* Colored accent bar */}
            <div style={{ ...S.groupAccent, background: group.color }} />

            {/* Group label */}
            <div style={{ ...S.groupLabelRow, color: group.color }}>
              <div style={{ ...S.groupDot, background: group.color }} />
              {group.label}
            </div>

            {/* Tab pills */}
            <div style={S.groupTabs}>
              {group.tabs.filter((tab) => tab.id !== "roles" || userRole === "ADMIN").map((tab) => (
                <TabPill
                  key={tab.id}
                  tab={tab}
                  active={activeTab === tab.id}
                  groupColor={group.color}
                  onClick={() => handleTabClick(tab)}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* ── Sub-tab bar (Performance only) ── */}
      {activeParent && (
        <div style={S.subTabBar}>
          <span style={{ ...S.subTabLabel, color: activeParent.color }}>
            {activeParent.tab.label} →
          </span>
          {activeParent.tab.children.map((child) => (
            <SubTabPill
              key={child.id}
              tab={child}
              active={activeSubTab === child.id}
              groupColor={activeParent.color}
              onClick={() => setActiveSubTab(child.id)}
            />
          ))}
        </div>
      )}

      {/* ── Filter bar ── */}
      {!NO_FILTER.has(effectiveTab) && (
        <FilterBar options={filterOptions} filters={filters} onChange={handleFilterChange} />
      )}

      {/* ── Content ── */}
      <main style={S.content}>
        {error && <div style={S.errorBanner}>Error: {error}</div>}
        {renderContent()}
      </main>

      <ChatBot />

      {/* ── Admin query console (admins only) ── */}
      {isAdmin && (
        <button
          title="Query console"
          onClick={() => setShowConsole(true)}
          style={{ position: "fixed", bottom: 20, left: 20, width: 46, height: 46, borderRadius: 12,
            border: "none", background: "#0F1724", color: "#fff", fontSize: 20, cursor: "pointer",
            boxShadow: "0 4px 14px rgba(15,23,36,0.3)", zIndex: 9000 }}
        >🛢️</button>
      )}
      {showConsole && <QueryConsole onClose={() => setShowConsole(false)} />}
    </div>
  );
}
