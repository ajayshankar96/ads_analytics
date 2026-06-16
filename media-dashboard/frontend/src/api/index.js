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

// ── View Stats ────────────────────────────────────────────────────────────────
export const recordView = () =>
  apiFetch("/api/views/record", { method: "POST" });

export const getViewStats = () =>
  apiFetch("/api/views/stats");

// ── Advertiser Reporting ──────────────────────────────────────────────────────
export const getAdvertiserReports = () =>
  apiFetch("/api/reporting/advertiser/list");

export const getAdvertiserReportColumns = () =>
  apiFetch("/api/reporting/advertiser/columns");

export const createAdvertiserReport = (config) =>
  apiFetch("/api/reporting/advertiser/create", {
    method: "POST",
    body: JSON.stringify(config),
  });

export const refreshAdvertiserReport = (id) =>
  apiFetch(`/api/reporting/advertiser/refresh/${id}`, { method: "POST" });

export const deleteAdvertiserReport = (id) =>
  apiFetch(`/api/reporting/advertiser/${id}`, { method: "DELETE" });

export const refreshAllAdvertiserReports = () =>
  apiFetch("/api/reporting/advertiser/refresh-all", { method: "POST" });

// ── Publisher Reporting ───────────────────────────────────────────────────────
export const getPublisherReports = () =>
  apiFetch("/api/reporting/publisher/list");

export const getPublisherMetrics = () =>
  apiFetch("/api/reporting/publisher/metrics");

export const getPublisherAdvertisers = (publisher, dateFrom, dateTo) =>
  apiFetch(
    `/api/reporting/publisher/advertisers${buildQuery({ publisher, dateFrom, dateTo })}`
  );

export const createPublisherReport = (config) =>
  apiFetch("/api/reporting/publisher/create", {
    method: "POST",
    body: JSON.stringify(config),
  });

export const refreshPublisherReport = (id) =>
  apiFetch(`/api/reporting/publisher/refresh/${id}`, { method: "POST" });

export const deletePublisherReport = (id) =>
  apiFetch(`/api/reporting/publisher/${id}`, { method: "DELETE" });

// ── Admin query console ───────────────────────────────────────────────────────
export const getConsoleAccess = () => apiFetch("/api/admin/console-access");
export const listDbTables = () => apiFetch("/api/admin/tables");
export const runQuery = (sql) =>
  apiFetch("/api/admin/query", { method: "POST", body: JSON.stringify({ sql }) });

// ── Advertisers (onboarding wizard) ───────────────────────────────────────────
export const getAdvertisers = () => apiFetch("/api/advertisers");

export const getAdvertiser = (id) => apiFetch(`/api/advertisers/${id}`);

export const createAdvertiser = (payload) =>
  apiFetch("/api/advertisers", { method: "POST", body: JSON.stringify(payload) });

export const updateAdvertiser = (id, payload) =>
  apiFetch(`/api/advertisers/${id}`, { method: "PATCH", body: JSON.stringify(payload) });

export const submitAdvertiser = (id, payload = {}) =>
  apiFetch(`/api/advertisers/${id}/submit`, { method: "POST", body: JSON.stringify(payload) });

export const recordWelcomeEmail = (id, payload) =>
  apiFetch(`/api/advertisers/${id}/welcome-email`, { method: "POST", body: JSON.stringify(payload) });

// ── Sales pipeline (Dashboard 1) ──────────────────────────────────────────────
export const getLeads = (status) =>
  apiFetch(`/api/sales/leads${buildQuery({ status })}`);

export const createLead = (payload) =>
  apiFetch("/api/sales/leads", { method: "POST", body: JSON.stringify(payload) });

export const updateLead = (id, payload) =>
  apiFetch(`/api/sales/leads/${id}`, { method: "PATCH", body: JSON.stringify(payload) });

export const closeLead = (id, payload) =>
  apiFetch(`/api/sales/leads/${id}/close`, { method: "POST", body: JSON.stringify(payload) });

// ── Campaign Ops (Dashboard 2) — Postgres-backed workflow ─────────────────────
export const getWorkflowStages = () => apiFetch("/api/workflow/stages");

export const getWorkflowCampaigns = () => apiFetch("/api/workflow/campaigns");

export const getOpsTasks = (campaignId) =>
  apiFetch(`/api/workflow/campaigns/${campaignId}/ops-tasks`);

export const updateOpsTask = (taskId, payload) =>
  apiFetch(`/api/workflow/ops-tasks/${taskId}`, { method: "PATCH", body: JSON.stringify(payload) });

export const transitionCampaign = (campaignId, payload) =>
  apiFetch(`/api/workflow/campaigns/${campaignId}/transition`, {
    method: "POST",
    body: JSON.stringify(payload),
  });

export const updateCampaignAssets = (campaignId, payload) =>
  apiFetch(`/api/workflow/campaigns/${campaignId}/assets`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });

export const uploadCampaignAsset = async (campaignId, field, file) => {
  const formData = new FormData();
  formData.append("file", file);
  const resp = await fetch(`/api/workflow/campaigns/${campaignId}/upload-asset?field=${field}`, {
    method: "POST",
    body: formData,
  });
  if (!resp.ok) {
    const d = await resp.json().catch(() => ({}));
    throw new Error(d.detail || "Upload failed");
  }
  return resp.json();
};

export const recordPublisherEmail = (campaignId, payload) =>
  apiFetch(`/api/workflow/campaigns/${campaignId}/publisher-email`, {
    method: "POST",
    body: JSON.stringify(payload),
  });

// ── Publishers & Budget Allocation ────────────────────────────────────────────
export const getPublishers = () => apiFetch("/api/publishers");

export const getAllocations = (advId, month) =>
  apiFetch(`/api/advertisers/${advId}/allocations${buildQuery({ month })}`);

export const getAllAllocationsForMonth = (month) =>
  apiFetch(`/api/allocations${buildQuery({ month })}`);

export const saveAllocations = (advId, month, allocations) =>
  apiFetch(`/api/advertisers/${advId}/allocations`, {
    method: "POST",
    body: JSON.stringify({ month, allocations }),
  });
