import React, { useState } from "react";
import { updateAdvertiser } from "../api";

const c = { blue: "#2E5BFF", ink: "#0F1724", sub: "#52606D", line: "#E6EAF0", muted: "#768EA7", green: "#0F8C6A" };

const s = {
  overlay: { position: "fixed", inset: 0, background: "rgba(15,23,36,0.45)", zIndex: 10000,
    display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "32px 20px", overflowY: "auto" },
  modal: { background: "#fff", borderRadius: 16, width: "100%", maxWidth: 720,
    boxShadow: "0 20px 60px rgba(15,23,36,0.25)", overflow: "hidden", display: "flex", flexDirection: "column" },
  header: { padding: "24px 32px 18px", display: "flex", justifyContent: "space-between", alignItems: "flex-start" },
  eyebrow: { fontSize: 12, fontWeight: 700, letterSpacing: ".06em", color: c.green, textTransform: "uppercase", marginBottom: 6 },
  title: { fontSize: 24, fontWeight: 800, color: c.ink, letterSpacing: "-.01em" },
  id: { fontSize: 13, color: c.muted, marginTop: 4, fontWeight: 600 },
  close: { width: 38, height: 38, borderRadius: 9, border: `1px solid ${c.line}`, background: "#fff", cursor: "pointer", fontSize: 18, color: c.muted, lineHeight: 1 },
  body: { padding: "0 32px 28px", maxHeight: "70vh", overflowY: "auto" },
  group: { border: `1px solid ${c.line}`, borderRadius: 12, padding: "16px 18px", marginBottom: 14 },
  groupTitle: { fontSize: 13, fontWeight: 800, color: c.blue, textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 12 },
  row: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, padding: "7px 0", fontSize: 13.5, borderBottom: `1px solid #F7F8FA` },
  key: { color: c.muted, minWidth: 140, flexShrink: 0 },
  val: { color: c.ink, fontWeight: 600, textAlign: "right", whiteSpace: "nowrap" },
  badge: { display: "inline-block", fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20, background: "#E3F6EE", color: c.green },
};

