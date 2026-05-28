import React, { useState, useEffect } from "react";
import { getKPIs, createKPI, deleteKPI } from "../api";

const s = {
  card: { background: "#fff", borderRadius: 8, padding: 16, boxShadow: "0 1px 4px rgba(0,0,0,0.07)", marginBottom: 12 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 },
  kpiCard: {
    background: "#fff",
    border: "1px solid #e5e7eb",
    borderRadius: 8,
    padding: 14,
    position: "relative",
  },
  kpiName: { fontSize: 14, fontWeight: 700, color: "#1e293b", marginBottom: 6 },
  kpiMeta: { fontSize: 12, color: "#64748b", marginBottom: 4 },
  deleteBtn: {
    position: "absolute", top: 8, right: 8,
    background: "none", border: "none", cursor: "pointer", color: "#ef4444", fontSize: 16,
  },
  addBtn: {
    background: "#2563eb", color: "#fff", border: "none",
    borderRadius: 6, padding: "8px 16px", cursor: "pointer", fontSize: 13, fontWeight: 600,
    marginBottom: 16,
  },
  form: { background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 8, padding: 16, marginBottom: 16 },
  formGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 },
  formGroup: { display: "flex", flexDirection: "column", gap: 4 },
  label: { fontSize: 11, fontWeight: 600, color: "#64748b", textTransform: "uppercase" },
  input: { border: "1px solid #d1d5db", borderRadius: 5, padding: "6px 8px", fontSize: 13 },
  select: { border: "1px solid #d1d5db", borderRadius: 5, padding: "6px 8px", fontSize: 13 },
  formBtns: { display: "flex", gap: 8, marginTop: 8 },
  saveBtn: { background: "#2563eb", color: "#fff", border: "none", borderRadius: 5, padding: "7px 16px", cursor: "pointer", fontSize: 13, fontWeight: 600 },
  cancelBtn: { background: "#f3f4f6", border: "1px solid #d1d5db", borderRadius: 5, padding: "7px 16px", cursor: "pointer", fontSize: 13 },
  loading: { textAlign: "center", padding: 40, color: "#888" },
  empty: { textAlign: "center", padding: 30, color: "#94a3b8", fontSize: 14 },
  badge: { display: "inline-block", padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 600 },
};

const defaultForm = {
  name: "",
  advertiser: "",
  publisher: "",
  segment: "",
  formula: "",
  goalValue: "",
  goalDirection: "higher",
  timePeriod: "1week",
};

export default function GlobalKPIs() {
  const [kpis, setKpis] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(defaultForm);
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    getKPIs()
      .then(setKpis)
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleSave = async () => {
    if (!form.name) return;
    setSaving(true);
    try {
      await createKPI({ ...form, goalValue: form.goalValue ? parseFloat(form.goalValue) : null });
      setShowForm(false);
      setForm(defaultForm);
      load();
    } catch (e) {
      alert("Error saving KPI: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this KPI?")) return;
    try {
      await deleteKPI(id);
      load();
    } catch (e) {
      alert("Error deleting KPI: " + e.message);
    }
  };

  if (loading) return <div style={s.loading}>Loading KPIs…</div>;

  return (
    <div>
      <button style={s.addBtn} onClick={() => setShowForm(!showForm)}>
        {showForm ? "Cancel" : "+ Add KPI"}
      </button>

      {showForm && (
        <div style={s.form}>
          <div style={s.formGrid}>
            <div style={s.formGroup}>
              <label style={s.label}>KPI Name *</label>
              <input style={s.input} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. CPQQG Target" />
            </div>
            <div style={s.formGroup}>
              <label style={s.label}>Advertiser</label>
              <input style={s.input} value={form.advertiser} onChange={e => setForm({ ...form, advertiser: e.target.value })} placeholder="All if blank" />
            </div>
            <div style={s.formGroup}>
              <label style={s.label}>Publisher</label>
              <input style={s.input} value={form.publisher} onChange={e => setForm({ ...form, publisher: e.target.value })} placeholder="All if blank" />
            </div>
            <div style={s.formGroup}>
              <label style={s.label}>Segment</label>
              <input style={s.input} value={form.segment} onChange={e => setForm({ ...form, segment: e.target.value })} placeholder="All if blank" />
            </div>
            <div style={s.formGroup}>
              <label style={s.label}>Goal Value</label>
              <input style={s.input} type="number" value={form.goalValue} onChange={e => setForm({ ...form, goalValue: e.target.value })} placeholder="e.g. 50" />
            </div>
            <div style={s.formGroup}>
              <label style={s.label}>Goal Direction</label>
              <select style={s.select} value={form.goalDirection} onChange={e => setForm({ ...form, goalDirection: e.target.value })}>
                <option value="lower">Lower is better (costs)</option>
                <option value="higher">Higher is better (revenue, CTR)</option>
              </select>
            </div>
            <div style={s.formGroup}>
              <label style={s.label}>Formula / Metric</label>
              <input style={s.input} value={form.formula} onChange={e => setForm({ ...form, formula: e.target.value })} placeholder="e.g. CPQQG, ROAS" />
            </div>
            <div style={s.formGroup}>
              <label style={s.label}>Time Period</label>
              <select style={s.select} value={form.timePeriod} onChange={e => setForm({ ...form, timePeriod: e.target.value })}>
                <option value="1week">1 Week</option>
                <option value="2weeks">2 Weeks</option>
                <option value="1month">1 Month</option>
                <option value="date_agnostic">Date Agnostic</option>
              </select>
            </div>
          </div>
          <div style={s.formBtns}>
            <button style={s.saveBtn} onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save KPI"}
            </button>
            <button style={s.cancelBtn} onClick={() => { setShowForm(false); setForm(defaultForm); }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {kpis.length === 0 ? (
        <div style={s.empty}>No KPIs configured yet. Click "+ Add KPI" to create one.</div>
      ) : (
        <div style={s.grid}>
          {kpis.map((kpi) => (
            <div key={kpi.id} style={s.kpiCard}>
              <button style={s.deleteBtn} onClick={() => handleDelete(kpi.id)} title="Delete">×</button>
              <div style={s.kpiName}>{kpi.name}</div>
              {kpi.advertiser && <div style={s.kpiMeta}>📢 {kpi.advertiser}</div>}
              {kpi.publisher && <div style={s.kpiMeta}>📡 {kpi.publisher}</div>}
              {kpi.segment && <div style={s.kpiMeta}>🏷 {kpi.segment}</div>}
              {kpi.formula && <div style={s.kpiMeta}>📐 {kpi.formula}</div>}
              {kpi.goalValue !== null && kpi.goalValue !== undefined && (
                <div style={{ marginTop: 8 }}>
                  <span style={{
                    ...s.badge,
                    background: kpi.goalDirection === "lower" ? "#dbeafe" : "#d1fae5",
                    color: kpi.goalDirection === "lower" ? "#1d4ed8" : "#065f46",
                  }}>
                    Goal: {kpi.goalValue} ({kpi.goalDirection === "lower" ? "↓ lower" : "↑ higher"})
                  </span>
                </div>
              )}
              {kpi.timePeriod && (
                <div style={{ marginTop: 4, fontSize: 11, color: "#94a3b8" }}>
                  Period: {kpi.timePeriod}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
