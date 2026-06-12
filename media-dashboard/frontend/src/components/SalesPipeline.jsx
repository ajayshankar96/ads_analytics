import React, { useState, useEffect } from "react";
import { getLeads, createLead, updateLead, closeLead } from "../api";

const s = {
  addBtn: { background: "#2563eb", color: "#fff", border: "none", borderRadius: 6, padding: "8px 16px", cursor: "pointer", fontSize: 13, fontWeight: 600, marginBottom: 16 },
  form: { background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 8, padding: 16, marginBottom: 16 },
  formGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 },
  formGroup: { display: "flex", flexDirection: "column", gap: 4 },
  label: { fontSize: 11, fontWeight: 600, color: "#64748b", textTransform: "uppercase" },
  input: { border: "1px solid #d1d5db", borderRadius: 5, padding: "6px 8px", fontSize: 13 },
  select: { border: "1px solid #d1d5db", borderRadius: 5, padding: "6px 8px", fontSize: 13 },
  formBtns: { display: "flex", gap: 8, marginTop: 8 },
  saveBtn: { background: "#2563eb", color: "#fff", border: "none", borderRadius: 5, padding: "7px 16px", cursor: "pointer", fontSize: 13, fontWeight: 600 },
  cancelBtn: { background: "#f3f4f6", border: "1px solid #d1d5db", borderRadius: 5, padding: "7px 16px", cursor: "pointer", fontSize: 13 },
  table: { width: "100%", borderCollapse: "collapse", background: "#fff", borderRadius: 8, overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.07)" },
  th: { textAlign: "left", fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", padding: "10px 12px", borderBottom: "1px solid #e5e7eb", background: "#f8fafc" },
  td: { fontSize: 13, color: "#1e293b", padding: "10px 12px", borderBottom: "1px solid #f1f5f9" },
  badge: { display: "inline-block", padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 600 },
  smallBtn: { background: "#fff", border: "1px solid #d1d5db", borderRadius: 5, padding: "4px 10px", cursor: "pointer", fontSize: 12, marginRight: 6 },
  loading: { textAlign: "center", padding: 40, color: "#888" },
  empty: { textAlign: "center", padding: 30, color: "#94a3b8", fontSize: 14 },
};

const STATUS_COLORS = {
  NEW:         { background: "#eff6ff", color: "#2563eb" },
  NEGOTIATING: { background: "#fef9c3", color: "#a16207" },
  WON:         { background: "#dcfce7", color: "#15803d" },
  LOST:        { background: "#fee2e2", color: "#b91c1c" },
};

const BUY_TYPES = ["CPM", "CPC", "CPA", "ROAS_COMMIT"];
const defaultForm = { advertiser: "", owner_email: "", source: "", est_value: "", currency: "INR" };
const defaultClose = { buy_type: "CPM", contract_value: "", currency: "INR", signed_doc_url: "" };

