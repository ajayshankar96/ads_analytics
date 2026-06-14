import React, { useState, useEffect } from "react";
import { getAdvertisers } from "../api";
import AdvertiserWizard from "./AdvertiserWizard";

const s = {
  addBtn: { background: "#2E5BFF", color: "#fff", border: "none", borderRadius: 8, padding: "10px 18px", cursor: "pointer", fontSize: 14, fontWeight: 700, marginBottom: 20 },
  loading: { textAlign: "center", padding: 40, color: "#888" },
  empty: { textAlign: "center", padding: 40, color: "#94a3b8", fontSize: 14, background: "#fff", borderRadius: 12, border: "1px dashed #E6EAF0" },
  list: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 14 },
  card: { display: "flex", alignItems: "center", gap: 14, background: "#fff", border: "1px solid #E6EAF0", borderRadius: 12, padding: "16px 18px", cursor: "pointer", boxShadow: "0 1px 3px rgba(15,23,36,0.05)" },
  avatar: { width: 48, height: 48, borderRadius: 12, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 19, fontWeight: 800 },
  name: { fontSize: 15.5, fontWeight: 700, color: "#0F1724", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  id: { fontSize: 12.5, fontWeight: 600, color: "#768EA7", letterSpacing: ".02em", marginTop: 2 },
  badge: { fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 20, flexShrink: 0 },
  badgeDraft: { background: "#FEF3E2", color: "#B7791F" },
  badgeLive: { background: "#E3F6EE", color: "#0F8C6A" },
};

const PALETTE = ["#B5546F", "#2E5BFF", "#0F8C6A", "#B7791F", "#7C3AED", "#0891B2", "#C8321E"];
function avatarColor(name) {
  let h = 0;
  for (let i = 0; i < (name || "").length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export default function SalesPipeline() {
  const [advertisers, setAdvertisers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [wizard, setWizard] = useState(null); // null = closed; {} = new; advertiser = resume/edit

  const load = () => {
    setLoading(true);
    getAdvertisers()
      .then((d) => setAdvertisers(d.advertisers || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const closeWizard = () => { setWizard(null); load(); };

  if (loading) return <div style={s.loading}>Loading advertisers…</div>;

  return (
    <div>
      <button style={s.addBtn} onClick={() => setWizard({})}>+ New Advertiser</button>

      {wizard !== null && (
        <AdvertiserWizard advertiser={wizard && wizard.id ? wizard : undefined} onClose={closeWizard} />
      )}

      {advertisers.length === 0 ? (
        <div style={s.empty}>No advertisers yet. Click “+ New Advertiser” to onboard one.</div>
      ) : (
        <div style={s.list}>
          {advertisers.map((adv) => {
            const live = adv.status === "ONBOARDED";
            return (
              <div key={adv.id} style={s.card} onClick={() => setWizard(adv)} title={live ? "View / edit" : "Resume draft"}>
                <div style={{ ...s.avatar, background: avatarColor(adv.name) }}>
                  {(adv.name || "?").trim().charAt(0).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={s.name}>{adv.name || "Untitled"}</div>
                  <div style={s.id}>{adv.id}</div>
                </div>
                <span style={{ ...s.badge, ...(live ? s.badgeLive : s.badgeDraft) }}>
                  {live ? "Onboarded" : "Draft"}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
