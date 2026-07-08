import React, { useState, useEffect, useMemo } from "react";
import { getAdvertisers, getPublishers, getAllAllocationsForMonth, saveAllocations, createPublisher } from "../api";

const c = { blue: "#2E5BFF", ink: "#0F1724", sub: "#52606D", line: "#E6EAF0", muted: "#768EA7", green: "#0F8C6A", red: "#C8321E", amber: "#B7791F", bg: "#F7F8FA" };

const s = {
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 },
  titleRow: { display: "flex", alignItems: "center", gap: 16 },
  title: { fontSize: 20, fontWeight: 800, color: c.ink },
  monthPicker: { border: `1px solid ${c.line}`, borderRadius: 8, padding: "8px 12px", fontSize: 14, fontWeight: 600, color: c.ink, outline: "none", cursor: "pointer" },
  btnRow: { display: "flex", gap: 10 },
  addBtn: { background: c.blue, color: "#fff", border: "none", borderRadius: 8, padding: "9px 16px", cursor: "pointer", fontSize: 13, fontWeight: 700 },
  ghostBtn: { background: "#fff", color: c.sub, border: `1px solid ${c.line}`, borderRadius: 8, padding: "9px 16px", cursor: "pointer", fontSize: 13, fontWeight: 600 },
  wrap: { background: "#fff", border: "1px solid " + c.line, borderRadius: 12, overflow: "hidden", overflowX: "auto", boxShadow: "0 1px 3px rgba(15,23,36,0.05)" },
  // borderCollapse must be "separate" for position:sticky to work reliably on cells
  table: { width: "100%", borderCollapse: "separate", borderSpacing: 0, minWidth: 900, fontVariantNumeric: "tabular-nums" },
  th: { textAlign: "left", fontSize: 11, fontWeight: 700, color: c.muted, textTransform: "uppercase", letterSpacing: ".04em", padding: "11px 14px", background: c.bg, borderBottom: "1px solid " + c.line, whiteSpace: "nowrap" },
  thRight: { textAlign: "right" },
  // First column stays pinned while the publisher matrix scrolls horizontally
  stickyCol: { position: "sticky", left: 0, zIndex: 1, boxShadow: `inset -1px 0 0 ${c.line}` },
  td: { padding: "9px 14px", fontSize: 13, color: c.ink, borderBottom: "1px solid #F1F5F9", verticalAlign: "middle" },
  tdRight: { textAlign: "right" },
  advName: { fontWeight: 700, fontSize: 13, color: c.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 170 },
  advId: { fontSize: 10, color: "#94A6B8", fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace", letterSpacing: ".03em", marginTop: 1 },
  // Quiet input: near-invisible at rest, blue ring on focus (handlers on the element)
  input: { border: "1px solid #E3E8EF", borderRadius: 7, padding: "6px 9px", fontSize: 12.5, width: 100, outline: "none", textAlign: "right", fontFamily: "inherit", boxSizing: "border-box", background: "transparent", transition: "border-color .15s ease, box-shadow .15s ease, background .15s ease" },
  saveRow: { background: c.blue, color: "#fff", border: "none", borderRadius: 6, padding: "5px 10px", cursor: "pointer", fontSize: 11, fontWeight: 700 },
  pct: (v) => {
    const over = v > 100.5; // matches the OVER row-status band
    const color = v <= 0 ? c.muted : over ? c.red : v >= 99.5 ? c.green : v >= 70 ? c.amber : c.red;
    const bg = v <= 0 ? "#F1F5F9" : over ? "#FDEBE8" : v >= 99.5 ? "#E5F5EF" : v >= 70 ? "#FBF3E1" : "#FDEBE8";
    return { display: "inline-block", minWidth: 42, padding: "3px 8px", borderRadius: 999, fontSize: 11.5, fontWeight: 700, color, background: bg };
  },
  cantLive: { display: "inline-block", fontSize: 10.5, color: "#B42318", fontWeight: 700, cursor: "pointer", background: "#FDECEA", padding: "3px 9px", borderRadius: 999, whiteSpace: "nowrap" },
  totalRow: { background: "#F0F4FF", fontWeight: 800 },
  totalTd: { padding: "12px 14px", fontSize: 13, fontWeight: 800, color: c.ink, borderTop: `2px solid ${c.blue}` },
  loading: { textAlign: "center", padding: 40, color: "#888" },
  empty: { textAlign: "center", padding: 40, color: "#94a3b8", fontSize: 14 },
  overlay: { position: "fixed", inset: 0, background: "rgba(15,23,36,0.45)", zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center" },
  modal: { background: "#fff", borderRadius: 14, padding: "28px 32px", width: 400, boxShadow: "0 20px 60px rgba(15,23,36,0.25)" },
  modalTitle: { fontSize: 18, fontWeight: 800, color: c.ink, marginBottom: 18 },
  field: { marginBottom: 14 },
  label: { fontSize: 13, fontWeight: 600, color: c.ink, marginBottom: 6, display: "block" },
  modalInput: { border: `1px solid ${c.line}`, borderRadius: 8, padding: "10px 12px", fontSize: 14, width: "100%", outline: "none", fontFamily: "inherit", boxSizing: "border-box" },
  modalFooter: { display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 },
  filterBar: { display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" },
  filterInput: { border: `1px solid ${c.line}`, borderRadius: 8, padding: "8px 12px", fontSize: 13, outline: "none", width: 220, fontFamily: "inherit", boxSizing: "border-box" },
  filterSel: { border: `1px solid ${c.line}`, borderRadius: 8, padding: "8px 10px", fontSize: 13, fontWeight: 600, color: c.ink, outline: "none", cursor: "pointer", background: "#fff", fontFamily: "inherit" },
  clearBtn: { background: "none", border: "none", color: c.blue, fontSize: 12.5, fontWeight: 700, cursor: "pointer", padding: "4px 6px" },
  pubPanel: { position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 51, background: "#fff", border: `1px solid ${c.line}`, borderRadius: 10, boxShadow: "0 8px 24px rgba(15,23,36,0.14)", padding: "10px 12px", minWidth: 200, maxHeight: 280, overflowY: "auto" },
  pubOption: { display: "flex", alignItems: "center", gap: 8, padding: "5px 2px", fontSize: 13, color: c.ink, cursor: "pointer" },
};

function fmtInr(n) {
  if (n == null || isNaN(n) || n === 0) return "—";
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)} Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)} L`;
  return `₹${Number(n).toLocaleString("en-IN")}`;
}

// Live Indian-style digit grouping for allocation inputs: state keeps raw
// digits ("100000"); the input displays them grouped ("1,00,000"). Commas
// appear as the user types — 1000 -> 1,000, 100000 -> 1,00,000.
function fmtGroupInr(v) {
  const digits = String(v ?? "").replace(/\D/g, "");
  if (!digits) return "";
  return Number(digits).toLocaleString("en-IN");
}

function parseBudget(hint) {
  const n = parseFloat(String(hint || "0").replace(/[^\d.]/g, ""));
  return isNaN(n) ? 0 : n;
}

// An advertiser's budget for a given "YYYY-MM" month: MONTHLY advertisers load
// the value set for that month (unset months load nothing); date-agnostic
// advertisers keep their single budget_hint.
function budgetForMonth(a, month) {
  if ((a.budget_type || "AGNOSTIC") === "MONTHLY") {
    return parseBudget((a.budget_months || {})[month]);
  }
  return parseBudget(a.budget_hint);
}

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function AddPublisherModal({ onClose, onSave, existing = [] }) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const trimmed = name.trim();
  const isDup = trimmed !== "" && existing.some(
    (p) => (p.name || "").trim().toLowerCase() === trimmed.toLowerCase()
  );
  const canSubmit = trimmed !== "" && !isDup && !saving;

  const handleSave = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      await onSave({ name: trimmed });
      onClose();
    } catch (e) {
      alert("Couldn't add publisher: " + e.message);
    } finally { setSaving(false); }
  };

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={(e) => e.stopPropagation()}>
        <div style={s.modalTitle}>Add new publisher</div>
        <div style={s.field}>
          <label style={s.label}>Publisher name</label>
          <input
            style={{ ...s.modalInput, ...(isDup ? { borderColor: c.red } : {}) }}
            placeholder="e.g. Swiggy"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
          />
          {isDup ? (
            <div style={{ fontSize: 12, color: c.red, fontWeight: 600, marginTop: 6 }}>
              A publisher named “{trimmed}” already exists.
            </div>
          ) : (
            <div style={{ fontSize: 12, color: c.muted, marginTop: 6 }}>
              A short code (e.g. P8) is assigned automatically.
            </div>
          )}
        </div>
        <div style={s.modalFooter}>
          <button style={s.ghostBtn} onClick={onClose}>Cancel</button>
          <button style={{ ...s.addBtn, ...(canSubmit ? {} : { opacity: 0.5, cursor: "not-allowed" }) }} onClick={handleSave} disabled={!canSubmit}>
            {saving ? "Adding…" : "Add publisher"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function BudgetAllocation({ userRole = "VIEWER" }) {
  const canEdit = ["CREATOR", "ADMIN", "SALES"].includes(userRole);
  const [month, setMonth] = useState(currentMonth());
  const [advertisers, setAdvertisers] = useState([]);
  const [publishers, setPublishers] = useState([]);
  const [allocMap, setAllocMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState({});
  const [savingAdv, setSavingAdv] = useState(null);
  const [showAddPub, setShowAddPub] = useState(false);
  // Filters — the matrix grows in both directions as advertisers/publishers
  // scale: rows are filtered by search/status/category, columns by the
  // publisher picker. Sorting reorders rows only.
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL"); // ALL | UNALLOCATED | PARTIAL | FULL | OVER
  const [categoryFilter, setCategoryFilter] = useState("ALL"); // ALL | __NONE__ | <category>
  const [sortKey, setSortKey] = useState("DEFAULT"); // DEFAULT | BUDGET_DESC | PCT_ASC | NAME_ASC
  const [hiddenPubs, setHiddenPubs] = useState({}); // pub.id -> true when column hidden
  const [showPubPicker, setShowPubPicker] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [advRes, pubRes, allocRes] = await Promise.all([
        getAdvertisers(),
        getPublishers(),
        getAllAllocationsForMonth(month),
      ]);
      const advs = (advRes.advertisers || []).filter((a) => a.status === "ONBOARDED");
      const pubs = (pubRes.publishers || [])
        .slice()
        .sort((x, y) => (x.name || "").localeCompare(y.name || "", undefined, { sensitivity: "base" }));
      setAdvertisers(advs);
      setPublishers(pubs);

      const map = {};
      (allocRes.allocations || []).forEach((al) => {
        if (!map[al.advertiser_id]) map[al.advertiser_id] = {};
        map[al.advertiser_id][al.publisher_id] = al;
      });
      setAllocMap(map);
      setDirty({});
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [month]);

  const getCell = (advId, pubId) => {
    if (dirty[advId]?.[pubId] !== undefined) return dirty[advId][pubId];
    const al = allocMap[advId]?.[pubId];
    if (!al) return { amount: "", status: "ALLOCATED" };
    return { amount: al.amount != null ? String(al.amount) : "", status: al.status || "ALLOCATED" };
  };

  const setCell = (advId, pubId, patch) => {
    setDirty((prev) => ({
      ...prev,
      [advId]: { ...(prev[advId] || {}), [pubId]: { ...getCell(advId, pubId), ...patch } },
    }));
  };

  const toggleStatus = (advId, pubId) => {
    const cell = getCell(advId, pubId);
    const newStatus = cell.status === "CANT_GO_LIVE" ? "ALLOCATED" : "CANT_GO_LIVE";
    setCell(advId, pubId, { status: newStatus, ...(newStatus === "CANT_GO_LIVE" ? { amount: "" } : {}) });
  };

  const rowTotal = (advId) => {
    return publishers.reduce((sum, p) => {
      const cell = getCell(advId, p.id);
      if (cell.status === "CANT_GO_LIVE") return sum;
      const n = parseInt(cell.amount, 10);
      return sum + (isNaN(n) ? 0 : n);
    }, 0);
  };

  // Classify a row for the allocation-status filter. "Allocated" is always
  // computed across ALL publishers — hiding a column never changes a row's truth.
  const rowStatusOf = (a) => {
    const budget = budgetForMonth(a, month);
    const allocated = rowTotal(a.id);
    if (allocated <= 0) return "UNALLOCATED";
    if (budget <= 0 || allocated > budget) return "OVER";
    if (allocated >= budget) return "FULL";
    return "PARTIAL";
  };

  const categories = useMemo(() => {
    const set = new Set();
    let hasNone = false;
    advertisers.forEach((a) => {
      const cat = (a.category || "").trim();
      if (cat) set.add(cat); else hasNone = true;
    });
    return { list: Array.from(set).sort((x, y) => x.localeCompare(y)), hasNone };
  }, [advertisers]);

  const visibleAdvertisers = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = advertisers.filter((a) => {
      if (dirty[a.id]) return true; // a row with unsaved edits must never vanish mid-typing
      if (q && !(`${a.name || ""} ${a.id || ""}`.toLowerCase().includes(q))) return false;
      if (statusFilter !== "ALL" && rowStatusOf(a) !== statusFilter) return false;
      if (categoryFilter !== "ALL") {
        const cat = (a.category || "").trim();
        if (categoryFilter === "__NONE__" ? cat !== "" : cat !== categoryFilter) return false;
      }
      return true;
    });
    if (sortKey === "DEFAULT") return filtered;
    const sorted = [...filtered];
    if (sortKey === "BUDGET_DESC") {
      sorted.sort((x, y) => budgetForMonth(y, month) - budgetForMonth(x, month));
    } else if (sortKey === "PCT_ASC") {
      const pctOf = (a) => {
        const b = budgetForMonth(a, month);
        const al = rowTotal(a.id);
        if (b <= 0) return al > 0 ? Infinity : 0; // allocated-without-budget sinks to the bottom
        return (al / b) * 100;
      };
      sorted.sort((x, y) => pctOf(x) - pctOf(y));
    } else if (sortKey === "NAME_ASC") {
      sorted.sort((x, y) => (x.name || "").localeCompare(y.name || ""));
    }
    return sorted;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [advertisers, publishers, search, statusFilter, categoryFilter, sortKey, dirty, allocMap, month]);

  const visiblePublishers = useMemo(
    () => publishers.filter((p) => !hiddenPubs[p.id]),
    [publishers, hiddenPubs]
  );
  const hiddenPubCount = publishers.length - visiblePublishers.length;

  const filtersActive = search.trim() !== "" || statusFilter !== "ALL" || categoryFilter !== "ALL" || sortKey !== "DEFAULT" || hiddenPubCount > 0;
  const clearFilters = () => {
    setSearch(""); setStatusFilter("ALL"); setCategoryFilter("ALL");
    setSortKey("DEFAULT"); setHiddenPubs({}); setShowPubPicker(false);
  };

  // Column totals / KPIs reflect the rows currently in view, so the numbers
  // always agree with the table below. Totals are still keyed for every
  // publisher (incl. hidden columns) so row math stays whole.
  const pubTotals = useMemo(() => {
    const totals = {};
    publishers.forEach((p) => { totals[p.id] = 0; });
    visibleAdvertisers.forEach((a) => {
      publishers.forEach((p) => {
        const cell = getCell(a.id, p.id);
        if (cell.status !== "CANT_GO_LIVE") {
          const n = parseInt(cell.amount, 10);
          if (!isNaN(n)) totals[p.id] += n;
        }
      });
    });
    return totals;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleAdvertisers, publishers, allocMap, dirty]);

  const grandTotal = useMemo(() => {
    return Object.values(pubTotals).reduce((s, v) => s + v, 0);
  }, [pubTotals]);

  const handleSaveRow = async (advId) => {
    setSavingAdv(advId);
    try {
      const allocs = publishers.map((p) => {
        const cell = getCell(advId, p.id);
        return {
          publisher_id: p.id,
          amount: cell.status === "CANT_GO_LIVE" ? null : (parseInt(cell.amount, 10) || null),
          status: cell.status,
          notes: null,
        };
      });
      await saveAllocations(advId, month, allocs);
      const allocRes = await getAllAllocationsForMonth(month);
      const map = {};
      (allocRes.allocations || []).forEach((al) => {
        if (!map[al.advertiser_id]) map[al.advertiser_id] = {};
        map[al.advertiser_id][al.publisher_id] = al;
      });
      setAllocMap(map);
      setDirty((prev) => { const n = { ...prev }; delete n[advId]; return n; });
    } catch (e) { alert("Save failed: " + e.message); }
    finally { setSavingAdv(null); }
  };

  const handleAddPublisher = async ({ name }) => {
    await createPublisher(name);
    await load();
  };

  // All KPI figures are scoped to the selected month only (no carry-forward)
  // and to the advertisers currently in view, so cards match the table below.
  const totalBudgetLoaded = visibleAdvertisers.reduce((s, a) => s + budgetForMonth(a, month), 0);
  const tableBudgetTotal = totalBudgetLoaded;
  const totalAllocatedAll = grandTotal;
  const fmtAmt = (n) => (n === 0 ? "₹0" : `${n < 0 ? "−" : ""}${fmtInr(Math.abs(n))}`);
  const allocationPct = totalBudgetLoaded > 0 ? (totalAllocatedAll / totalBudgetLoaded * 100) : 0;
  const activePubs = publishers.filter((p) => pubTotals[p.id] > 0).length;
  const unallocated = totalBudgetLoaded - totalAllocatedAll;

  const PALETTE = ["#B5546F", "#2E5BFF", "#0F8C6A", "#B7791F", "#7C3AED", "#0891B2", "#C8321E"];
  const avatarColor = (name) => PALETTE[(name || "").charCodeAt(0) % PALETTE.length];

  if (loading) return <div style={s.loading}>Loading budget allocation…</div>;

  return (
    <div>
      <div style={s.header}>
        <div style={s.titleRow}>
          <div style={s.title}>Publisher Budget Allocation</div>
          <input type="month" style={s.monthPicker} value={month} onChange={(e) => setMonth(e.target.value)} />
        </div>
        <div style={s.btnRow}>
          {canEdit && (
            <button style={s.addBtn} onClick={() => setShowAddPub(true)}>
              + Add Publisher
            </button>
          )}
        </div>
      </div>

      {/* Filter bar — rows filter by search/status/category, columns by the publisher picker */}
      {advertisers.length > 0 && (
        <div style={s.filterBar}>
          <input
            style={s.filterInput}
            placeholder="Search advertiser…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select style={s.filterSel} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="ALL">Status: All</option>
            <option value="UNALLOCATED">Unallocated</option>
            <option value="PARTIAL">Partially allocated</option>
            <option value="FULL">Fully allocated</option>
            <option value="OVER">Over-allocated</option>
          </select>
          {(categories.list.length > 0 || categories.hasNone) && (
            <select style={s.filterSel} value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="ALL">Category: All</option>
              {categories.list.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
              {categories.hasNone && <option value="__NONE__">No category</option>}
            </select>
          )}
          <select style={s.filterSel} value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
            <option value="DEFAULT">Sort: Default</option>
            <option value="BUDGET_DESC">Budget (high → low)</option>
            <option value="PCT_ASC">% allocated (low → high)</option>
            <option value="NAME_ASC">Name (A → Z)</option>
          </select>
          <div style={{ position: "relative" }}>
            <button
              style={{ ...s.ghostBtn, ...(hiddenPubCount > 0 ? { borderColor: c.blue, color: c.blue, fontWeight: 700 } : {}) }}
              onClick={() => setShowPubPicker((v) => !v)}
            >
              Publishers {visiblePublishers.length}/{publishers.length} ▾
            </button>
            {showPubPicker && (
              <>
                <div style={{ position: "fixed", inset: 0, zIndex: 50 }} onClick={() => setShowPubPicker(false)} />
                <div style={s.pubPanel}>
                  {publishers.map((p) => (
                    <label key={p.id} style={s.pubOption}>
                      <input
                        type="checkbox"
                        checked={!hiddenPubs[p.id]}
                        onChange={() => setHiddenPubs((prev) => ({ ...prev, [p.id]: !prev[p.id] }))}
                      />
                      <span style={{ fontWeight: 600 }}>{p.name}</span>
                    </label>
                  ))}
                  {hiddenPubCount > 0 && (
                    <button style={{ ...s.ghostBtn, width: "100%", marginTop: 8, padding: "6px 10px" }} onClick={() => setHiddenPubs({})}>
                      Show all
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
          {filtersActive && (
            <button style={s.clearBtn} onClick={clearFilters}>✕ Clear filters</button>
          )}
        </div>
      )}

      {/* KPI Summary Cards */}
      {advertisers.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, marginBottom: 20 }}>
          <div style={{ background: "#fff", border: `1px solid ${c.line}`, borderRadius: 10, padding: "14px 16px" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: c.muted, textTransform: "uppercase", marginBottom: 4 }}>Total Budget Loaded</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: c.ink }}>{fmtAmt(totalBudgetLoaded)}</div>
            <div style={{ fontSize: 12, color: c.muted, marginTop: 2 }}>
              across {visibleAdvertisers.length}{visibleAdvertisers.length !== advertisers.length ? ` of ${advertisers.length}` : ""} advertiser{visibleAdvertisers.length === 1 ? "" : "s"} this month
            </div>
          </div>
          <div style={{ background: "#fff", border: `1px solid ${c.line}`, borderRadius: 10, padding: "14px 16px" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: c.muted, textTransform: "uppercase", marginBottom: 4 }}>Total Allocated</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: c.ink }}>{fmtInr(totalAllocatedAll)}</div>
            <div style={{ fontSize: 12, color: c.muted, marginTop: 2 }}>{allocationPct.toFixed(1)}% of loaded</div>
          </div>
          <div style={{ background: "#fff", border: `1px solid ${c.line}`, borderRadius: 10, padding: "14px 16px" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: c.muted, textTransform: "uppercase", marginBottom: 4 }}>Publishers Active</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: c.ink }}>{activePubs}</div>
            <div style={{ fontSize: 12, color: c.muted, marginTop: 2 }}>of {publishers.length} total</div>
          </div>
          <div style={{ background: "#fff", border: `1px solid ${c.line}`, borderRadius: 10, padding: "14px 16px" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: c.muted, textTransform: "uppercase", marginBottom: 4 }}>Unallocated</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: unallocated > 0 ? c.amber : c.green }}>{fmtAmt(unallocated)}</div>
            <div style={{ fontSize: 12, color: c.muted, marginTop: 2 }}>{unallocated > 0 ? "Remaining this month" : unallocated < 0 ? "Over-allocated" : "Fully allocated"}</div>
          </div>
        </div>
      )}

      {advertisers.length === 0 ? (
        <div style={s.empty}>No onboarded advertisers yet.</div>
      ) : visibleAdvertisers.length === 0 ? (
        <div style={s.empty}>
          No advertisers match the current filters.{" "}
          <button style={s.clearBtn} onClick={clearFilters}>Clear filters</button>
        </div>
      ) : (
        <div style={s.wrap}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={{ ...s.th, ...s.stickyCol, zIndex: 2, background: c.bg, minWidth: 180 }}>Advertiser</th>
                <th style={{ ...s.th, ...s.thRight }}>Budget</th>
                {visiblePublishers.map((p) => (
                  <th key={p.id} style={{ ...s.th, textAlign: "center" }}>{p.name}</th>
                ))}
                <th style={{ ...s.th, ...s.thRight }}>Allocated</th>
                <th style={{ ...s.th, textAlign: "center" }}>%</th>
                <th style={{ ...s.th, width: 64 }}></th>
              </tr>
            </thead>
            <tbody>
              {visibleAdvertisers.map((a, idx) => {
                const budget = budgetForMonth(a, month);
                const allocated = rowTotal(a.id);
                const pct = budget > 0 ? (allocated / budget) * 100 : 0;
                const isDirty = !!dirty[a.id];
                const rowBg = idx % 2 === 1 ? "#FBFCFE" : "#fff"; // zebra keeps wide rows scannable
                return (
                  <tr key={a.id} style={{ background: rowBg }}>
                    <td style={{ ...s.td, ...s.stickyCol, background: rowBg }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                        <div style={{ width: 24, height: 24, borderRadius: 6, background: `${avatarColor(a.name)}1F`, display: "flex", alignItems: "center", justifyContent: "center", color: avatarColor(a.name), fontSize: 11, fontWeight: 800, flexShrink: 0 }}>{(a.name || "?").charAt(0).toUpperCase()}</div>
                        <div style={{ minWidth: 0 }}>
                          <div style={s.advName} title={`${a.name} · ${a.id}`}>{a.name}</div>
                          <div style={s.advId}>{a.id}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ ...s.td, ...s.tdRight, fontWeight: 600, color: c.sub }}>{fmtInr(budget)}</td>
                    {visiblePublishers.map((p) => {
                      const cell = getCell(a.id, p.id);
                      const cantLive = cell.status === "CANT_GO_LIVE";
                      const hasValue = parseInt(cell.amount, 10) > 0;
                      const cellBg = cantLive ? "#F5F6F8" : hasValue ? "#E9F7F0" : "transparent";
                      return (
                        <td key={p.id} style={{ ...s.td, textAlign: "center", padding: "5px 6px", background: cellBg }}>
                          {cantLive ? (
                            <span style={s.cantLive} onClick={() => toggleStatus(a.id, p.id)} title="Click to enable">
                              Can't go live
                            </span>
                          ) : (
                            <input
                              style={s.input}
                              type="text"
                              inputMode="numeric"
                              placeholder="—"
                              value={fmtGroupInr(cell.amount)}
                              onChange={(e) => setCell(a.id, p.id, { amount: e.target.value.replace(/\D/g, "") })}
                              onFocus={(e) => { e.target.select(); e.target.style.borderColor = c.blue; e.target.style.boxShadow = "0 0 0 3px rgba(46,91,255,0.12)"; e.target.style.background = "#fff"; }}
                              onBlur={(e) => { e.target.style.borderColor = "#E3E8EF"; e.target.style.boxShadow = "none"; e.target.style.background = "transparent"; }}
                              onContextMenu={(e) => { e.preventDefault(); toggleStatus(a.id, p.id); }}
                              title="Right-click to mark 'Can't go live'"
                            />
                          )}
                        </td>
                      );
                    })}
                    <td style={{ ...s.td, ...s.tdRight, fontWeight: 700 }}>{fmtInr(allocated)}</td>
                    <td style={{ ...s.td, textAlign: "center" }}>
                      <span style={s.pct(pct)}>{pct.toFixed(0)}%</span>
                    </td>
                    <td style={{ ...s.td, textAlign: "center" }}>
                      {isDirty && (
                        <button style={s.saveRow} onClick={() => handleSaveRow(a.id)} disabled={savingAdv === a.id || !canEdit}>
                          {savingAdv === a.id ? "…" : "Save"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              <tr style={s.totalRow}>
                <td style={{ ...s.totalTd, ...s.stickyCol, background: "#F0F4FF" }}>TOTAL</td>
                <td style={{ ...s.totalTd, textAlign: "right" }}>{fmtInr(tableBudgetTotal)}</td>
                {visiblePublishers.map((p) => (
                  <td key={p.id} style={{ ...s.totalTd, textAlign: "center" }}>{fmtInr(pubTotals[p.id])}</td>
                ))}
                <td style={{ ...s.totalTd, textAlign: "right" }}>{fmtInr(grandTotal)}</td>
                <td style={s.totalTd}></td>
                <td style={s.totalTd}></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {advertisers.length > 0 && visibleAdvertisers.length > 0 && hiddenPubCount > 0 && (
        <div style={{ fontSize: 12, color: c.muted, marginTop: 8 }}>
          {hiddenPubCount} publisher column{hiddenPubCount === 1 ? "" : "s"} hidden — Allocated, % and row totals still include hidden columns; saving a row keeps hidden allocations intact.
        </div>
      )}

      {showAddPub && <AddPublisherModal existing={publishers} onClose={() => setShowAddPub(false)} onSave={handleAddPublisher} />}
    </div>
  );
}
