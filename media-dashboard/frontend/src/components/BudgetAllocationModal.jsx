import React, { useState, useEffect, useMemo } from "react";
import { getPublishers, getAllocations, saveAllocations } from "../api";

const c = { blue: "#2E5BFF", ink: "#0F1724", sub: "#52606D", line: "#E6EAF0", muted: "#768EA7", green: "#0F8C6A", red: "#C8321E", amber: "#B7791F", bg: "#F7F8FA" };

const s = {
  overlay: { position: "fixed", inset: 0, background: "rgba(15,23,36,0.45)", zIndex: 10000, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "32px 20px", overflowY: "auto" },
  modal: { background: "#fff", borderRadius: 16, width: "100%", maxWidth: 860, boxShadow: "0 20px 60px rgba(15,23,36,0.25)", overflow: "hidden", display: "flex", flexDirection: "column" },
  header: { padding: "24px 28px 16px", display: "flex", justifyContent: "space-between", alignItems: "flex-start" },
  eyebrow: { fontSize: 12, fontWeight: 700, letterSpacing: ".06em", color: c.blue, textTransform: "uppercase", marginBottom: 4 },
  title: { fontSize: 22, fontWeight: 800, color: c.ink },
  subtitle: { fontSize: 13, color: c.muted, marginTop: 4 },
  close: { width: 36, height: 36, borderRadius: 9, border: `1px solid ${c.line}`, background: "#fff", cursor: "pointer", fontSize: 17, color: c.muted, lineHeight: 1 },
  body: { padding: "0 28px 20px", maxHeight: "60vh", overflowY: "auto" },
  table: { width: "100%", borderCollapse: "collapse" },
  th: { textAlign: "left", fontSize: 11, fontWeight: 700, color: c.muted, textTransform: "uppercase", letterSpacing: ".04em", padding: "10px 12px", borderBottom: `1px solid ${c.line}`, background: c.bg },
  td: { padding: "10px 12px", borderBottom: `1px solid #F1F5F9`, fontSize: 13.5, verticalAlign: "middle" },
  pubName: { fontWeight: 700, color: c.ink },
  pubCode: { fontSize: 11, color: c.muted, marginLeft: 6 },
  input: { border: `1px solid ${c.line}`, borderRadius: 7, padding: "8px 10px", fontSize: 13, color: c.ink, width: 110, outline: "none", fontFamily: "inherit" },
  inputDisabled: { background: "#F3F4F6", color: "#9CA3AF", cursor: "not-allowed" },
  select: { border: `1px solid ${c.line}`, borderRadius: 7, padding: "8px 10px", fontSize: 12, color: c.ink, outline: "none", fontFamily: "inherit", cursor: "pointer" },
  notesInput: { border: `1px solid ${c.line}`, borderRadius: 7, padding: "8px 10px", fontSize: 12, color: c.sub, width: "100%", outline: "none", fontFamily: "inherit" },
  footer: { padding: "16px 28px 22px", borderTop: `1px solid ${c.line}`, display: "flex", justifyContent: "space-between", alignItems: "center" },
  summary: { display: "flex", gap: 24, fontSize: 13 },
  summaryItem: { display: "flex", flexDirection: "column", gap: 2 },
  summaryLabel: { fontSize: 11, fontWeight: 700, color: c.muted, textTransform: "uppercase" },
  summaryVal: { fontSize: 15, fontWeight: 800, color: c.ink },
  pctBar: { height: 6, borderRadius: 3, background: "#EEF2F9", width: 120, overflow: "hidden" },
  pctFill: (pct, over) => ({ height: "100%", borderRadius: 3, width: `${Math.min(pct, 100)}%`, background: over ? c.red : pct >= 90 ? c.green : c.amber, transition: "width .2s" }),
  saveBtn: { background: c.blue, color: "#fff", border: "none", borderRadius: 9, padding: "11px 20px", fontSize: 14, fontWeight: 700, cursor: "pointer" },
  saving: { opacity: 0.6, cursor: "wait" },
  loading: { textAlign: "center", padding: 40, color: "#888" },
};

