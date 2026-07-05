import React, { useState, useEffect, useMemo } from "react";
import { getAdvertisers, getPublishers, getAllAllocationsForMonth, getAllocationSummary, saveAllocations, createPublisher } from "../api";

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
  table: { width: "100%", borderCollapse: "collapse", minWidth: 900 },
  th: { textAlign: "left", fontSize: 11, fontWeight: 700, color: c.muted, textTransform: "uppercase", letterSpacing: ".04em", padding: "12px 14px", background: c.bg, borderBottom: "1px solid " + c.line, whiteSpace: "nowrap", position: "sticky", top: 0 },
  thRight: { textAlign: "right" },
  td: { padding: "10px 14px", fontSize: 13, color: c.ink, borderBottom: "1px solid #F1F5F9", verticalAlign: "middle" },
  tdRight: { textAlign: "right" },
  advName: { fontWeight: 700, fontSize: 13.5, color: c.ink },
  advId: { fontSize: 11, color: c.muted },
  input: { border: `1px solid ${c.line}`, borderRadius: 6, padding: "6px 8px", fontSize: 12, width: 80, outline: "none", textAlign: "right", fontFamily: "inherit" },
  saveRow: { background: c.blue, color: "#fff", border: "none", borderRadius: 6, padding: "5px 10px", cursor: "pointer", fontSize: 11, fontWeight: 700 },
  pct: (v) => ({ fontSize: 12, fontWeight: 700, color: v >= 100 ? c.green : v >= 70 ? c.amber : c.red }),
  cantLive: { fontSize: 11, color: c.red, fontWeight: 600, cursor: "pointer" },
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
};