function EditableRow({ label, value, fieldKey, advertiser, onUpdate, canEdit }) {
  const [hovered, setHovered] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState("");
  const [saving, setSaving] = useState(false);

  const editable = canEdit && fieldKey;

  const startEdit = () => {
    if (!editable) return;
    const raw = advertiser[fieldKey];
    setEditVal(raw === null || raw === undefined ? "" : String(raw));
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      let payload = {};
      if (fieldKey === "cc_finance") {
        payload[fieldKey] = editVal.toLowerCase() === "yes" || editVal === "true";
      } else if (["roas_multiplier", "cpc_rate", "target_roas", "target_cac"].includes(fieldKey)) {
        payload[fieldKey] = editVal ? parseFloat(editVal) : null;
      } else {
        payload[fieldKey] = editVal || null;
      }
      await updateAdvertiser(advertiser.id, payload);
      onUpdate(fieldKey, payload[fieldKey]);
      setEditing(false);
    } catch (e) {
      alert("Save failed: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => setEditing(false);

  const handleKeyDown = (e) => {
    if (e.key === "Enter") save();
    if (e.key === "Escape") cancel();
  };

  if (editing) {
    return (
      <div style={s.row}>
        <span style={s.key}>{label}</span>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            autoFocus
            value={editVal}
            onChange={(e) => setEditVal(e.target.value)}
            onKeyDown={handleKeyDown}
            style={{ border: `1px solid ${c.blue}`, borderRadius: 6, padding: "4px 8px", fontSize: 13, fontWeight: 600, width: 180, textAlign: "right", outline: "none" }}
          />
          <button onClick={save} disabled={saving} style={{ background: c.blue, color: "#fff", border: "none", borderRadius: 5, padding: "4px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
            {saving ? "..." : "Save"}
          </button>
          <button onClick={cancel} style={{ background: "transparent", border: `1px solid ${c.line}`, borderRadius: 5, padding: "4px 8px", fontSize: 11, cursor: "pointer", color: c.muted }}>Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{ ...s.row, cursor: editable ? "pointer" : "default", background: hovered && editable ? "#F7F9FC" : "transparent", borderRadius: 4, transition: "background 0.15s" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={startEdit}
    >
      <span style={s.key}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={s.val}>{value}</span>
        {hovered && editable && (
          <span style={{ fontSize: 11, color: c.blue, fontWeight: 600 }}>Edit</span>
        )}
      </div>
    </div>
  );
}

export default function AdvertiserDetails({ advertiser, onClose, userEmail = "" }) {
  const [a, setA] = useState({ ...(advertiser || {}) });
  const v = (x) => (x === "" || x === undefined || x === null ? "—" : String(x));

  const isOwner = userEmail && a.owner_email && userEmail.toLowerCase() === a.owner_email.toLowerCase();

  const handleUpdate = (fieldKey, newValue) => {
    setA((prev) => ({ ...prev, [fieldKey]: newValue }));
  };

  const rate = a.buy_type === "ROAS"
    ? (a.roas_multiplier ? `${a.roas_multiplier}x ROAS` : "—")
    : (a.cpc_rate ? `₹${a.cpc_rate} / click` : "—");
  const target = a.goal_type === "ROAS"
    ? (a.target_roas ? `${a.target_roas}x` : "—")
    : (a.target_cac ? `₹${a.target_cac}` : "—");

  const groups = [
    { title: "Basics", rows: [
      { label: "Advertiser name", value: v(a.name), field: "name" },
      { label: "Industry / Category", value: v(a.category), field: "category" },
      { label: "Brand logo", value: v(a.logo_name), field: "logo_name" },
      { label: "Description", value: v(a.description), field: "description" },
    ]},
    { title: "Commercial", rows: [
      { label: "Buy type", value: v(a.buy_type), field: "buy_type" },
      { label: "Rate", value: rate, field: a.buy_type === "ROAS" ? "roas_multiplier" : "cpc_rate" },
      { label: "Budget hint", value: a.budget_hint ? `₹${a.budget_hint}` : "—", field: "budget_hint" },
      { label: "GST", value: v(a.gst), field: "gst" },
      { label: "PAN", value: v(a.pan), field: "pan" },
    ]},
    { title: "Performance Goal", rows: [
      { label: "Goal type", value: v(a.goal_type), field: "goal_type" },
      { label: "Target", value: target, field: a.goal_type === "ROAS" ? "target_roas" : "target_cac" },
    ]},
    { title: "Point of Contact", rows: [
      { label: "Name", value: v(a.poc_name), field: "poc_name" },
      { label: "Designation", value: v(a.poc_designation), field: "poc_designation" },
      { label: "Email", value: v(a.poc_email), field: "poc_email" },
      { label: "Phone", value: a.poc_phone ? `+91 ${a.poc_phone}` : "—", field: "poc_phone" },
      { label: "CC finance", value: a.cc_finance ? "Yes" : "No", field: "cc_finance" },
    ]},
    { title: "Agreement & PO", rows: [
      { label: "Legal agreement", value: v(a.agreement_name), field: "agreement_name" },
      { label: "PO", value: v(a.po_name), field: "po_name" },
      { label: "PO reference", value: v(a.po_ref), field: "po_ref" },
      { label: "Contract start", value: v(a.contract_start), field: "contract_start" },
    ]},
  ];

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={(e) => e.stopPropagation()}>
        <div style={s.header}>
          <div>
            <div style={s.eyebrow}>Onboarded Advertiser</div>
            <div style={s.title}>{a.name || "Advertiser"}</div>
            <div style={s.id}>
              {a.id} &nbsp;<span style={s.badge}>Onboarded</span>
            </div>
            {a.owner_email && (
              <div style={{ fontSize: 12, color: c.muted, marginTop: 6 }}>
                Owner: <span style={{ fontWeight: 600, color: c.ink }}>{a.owner_email}</span>
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={s.close} onClick={onClose} aria-label="Close">✕</button>
          </div>
        </div>

        {!isOwner && (
          <div style={{ padding: "0 32px 12px", fontSize: 12, color: c.muted, fontStyle: "italic" }}>
            View only — only the owner can edit fields.
          </div>
        )}

        <div style={s.body}>
          {groups.map((g) => (
            <div style={s.group} key={g.title}>
              <div style={s.groupTitle}>{g.title}</div>
              {g.rows.map((row) => (
                <EditableRow
                  key={row.label}
                  label={row.label}
                  value={row.value}
                  fieldKey={row.field}
                  advertiser={a}
                  onUpdate={handleUpdate}
                  canEdit={isOwner}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