function fmtInr(n) {
  if (n == null || isNaN(n)) return "—";
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)} Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)} L`;
  return `₹${Number(n).toLocaleString("en-IN")}`;
}

export default function BudgetAllocationModal({ advertiser, onClose }) {
  const [publishers, setPublishers] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const totalBudget = useMemo(() => {
    const hint = advertiser.budget_hint || "0";
    const n = parseFloat(String(hint).replace(/[^\d.]/g, ""));
    return isNaN(n) ? 0 : n;
  }, [advertiser]);

  useEffect(() => {
    Promise.all([getPublishers(), getAllocations(advertiser.id)])
      .then(([pubRes, allocRes]) => {
        const pubs = pubRes.publishers || [];
        const allocs = allocRes.allocations || [];
        const allocMap = {};
        allocs.forEach((a) => { allocMap[a.publisher_id] = a; });
        setPublishers(pubs);
        setRows(pubs.map((p) => {
          const existing = allocMap[p.id] || {};
          return {
            publisher_id: p.id,
            publisher_name: p.name,
            publisher_code: p.code,
            amount: existing.amount != null ? String(existing.amount) : "",
            status: existing.status || "ALLOCATED",
            notes: existing.notes || "",
          };
        }));
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [advertiser.id]);

  const updateRow = (idx, patch) => {
    setRows((prev) => prev.map((r, i) => i === idx ? { ...r, ...patch } : r));
  };

  const totalAllocated = useMemo(() => {
    return rows.reduce((sum, r) => {
      if (r.status === "CANT_GO_LIVE") return sum;
      const n = parseInt(r.amount, 10);
      return sum + (isNaN(n) ? 0 : n);
    }, 0);
  }, [rows]);

  const pctAllocated = totalBudget > 0 ? (totalAllocated / totalBudget) * 100 : 0;
  const remaining = totalBudget - totalAllocated;
  const isOver = remaining < 0;

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = rows.map((r) => ({
        publisher_id: r.publisher_id,
        amount: r.status === "CANT_GO_LIVE" ? null : (parseInt(r.amount, 10) || null),
        status: r.status,
        notes: r.notes || null,
      }));
      await saveAllocations(advertiser.id, payload);
      onClose();
    } catch (e) {
      alert("Save failed: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={(e) => e.stopPropagation()}>
        <div style={s.loading}>Loading publishers…</div>
      </div>
    </div>
  );

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={(e) => e.stopPropagation()}>
        <div style={s.header}>
          <div>
            <div style={s.eyebrow}>Budget Allocation</div>
            <div style={s.title}>{advertiser.name}</div>
            <div style={s.subtitle}>{advertiser.id} · Total budget: {fmtInr(totalBudget)}</div>
          </div>
          <button style={s.close} onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div style={s.body}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Publisher</th>
                <th style={s.th}>Allocation (₹)</th>
                <th style={s.th}>Status</th>
                <th style={s.th}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => {
                const disabled = r.status === "CANT_GO_LIVE";
                return (
                  <tr key={r.publisher_id}>
                    <td style={s.td}>
                      <span style={s.pubName}>{r.publisher_name}</span>
                      <span style={s.pubCode}>{r.publisher_code}</span>
                    </td>
                    <td style={s.td}>
                      <input
                        style={{ ...s.input, ...(disabled ? s.inputDisabled : {}) }}
                        type="number"
                        placeholder="0"
                        value={disabled ? "" : r.amount}
                        disabled={disabled}
                        onChange={(e) => updateRow(idx, { amount: e.target.value })}
                      />
                    </td>
                    <td style={s.td}>
                      <select
                        style={s.select}
                        value={r.status}
                        onChange={(e) => updateRow(idx, { status: e.target.value, ...(e.target.value === "CANT_GO_LIVE" ? { amount: "" } : {}) })}
                      >
                        <option value="ALLOCATED">Allocated</option>
                        <option value="CANT_GO_LIVE">Can't go live</option>
                      </select>
                    </td>
                    <td style={s.td}>
                      <input
                        style={s.notesInput}
                        placeholder="—"
                        value={r.notes}
                        onChange={(e) => updateRow(idx, { notes: e.target.value })}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div style={s.footer}>
          <div style={s.summary}>
            <div style={s.summaryItem}>
              <span style={s.summaryLabel}>Allocated</span>
              <span style={{ ...s.summaryVal, color: isOver ? c.red : c.ink }}>{fmtInr(totalAllocated)}</span>
            </div>
            <div style={s.summaryItem}>
              <span style={s.summaryLabel}>Remaining</span>
              <span style={{ ...s.summaryVal, color: isOver ? c.red : c.green }}>{fmtInr(remaining)}</span>
            </div>
            <div style={s.summaryItem}>
              <span style={s.summaryLabel}>% Allocated</span>
              <span style={s.summaryVal}>{pctAllocated.toFixed(1)}%</span>
              <div style={s.pctBar}><div style={s.pctFill(pctAllocated, isOver)} /></div>
            </div>
          </div>
          <button style={{ ...s.saveBtn, ...(saving ? s.saving : {}) }} onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save allocation"}
          </button>
        </div>
      </div>
    </div>
  );
}