function fmtInr(n) {
  if (n == null || isNaN(n) || n === 0) return "—";
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)} Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)} L`;
  return `₹${Number(n).toLocaleString("en-IN")}`;
}

function parseBudget(hint) {
  const n = parseFloat(String(hint || "0").replace(/[^\d.]/g, ""));
  return isNaN(n) ? 0 : n;
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
  const canEdit = userRole === "ADMIN" || userRole === "SALES";
  const [month, setMonth] = useState(currentMonth());
  const [advertisers, setAdvertisers] = useState([]);
  const [publishers, setPublishers] = useState([]);
  const [allocMap, setAllocMap] = useState({});
  const [monthlyAllocated, setMonthlyAllocated] = useState({}); // {"2026-06": 125000}
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState({});
  const [savingAdv, setSavingAdv] = useState(null);
  const [showAddPub, setShowAddPub] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [advRes, pubRes, allocRes, summaryRes] = await Promise.all([
        getAdvertisers(),
        getPublishers(),
        getAllAllocationsForMonth(month),
        getAllocationSummary(),
      ]);
      const advs = (advRes.advertisers || []).filter((a) => a.status === "ONBOARDED");
      const pubs = pubRes.publishers || [];
      setAdvertisers(advs);
      setPublishers(pubs);

      const map = {};
      (allocRes.allocations || []).forEach((al) => {
        if (!map[al.advertiser_id]) map[al.advertiser_id] = {};
        map[al.advertiser_id][al.publisher_id] = al;
      });
      setAllocMap(map);
      const summary = {};
      (summaryRes.summary || []).forEach((r) => { summary[r.month] = r.allocated; });
      setMonthlyAllocated(summary);
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

  const pubTotals = useMemo(() => {
    const totals = {};
    publishers.forEach((p) => { totals[p.id] = 0; });
    advertisers.forEach((a) => {
      publishers.forEach((p) => {
        const cell = getCell(a.id, p.id);
        if (cell.status !== "CANT_GO_LIVE") {
          const n = parseInt(cell.amount, 10);
          if (!isNaN(n)) totals[p.id] += n;
        }
      });
    });
    return totals;
  }, [advertisers, publishers, allocMap, dirty]);

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

  // "Budget loaded" is month-scoped with carry-forward: an advertiser's budget
  // counts toward the month they were onboarded (onboarded_at; created_at as
  // fallback for rows predating the field), and whatever was left unallocated
  // in earlier months rolls into the selected month's available budget.
  const onboardMonth = (a) => (a.onboarded_at || a.created_at || "").slice(0, 7);
  const monthAdvertisers = advertisers.filter((a) => onboardMonth(a) === month);
  const newBudget = monthAdvertisers.reduce((s, a) => s + parseBudget(a.budget_hint), 0);
  const priorLoaded = advertisers.reduce((s, a) => {
    const m = onboardMonth(a);
    return m && m < month ? s + parseBudget(a.budget_hint) : s;
  }, 0);
  const priorAllocated = Object.entries(monthlyAllocated).reduce(
    (s, [m, v]) => (m < month ? s + v : s), 0
  );
  const carryIn = priorLoaded - priorAllocated;
  const totalBudgetLoaded = newBudget + carryIn;
  const tableBudgetTotal = advertisers.reduce((s, a) => s + parseBudget(a.budget_hint), 0);
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

      {/* KPI Summary Cards */}
      {advertisers.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, marginBottom: 20 }}>
          <div style={{ background: "#fff", border: `1px solid ${c.line}`, borderRadius: 10, padding: "14px 16px" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: c.muted, textTransform: "uppercase", marginBottom: 4 }}>Total Budget Loaded</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: c.ink }}>{fmtAmt(totalBudgetLoaded)}</div>
            <div style={{ fontSize: 12, color: c.muted, marginTop: 2 }}>{fmtAmt(newBudget)} new · {fmtAmt(carryIn)} carried forward</div>
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
            <div style={{ fontSize: 12, color: c.muted, marginTop: 2 }}>{unallocated > 0 ? "Carries forward to next month" : "Fully allocated"}</div>
          </div>
        </div>
      )}

      {advertisers.length === 0 ? (
        <div style={s.empty}>No onboarded advertisers yet.</div>
      ) : (
        <div style={s.wrap}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={{ ...s.th, minWidth: 150 }}>Advertiser</th>
                <th style={{ ...s.th, ...s.thRight }}>Total Budget</th>
                {publishers.map((p) => (
                  <th key={p.id} style={{ ...s.th, textAlign: "center" }}>{p.name}<br/><span style={{ fontWeight: 400, fontSize: 9 }}>{p.code}</span></th>
                ))}
                <th style={{ ...s.th, ...s.thRight }}>Allocated</th>
                <th style={{ ...s.th, textAlign: "center" }}>%</th>
                <th style={{ ...s.th, textAlign: "center" }}></th>
              </tr>
            </thead>
            <tbody>
              {advertisers.map((a) => {
                const budget = parseBudget(a.budget_hint);
                const allocated = rowTotal(a.id);
                const pct = budget > 0 ? (allocated / budget) * 100 : 0;
                const isDirty = !!dirty[a.id];
                return (
                  <tr key={a.id}>
                    <td style={s.td}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ width: 28, height: 28, borderRadius: 7, background: avatarColor(a.name), display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 12, fontWeight: 800, flexShrink: 0 }}>{(a.name || "?").charAt(0).toUpperCase()}</div>
                        <div><div style={s.advName}>{a.name}</div><div style={s.advId}>{a.id}</div></div>
                      </div>
                    </td>
                    <td style={{ ...s.td, ...s.tdRight, fontWeight: 700 }}>{fmtInr(budget)}</td>
                    {publishers.map((p) => {
                      const cell = getCell(a.id, p.id);
                      const cantLive = cell.status === "CANT_GO_LIVE";
                      const hasValue = parseInt(cell.amount, 10) > 0;
                      const cellBg = cantLive ? "#F3F4F6" : hasValue ? "#E3F6EE" : "transparent";
                      return (
                        <td key={p.id} style={{ ...s.td, textAlign: "center", padding: "6px 6px", background: cellBg }}>
                          {cantLive ? (
                            <span style={s.cantLive} onClick={() => toggleStatus(a.id, p.id)} title="Click to enable">
                              Can't go live
                            </span>
                          ) : (
                            <input
                              style={s.input}
                              type="number"
                              placeholder="0"
                              value={cell.amount}
                              onChange={(e) => setCell(a.id, p.id, { amount: e.target.value })}
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
                <td style={s.totalTd}>TOTAL</td>
                <td style={{ ...s.totalTd, textAlign: "right" }}>{fmtInr(tableBudgetTotal)}</td>
                {publishers.map((p) => (
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

      {showAddPub && <AddPublisherModal existing={publishers} onClose={() => setShowAddPub(false)} onSave={handleAddPublisher} />}
    </div>
  );
}
