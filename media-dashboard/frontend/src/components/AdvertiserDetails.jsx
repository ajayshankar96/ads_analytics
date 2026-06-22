import React from "react";

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
  row: { display: "flex", justifyContent: "space-between", gap: 16, padding: "7px 0", fontSize: 13.5, borderBottom: `1px solid #F7F8FA` },
  key: { color: c.muted, minWidth: 140 },
  val: { color: c.ink, fontWeight: 600, textAlign: "right", maxWidth: "60%", wordBreak: "break-word" },
  badge: { display: "inline-block", fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20, background: "#E3F6EE", color: c.green },
};

export default function AdvertiserDetails({ advertiser, onClose, onEdit }) {
  const a = advertiser || {};
  const v = (x) => (x === "" || x === undefined || x === null ? "—" : String(x));

  const rate = a.buy_type === "ROAS"
    ? (a.roas_multiplier ? `${a.roas_multiplier}x ROAS` : "—")
    : (a.cpc_rate ? `₹${a.cpc_rate} / click` : "—");
  const target = a.goal_type === "ROAS"
    ? (a.target_roas ? `${a.target_roas}x` : "—")
    : (a.target_cac ? `₹${a.target_cac}` : "—");

  const groups = [
    { title: "Basics", rows: [["Advertiser name", v(a.name)], ["Industry / Category", v(a.category)], ["Brand logo", v(a.logo_name)], ["Description", v(a.description)]] },
    { title: "Commercial", rows: [["Buy type", v(a.buy_type)], ["Rate", rate], ["Budget hint", a.budget_hint ? `₹${a.budget_hint}` : "—"], ["GST", v(a.gst)], ["PAN", v(a.pan)]] },
    { title: "Performance Goal", rows: [["Goal type", v(a.goal_type)], ["Target", target]] },
    { title: "Point of Contact", rows: [["Name", v(a.poc_name)], ["Designation", v(a.poc_designation)], ["Email", v(a.poc_email)], ["Phone", a.poc_phone ? `+91 ${a.poc_phone}` : "—"], ["CC finance", a.cc_finance ? "Yes" : "No"]] },
    { title: "Agreement & PO", rows: [["Legal agreement", v(a.agreement_name)], ["PO", v(a.po_name)], ["PO reference", v(a.po_ref)], ["Contract start", v(a.contract_start)]] },
  ];

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={(e) => e.stopPropagation()}>
        <div style={s.header}>
          <div>
            <div style={s.eyebrow}>Onboarded Advertiser</div>
            <div style={s.title}>{a.name || "Advertiser"}</div>
            <div style={s.id}>{a.id} &nbsp;<span style={s.badge}>Onboarded</span></div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {onEdit && <button style={{ ...s.close, fontSize: 15 }} onClick={onEdit} aria-label="Edit" title="Edit advertiser">✏️</button>}
            <button style={s.close} onClick={onClose} aria-label="Close">✕</button>
          </div>
        </div>
        <div style={s.body}>
          {groups.map((g) => (
            <div style={s.group} key={g.title}>
              <div style={s.groupTitle}>{g.title}</div>
              {g.rows.map(([k, val]) => (
                <div style={s.row} key={k}><span style={s.key}>{k}</span><span style={s.val}>{val}</span></div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
