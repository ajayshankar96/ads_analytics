import React, { useState, useEffect, useMemo } from "react";
import { getAdvertisers, getPublishers, getAllocations, saveAllocations } from "../api";

const c = { blue: "#2E5BFF", ink: "#0F1724", sub: "#52606D", line: "#E6EAF0", muted: "#768EA7", green: "#0F8C6A", red: "#C8321E", amber: "#B7791F", bg: "#F7F8FA" };

const s = {
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 },
  title: { fontSize: 20, fontWeight: 800, color: c.ink },
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
  inputDisabled: { background: "#F3F4F6", color: "#9CA3AF", cursor: "not-allowed", fontSize: 11, textAlign: "center", border: `1px solid ${c.line}`, borderRadius: 6, padding: "6px 8px", width: 80 },
  saveRow: { background: c.blue, color: "#fff", border: "none", borderRadius: 6, padding: "5px 10px", cursor: "pointer", fontSize: 11, fontWeight: 700 },
  pct: (v) => ({ fontSize: 12, fontWeight: 700, color: v >= 100 ? c.green : v >= 70 ? c.amber : c.red }),
  cantLive: { fontSize: 11, color: c.red, fontWeight: 600 },
  loading: { textAlign: "center", padding: 40, color: "#888" },
  empty: { textAlign: "center", padding: 40, color: "#94a3b8", fontSize: 14 },
  // modal
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

function AddPublisherModal({ onClose, onSave }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim() || !code.trim()) return;
    setSaving(true);
    try {
      await onSave({ name: name.trim(), code: code.trim() });
      onClose();
    } catch (e) {
      alert("Failed: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={(e) => e.stopPropagation()}>
        <div style={s.modalTitle}>Add new publisher</div>
        <div style={s.field}>
          <label style={s.label}>Publisher name</label>
          <input style={s.modalInput} placeholder="e.g. Swiggy" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div style={s.field}>
          <label style={s.label}>Code</label>
          <input style={s.modalInput} placeholder="e.g. P12" value={code} onChange={(e) => setCode(e.target.value)} />
        </div>
        <div style={s.modalFooter}>
          <button style={s.ghostBtn} onClick={onClose}>Cancel</button>
          <button style={s.addBtn} onClick={handleSave} disabled={saving}>{saving ? "Adding…" : "Add publisher"}</button>
        </div>
      </div>
    </div>
  );
}

export default function BudgetAllocation() {
  const [advertisers, setAdvertisers] = useState([]);
  const [publishers, setPublishers] = useState([]);
  const [allocMap, setAllocMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState({});
  const [savingAdv, setSavingAdv] = useState(null);
  const [showAddPub, setShowAddPub] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [advRes, pubRes] = await Promise.all([getAdvertisers(), getPublishers()]);
      const advs = (advRes.advertisers || []).filter((a) => a.status === "ONBOARDED");
      const pubs = pubRes.publishers || [];
      setAdvertisers(advs);
      setPublishers(pubs);

      const allAllocations = {};
      await Promise.all(advs.map(async (a) => {
        const res = await getAllocations(a.id);
        allAllocations[a.id] = {};
        (res.allocations || []).forEach((al) => {
          allAllocations[a.id][al.publisher_id] = al;
        });
      }));
      setAllocMap(allAllocations);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

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
      await saveAllocations(advId, allocs);
      // refresh this advertiser's allocations
      const res = await getAllocations(advId);
      setAllocMap((prev) => {
        const updated = { ...prev, [advId]: {} };
        (res.allocations || []).forEach((al) => { updated[advId][al.publisher_id] = al; });
        return updated;
      });
      setDirty((prev) => { const n = { ...prev }; delete n[advId]; return n; });
    } catch (e) { alert("Save failed: " + e.message); }
    finally { setSavingAdv(null); }
  };

  const handleAddPublisher = async ({ name, code }) => {
    const res = await fetch("/api/publishers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, code }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.detail || "Failed to add publisher");
    }
    await load();
  };

  if (loading) return <div style={s.loading}>Loading budget allocation…</div>;

  return (
    <div>
      <div style={s.header}>
        <div style={s.title}>Publisher Budget Allocation</div>
        <div style={s.btnRow}>
          <button style={s.addBtn} onClick={() => setShowAddPub(true)}>+ New Publisher</button>
        </div>
      </div>

      {advertisers.length === 0 ? (
        <div style={s.empty}>No onboarded advertisers yet.</div>
      ) : (
        <div style={s.wrap}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Advertiser</th>
                <th style={{ ...s.th, ...s.thRight }}>Total Budget</th>
                {publishers.map((p) => (
                  <th key={p.id} style={{ ...s.th, textAlign: "center" }}>{p.name}<br/><span style={{ fontWeight: 400, fontSize: 10 }}>{p.code}</span></th>
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
                      <div style={s.advName}>{a.name}</div>
                      <div style={s.advId}>{a.id}</div>
                    </td>
                    <td style={{ ...s.td, ...s.tdRight, fontWeight: 700 }}>{fmtInr(budget)}</td>
                    {publishers.map((p) => {
                      const cell = getCell(a.id, p.id);
                      const cantLive = cell.status === "CANT_GO_LIVE";
                      return (
                        <td key={p.id} style={{ ...s.td, textAlign: "center", padding: "6px 6px" }}>
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
                        <button style={s.saveRow} onClick={() => handleSaveRow(a.id)} disabled={savingAdv === a.id}>
                          {savingAdv === a.id ? "…" : "Save"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showAddPub && <AddPublisherModal onClose={() => setShowAddPub(false)} onSave={handleAddPublisher} />}
    </div>
  );
}
