/**
 * API client — all calls go to /api/* which is proxied to localhost:8000 by CRA proxy.
 */

const BASE = "";  // CRA proxy handles it

async function apiFetch(path, options = {}) {
  const url = `${BASE}${path}`;
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json();
}

function buildQuery(params = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v === null || v === undefined || v === "") return;
    if (Array.isArray(v)) {
      v.forEach((item) => qs.append(k, item));
    } else {
      qs.append(k, v);
    }
  });
  const s = qs.toString();
  return s ? `?${s}` : "";
}

// Health
export const getHealth = () => apiFetch("/health");

// Filters
export const getFilters = (params = {}) =>
  apiFetch(`/api/filters${buildQuery(params)}`);

export const getFilterRelationships = () =>
  apiFetch("/api/filter-relationships");

// Dashboard
export const getDashboardAggregates = (filters = {}) =>
  apiFetch(`/api/dashboard/aggregates${buildQuery(filters)}`);

export const getDashboardTimeSeries = (filters = {}) =>
  apiFetch(`/api/dashboard/timeseries${buildQuery(filters)}`);

export const getDashboardBreakdowns = (filters = {}) =>
  apiFetch(`/api/dashboard/breakdowns${buildQuery(filters)}`);

export const getDashboardTable = (filters = {}, offset = 0, limit = 100) =>
  apiFetch(`/api/dashboard/table${buildQuery({ ...filters, offset, limit })}`);

// Performance
export const getAdvertiserPerformance = (params = {}) =>
  apiFetch(`/api/advertiser-performance${buildQuery(params)}`);

export const getPublisherPerformance = (params = {}) =>
  apiFetch(`/api/publisher-performance${buildQuery(params)}`);

// Health & Freshness
export const getAdvertiserHealth = (viewMode = "weekly") =>
  apiFetch(`/api/advertiser-health${buildQuery({ viewMode })}`);

export const getDataFreshness = () => apiFetch("/api/data-freshness");

// Analysis
export const getMonthlySpend = () => apiFetch("/api/monthly-spend");

export const getBudget = (params = {}) =>
  apiFetch(`/api/budget${buildQuery(params)}`);

// KPIs & Goals
export const getGoals = () => apiFetch("/api/goals");
export const getKPIs = () => apiFetch("/api/kpis");
export const createKPI = (payload) =>
  apiFetch("/api/kpis", { method: "POST", body: JSON.stringify(payload) });
export const deleteKPI = (id) =>
  apiFetch(`/api/kpis/${id}`, { method: "DELETE" });

// Cache
export const refreshCache = () =>
  apiFetch("/api/cache/refresh", { method: "POST" });
