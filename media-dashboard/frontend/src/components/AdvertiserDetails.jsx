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

const btnPrimary = { background: c.blue, color: "#fff", border: "none", borderRadius: 5, padding: "4px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer" };
const btnGhost = { background: "transparent", border: `1px solid ${c.line}`, borderRadius: 5, padding: "4px 8px", fontSize: 11, cursor: "pointer", color: c.muted };
const linkBtn = { background: "transparent", border: "none", color: c.blue, fontSize: 11, fontWeight: 600, cursor: "pointer", padding: 0 };
const inp = (w) => ({ border: `1px solid ${c.blue}`, borderRadius: 6, padding: "4px 8px", fontSize: 13, fontWeight: 600, width: w, outline: "none" });

// Per-month budget list for MONTHLY advertisers. Lock rules mirror the
// backend: past months are immutable, the current month locks once its
// value is set (unlocks next month), future months stay editable.
// Admins bypass the locks.
function BudgetMonths({ a, canEdit, isAdmin, onUpdate }) {
  const months = a.budget_months && typeof a.budget_months === "object" ? a.budget_months : {};
  const keys = Object.keys(months).sort();
  const curMonth = new Date().toISOString().slice(0, 7);
  const [editing, setEditing] = useState(null);   // month key being edited
  const [editVal, setEditVal] = useState("");
  const [adding, setAdding] = useState(false);
  const [newMonth, setNewMonth] = useState("");
  const [newAmt, setNewAmt] = useState("");
  const [saving, setSaving] = useState(false);

  const monthLabel = (m) => {
    const [y, mo] = m.split("-").map(Number);
    return new Date(y, mo - 1, 1).toLocaleString("en-IN", { month: "short", year: "numeric" });
  };
  const isPast = (m) => m < curMonth;
  const isLocked = (m) => m === curMonth && String(months[m] || "").trim() !== "";
  const editableMonth = (m) => canEdit && (isAdmin || (!isPast(m) && !isLocked(m)));
  const defaultNewMonth = () => {
    if (!keys.length) return curMonth;
    const [y, mo] = keys[keys.length - 1].split("-").map(Number);
    return new Date(Date.UTC(y, mo, 1)).toISOString().slice(0, 7);
  };

  const saveMap = async (map) => {
    setSaving(true);
    try {
      await updateAdvertiser(a.id, { budget_months: map });
      onUpdate("budget_months", map);
      setEditing(null); setAdding(false); setNewMonth(""); setNewAmt("");
    } catch (e) {
      alert("Save failed: " + e.message);
    } finally { setSaving(false); }
  };

  const startEdit = (m) => { setEditVal(String(months[m] || "")); setEditing(m); };
  const saveEdit = () => saveMap({ ...months, [editing]: editVal });
  const removeMonth = (m) => {
    if (!window.confirm(`Remove the ${monthLabel(m)} budget?`)) return;
    const map = { ...months };
    delete map[m];
    saveMap(map);
  };
  const saveNew = () => {
    if (!newMonth || !newAmt.trim()) { alert("Pick a month and enter an amount."); return; }
    saveMap({ ...months, [newMonth]: newAmt.trim() });
  };

  const chip = (bg, color, text) => (
    <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 10, background: bg, color, whiteSpace: "nowrap" }}>{text}</span>
  );

  return (
    <div>
      {keys.length === 0 && (
        <div style={{ ...s.row, borderBottom: "none" }}>
          <span style={s.key}>Monthly budgets</span>
          <span style={{ ...s.val, color: c.muted, fontWeight: 500 }}>None set</span>
        </div>
      )}
      {keys.map((m) => {
        const past = isPast(m), locked = isLocked(m);
        if (editing === m) {
          return (
            <div style={s.row} key={m}>
              <span style={s.key}>{monthLabel(m)}</span>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                  autoFocus value={editVal} onChange={(e) => setEditVal(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditing(null); }}
                  style={{ ...inp(140), textAlign: "right" }}
                />
                <button onClick={saveEdit} disabled={saving} style={btnPrimary}>{saving ? "..." : "Save"}</button>
                <button onClick={() => setEditing(null)} style={btnGhost}>Cancel</button>
              </div>
            </div>
          );
        }
        return (
          <div style={{ ...s.row, opacity: past ? 0.65 : 1 }} key={m}>
            <span style={s.key}>{monthLabel(m)}</span>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {past && chip("#F1F5F9", c.muted, "past")}
              {locked && chip("#FDF3E1", "#B7791F", "🔒 locked this month")}
              {!past && !locked && m > curMonth && chip("#EAF1FF", c.blue, "upcoming")}
              <span style={s.val}>{String(months[m] || "").trim() ? `₹${months[m]}` : "—"}</span>
              {editableMonth(m) && (
                <>
                  <button onClick={() => startEdit(m)} style={linkBtn}>Edit</button>
                  <button onClick={() => removeMonth(m)} style={{ ...linkBtn, color: c.muted, fontSize: 14 }} title="Remove month">×</button>
                </>
              )}
            </div>
          </div>
        );
      })}
      {canEdit && (adding ? (
        <div style={{ ...s.row, borderBottom: "none", justifyContent: "flex-start" }}>
          <input type="month" min={isAdmin ? undefined : curMonth} value={newMonth} onChange={(e) => setNewMonth(e.target.value)} style={inp(140)} />
          <input
            placeholder="e.g. 5,00,000" value={newAmt} onChange={(e) => setNewAmt(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") saveNew(); if (e.key === "Escape") setAdding(false); }}
            style={inp(130)}
          />
          <button onClick={saveNew} disabled={saving} style={btnPrimary}>{saving ? "..." : "Save"}</button>
          <button onClick={() => setAdding(false)} style={btnGhost}>Cancel</button>
        </div>
      ) : (
        <div style={{ padding: "8px 0 2px" }}>
          <button
            onClick={() => { setNewMonth(defaultNewMonth()); setNewAmt(""); setAdding(true); }}
            style={{ border: `1px dashed ${c.line}`, background: "#fff", color: c.blue, fontSize: 12, fontWeight: 600, borderRadius: 7, padding: "6px 12px", cursor: "pointer" }}
          >+ Add month</button>
        </div>
      ))}
      {canEdit && !isAdmin && (
        <div style={{ fontSize: 11.5, color: c.muted, marginTop: 6, fontStyle: "italic" }}>
          The current month locks once its budget is set — it unlocks next month. Past months can't be changed.
        </div>
      )}
    </div>
  );
}

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
          {fieldKey === "buy_type" || fieldKey === "budget_type" ? (
            <select
              autoFocus
              value={editVal || (fieldKey === "buy_type" ? "ROAS" : "AGNOSTIC")}
              onChange={(e) => setEditVal(e.target.value)}
              onKeyDown={handleKeyDown}
              style={{ border: `1px solid ${c.blue}`, borderRadius: 6, padding: "4px 8px", fontSize: 13, fontWeight: 600, width: 180, textAlign: "right", outline: "none" }}
            >
              {fieldKey === "buy_type" ? (
                <>
                  <option value="ROAS">ROAS</option>
                  <option value="CPC">CPC</option>
                </>
              ) : (
                <>
                  <option value="AGNOSTIC">Date-agnostic</option>
                  <option value="MONTHLY">Monthly</option>
                </>
              )}
            </select>
          ) : (
            <input
              autoFocus
              value={editVal}
              onChange={(e) => setEditVal(e.target.value)}
              onKeyDown={handleKeyDown}
              style={{ border: `1px solid ${c.blue}`, borderRadius: 6, padding: "4px 8px", fontSize: 13, fontWeight: 600, width: 180, textAlign: "right", outline: "none" }}
            />
          )}
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

export default function AdvertiserDetails({ advertiser, onClose, userEmail = "", userRole = "VIEWER" }) {
  const [a, setA] = useState({ ...(advertiser || {}) });
  const v = (x) => (x === "" || x === undefined || x === null ? "—" : String(x));

  const isOwner = userEmail && a.owner_email && userEmail.toLowerCase() === a.owner_email.toLowerCase();
  const isAdmin = userRole === "ADMIN";
  // Budget fields: only the advertiser's owner may change them, with
  // ADMIN as the escape hatch (enforced server-side too).
  const canEditBudget = isOwner || isAdmin;
  const isMonthly = (a.budget_type || "AGNOSTIC") === "MONTHLY";

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
      { label: "Budget type", value: isMonthly ? "Monthly" : "Date-agnostic", field: "budget_type", budget: true },
      ...(isMonthly
        ? [{ custom: "budget_months" }]
        : [{ label: "Default budget", value: a.budget_hint ? `₹${a.budget_hint}` : "—", field: "budget_hint", budget: true }]),
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
            {isAdmin
              ? "Admin view — only budget settings are editable here; other fields belong to the owner."
              : "View only — only the owner can edit fields."}
          </div>
        )}

        <div style={s.body}>
          {groups.map((g) => (
            <div style={s.group} key={g.title}>
              <div style={s.groupTitle}>{g.title}</div>
              {g.rows.map((row) => (
                row.custom === "budget_months" ? (
                  <BudgetMonths key="budget_months" a={a} canEdit={canEditBudget} isAdmin={isAdmin} onUpdate={handleUpdate} />
                ) : (
                  <EditableRow
                    key={row.label}
                    label={row.label}
                    value={row.value}
                    fieldKey={row.field}
                    advertiser={a}
                    onUpdate={handleUpdate}
                    canEdit={row.budget ? canEditBudget : isOwner}
                  />
                )
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