export default function SalesPipeline() {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(defaultForm);
  const [saving, setSaving] = useState(false);
  const [closingId, setClosingId] = useState(null);
  const [closeForm, setCloseForm] = useState(defaultClose);

  const load = () => {
    setLoading(true);
    getLeads()
      .then((d) => setLeads(d.leads || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const handleCreate = async () => {
    if (!form.advertiser || !form.owner_email) {
      alert("Advertiser and owner email are required");
      return;
    }
    setSaving(true);
    try {
      await createLead({ ...form, est_value: form.est_value ? parseFloat(form.est_value) : null });
      setShowForm(false);
      setForm(defaultForm);
      load();
    } catch (e) {
      alert("Error creating lead: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleStatus = async (lead, status) => {
    try {
      await updateLead(lead.lead_id, { negotiation_status: status });
      load();
    } catch (e) {
      alert("Error updating lead: " + e.message);
    }
  };

  const handleClose = async (leadId) => {
    if (!closeForm.contract_value) {
      alert("Contract value is required");
      return;
    }
    try {
      await closeLead(leadId, { ...closeForm, contract_value: parseFloat(closeForm.contract_value) });
      setClosingId(null);
      setCloseForm(defaultClose);
      load();
    } catch (e) {
      alert("Error closing lead: " + e.message);
    }
  };

  if (loading) return <div style={s.loading}>Loading leads…</div>;

  return (
    <div>
      <button style={s.addBtn} onClick={() => setShowForm(!showForm)}>
        {showForm ? "Cancel" : "+ New Lead"}
      </button>

      {showForm && (
        <div style={s.form}>
          <div style={s.formGrid}>
            <div style={s.formGroup}>
              <label style={s.label}>Advertiser *</label>
              <input style={s.input} value={form.advertiser} onChange={(e) => setForm({ ...form, advertiser: e.target.value })} placeholder="e.g. GIVA" />
            </div>
            <div style={s.formGroup}>
              <label style={s.label}>Owner Email *</label>
              <input style={s.input} value={form.owner_email} onChange={(e) => setForm({ ...form, owner_email: e.target.value })} placeholder="you@razorpay.com" />
            </div>
            <div style={s.formGroup}>
              <label style={s.label}>Source</label>
              <input style={s.input} value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} placeholder="inbound / referral / ..." />
            </div>
            <div style={s.formGroup}>
              <label style={s.label}>Est. Value</label>
              <input style={s.input} type="number" value={form.est_value} onChange={(e) => setForm({ ...form, est_value: e.target.value })} placeholder="0" />
            </div>
          </div>
          <div style={s.formBtns}>
            <button style={s.saveBtn} onClick={handleCreate} disabled={saving}>{saving ? "Saving…" : "Create Lead"}</button>
            <button style={s.cancelBtn} onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      )}

      {leads.length === 0 ? (
        <div style={s.empty}>No leads yet. Create one to start the pipeline.</div>
      ) : (
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>Advertiser</th>
              <th style={s.th}>Owner</th>
              <th style={s.th}>Status</th>
              <th style={s.th}>Est. Value</th>
              <th style={s.th}>Agreement</th>
              <th style={s.th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((l) => (
              <React.Fragment key={l.lead_id}>
                <tr>
                  <td style={s.td}>{l.advertiser}</td>
                  <td style={s.td}>{l.owner_email}</td>
                  <td style={s.td}>
                    <span style={{ ...s.badge, ...(STATUS_COLORS[l.negotiation_status] || {}) }}>
                      {l.negotiation_status}
                    </span>
                  </td>
                  <td style={s.td}>{l.est_value ? `${l.currency} ${l.est_value}` : "—"}</td>
                  <td style={s.td}>
                    {l.agreement_status === "SIGNED"
                      ? `${l.buy_type} · ${l.currency} ${l.contract_value}`
                      : "—"}
                  </td>
                  <td style={s.td}>
                    {l.negotiation_status !== "WON" && l.negotiation_status !== "LOST" && (
                      <>
                        {l.negotiation_status === "NEW" && (
                          <button style={s.smallBtn} onClick={() => handleStatus(l, "NEGOTIATING")}>Negotiating</button>
                        )}
                        <button style={s.smallBtn} onClick={() => setClosingId(closingId === l.lead_id ? null : l.lead_id)}>Close ▸</button>
                        <button style={s.smallBtn} onClick={() => handleStatus(l, "LOST")}>Lost</button>
                      </>
                    )}
                  </td>
                </tr>
                {closingId === l.lead_id && (
                  <tr>
                    <td style={s.td} colSpan={6}>
                      <div style={s.form}>
                        <div style={s.formGrid}>
                          <div style={s.formGroup}>
                            <label style={s.label}>Buy Type</label>
                            <select style={s.select} value={closeForm.buy_type} onChange={(e) => setCloseForm({ ...closeForm, buy_type: e.target.value })}>
                              {BUY_TYPES.map((b) => <option key={b} value={b}>{b}</option>)}
                            </select>
                          </div>
                          <div style={s.formGroup}>
                            <label style={s.label}>Contract Value *</label>
                            <input style={s.input} type="number" value={closeForm.contract_value} onChange={(e) => setCloseForm({ ...closeForm, contract_value: e.target.value })} />
                          </div>
                          <div style={s.formGroup}>
                            <label style={s.label}>Signed Doc URL</label>
                            <input style={s.input} value={closeForm.signed_doc_url} onChange={(e) => setCloseForm({ ...closeForm, signed_doc_url: e.target.value })} placeholder="https://…" />
                          </div>
                        </div>
                        <div style={s.formBtns}>
                          <button style={s.saveBtn} onClick={() => handleClose(l.lead_id)}>Close as Won → Hand off to Ops</button>
                          <button style={s.cancelBtn} onClick={() => setClosingId(null)}>Cancel</button>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
