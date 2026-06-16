import React, { useState, useEffect } from "react";
import { getAdvertisers } from "../api";
import AdvertiserWizard from "./AdvertiserWizard";
import AdvertiserDetails from "./AdvertiserDetails";

const c = { ink: "#0F1724", sub: "#52606D", muted: "#768EA7", line: "#E6EAF0", blue: "#2E5BFF", green: "#0F8C6A", amber: "#B7791F" };

const s = {
  addBtn: { background: c.blue, color: "#fff", border: "none", borderRadius: 8, padding: "10px 18px", cursor: "pointer", fontSize: 14, fontWeight: 700, marginBottom: 20 },
  loading: { textAlign: "center", padding: 40, color: "#888" },
  empty: { textAlign: "center", padding: 40, color: "#94a3b8", fontSize: 14, background: "#fff", borderRadius: 12, border: "1px dashed " + c.line },
  wrap: { background: "#fff", border: "1px solid " + c.line, borderRadius: 12, overflow: "hidden", overflowX: "auto", boxShadow: "0 1px 3px rgba(15,23,36,0.05)" },
  table: { width: "100%", borderCollapse: "collapse", minWidth: 920 },
  th: { textAlign: "left", fontSize: 11, fontWeight: 700, color: c.muted, textTransform: "uppercase", letterSpacing: ".04em", padding: "14px 18px", background: "#F7F8FA", borderBottom: "1px solid " + c.line, whiteSpace: "nowrap" },
  thRight: { textAlign: "right" },
  tr: { cursor: "pointer", borderBottom: "1px solid #F1F5F9" },
  td: { padding: "14px 18px", fontSize: 13.5, color: c.ink, verticalAlign: "middle" },
  tdRight: { textAlign: "right", whiteSpace: "nowrap" },
  advCell: { display: "flex", alignItems: "center", gap: 12 },
  avatar: { width: 42, height: 42, borderRadius: 11, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 17, fontWeight: 800 },
  name: { fontSize: 14.5, fontWeight: 700, color: c.ink },
  id: { fontSize: 12, fontWeight: 600, color: c.muted, letterSpacing: ".02em", marginTop: 1 },
  cat: { color: c.blue, fontWeight: 600 },
  pill: { display: "inline-block", fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 20, background: "#EAF0FF", color: c.blue, marginRight: 8 },
  rate: { fontWeight: 700, color: c.ink },
  goalMain: { fontWeight: 600, color: c.ink },
  goalSub: { fontSize: 12, color: c.muted, marginTop: 2 },
  badge: { display: "inline-block", fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 20 },
  badgeLive: { background: "#E3F6EE", color: c.green },
  badgeDraft: { background: "#FEF3E2", color: c.amber },
  stageSub: { fontSize: 11.5, color: c.muted, marginTop: 3 },
  dash: { color: "#B0B8C4" },
};

const PALETTE = ["#B5546F", "#2E5BFF", "#0F8C6A", "#B7791F", "#7C3AED", "#0891B2", "#C8321E"];
function avatarColor(name) {
  let h = 0;
  for (let i = 0; i < (name || "").length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

const STAGE_NAMES = ["Basics", "Commercial", "Performance Goal", "POC", "Agreement", "Review", "Send Email"];
const stageLabel = (n) => STAGE_NAMES[((n || 1) - 1)] || "Basics";
const dash = <span style={s.dash}>—</span>;

function rateText(a) {
  if (a.buy_type === "ROAS") return a.roas_multiplier != null ? `${a.roas_multiplier}x` : "—";
  if (a.buy_type === "CPC") return a.cpc_rate != null ? `₹${a.cpc_rate}/click` : "—";
  return "—";
}
function goalText(a) {
  if (a.goal_type === "ROAS") return a.target_roas != null ? `ROAS ${a.target_roas}x` : "ROAS";
  if (a.goal_type === "CAC") return a.target_cac != null ? `CAC ₹${a.target_cac}` : "CAC";
  return null;
}
function budgetText(a) {
  if (!a.budget_hint) return dash;
  const n = parseFloat(String(a.budget_hint).replace(/[^\d.]/g, ""));
  if (isNaN(n) || n === 0) return a.budget_hint;
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)} Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(2)} L`;
  return `₹${n.toLocaleString("en-IN")}`;
}

function fmtDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

const MailIcon = ({ color }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-10 5L2 7" />
  </svg>
);
const EyeIcon = ({ color = "#52606D" }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" />
  </svg>
);

export default function SalesPipeline() {
  const [advertisers, setAdvertisers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [wizard, setWizard] = useState(null);
  const [emailModal, setEmailModal] = useState(null);
  const [viewAdv, setViewAdv] = useState(null);

  const load = () => {
    setLoading(true);
    getAdvertisers().then((d) => setAdvertisers(d.advertisers || [])).catch(console.error).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const closeWizard = () => { setWizard(null); load(); };

  if (loading) return <div style={s.loading}>Loading advertisers…</div>;

  return (
    <div>
      <button style={s.addBtn} onClick={() => setWizard({})}>+ New Advertiser</button>
      {wizard !== null && <AdvertiserWizard advertiser={wizard && wizard.id ? wizard : undefined} onClose={closeWizard} />}
      {viewAdv !== null && <AdvertiserDetails advertiser={viewAdv} onClose={() => setViewAdv(null)} />}

      {advertisers.length === 0 ? (
        <div style={s.empty}>No advertisers yet. Click “+ New Advertiser” to onboard one.</div>
      ) : (
        <div style={s.wrap}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Advertiser</th>
                <th style={s.th}>Category</th>
                <th style={s.th}>Buy type · Rate</th>
                <th style={s.th}>Performance goal</th>
                <th style={{ ...s.th, ...s.thRight }}>Total budget</th>
                <th style={{ ...s.th, ...s.thRight }}>Live offers</th>
                <th style={{ ...s.th, textAlign: "center" }}>Email</th>
                <th style={s.th}>Status</th>
                <th style={{ ...s.th, textAlign: "center" }}>Details</th>
              </tr>
            </thead>
            <tbody>
              {advertisers.map((a) => {
                const live = a.status === "ONBOARDED";
                const goal = goalText(a);
                return (
                  <tr key={a.id} style={s.tr} onClick={() => live ? setViewAdv(a) : setWizard(a)} title={live ? "View details" : "Resume draft"}>
                    <td style={s.td}>
                      <div style={s.advCell}>
                        <div style={{ ...s.avatar, background: avatarColor(a.name) }}>{(a.name || "?").trim().charAt(0).toUpperCase()}</div>
                        <div>
                          <div style={s.name}>{a.name || "Untitled"}</div>
                          <div style={s.id}>{a.id}</div>
                        </div>
                      </div>
                    </td>
                    <td style={s.td}>{a.category ? <span style={s.cat}>{a.category}</span> : dash}</td>
                    <td style={s.td}>
                      {a.buy_type ? <><span style={s.pill}>{a.buy_type}</span><span style={s.rate}>{rateText(a)}</span></> : dash}
                    </td>
                    <td style={s.td}>
                      {goal ? <><div style={s.goalMain}>{goal}</div><div style={s.goalSub}>brand-level</div></> : dash}
                    </td>
                    <td style={{ ...s.td, ...s.tdRight }}>{budgetText(a)}</td>
                    <td style={{ ...s.td, ...s.tdRight }}>{dash}</td>
                    <td style={{ ...s.td, textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
                      {a.welcome_email_sent_at ? (
                        <span
                          title={`Welcome email sent · ${fmtDateTime(a.welcome_email_sent_at)} · click to view`}
                          onClick={() => setEmailModal(a)}
                          style={{ cursor: "pointer", display: "inline-flex" }}
                        >
                          <MailIcon color="#0F8C6A" />
                        </span>
                      ) : (
                        <span title="Welcome email not sent yet" style={{ display: "inline-flex", opacity: 0.6 }}>
                          <MailIcon color="#B0B8C4" />
                        </span>
                      )}
                    </td>
                    <td style={s.td}>
                      <span style={{ ...s.badge, ...(live ? s.badgeLive : s.badgeDraft) }}>{live ? "Onboarded" : "Draft"}</span>
                      {!live && <div style={s.stageSub}>Step {a.current_step || 1}/7 · {stageLabel(a.current_step)}</div>}
                    </td>
                    <td style={{ ...s.td, textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
                      <span title="Open advertiser details" onClick={() => live ? setViewAdv(a) : setWizard(a)} style={{ cursor: "pointer", display: "inline-flex" }}>
                        <EyeIcon />
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {emailModal && (
        <div
          onClick={() => setEmailModal(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(15,23,36,0.45)", zIndex: 10000, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "48px 20px", overflowY: "auto" }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 14, width: "100%", maxWidth: 640, boxShadow: "0 20px 60px rgba(15,23,36,0.25)", overflow: "hidden" }}>
            <div style={{ padding: "18px 22px", borderBottom: "1px solid " + c.line, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800, color: c.ink }}>Welcome email</div>
                <div style={{ fontSize: 12, color: c.muted, marginTop: 2 }}>
                  {emailModal.name} · sent {fmtDateTime(emailModal.welcome_email_sent_at)}
                </div>
              </div>
              <button onClick={() => setEmailModal(null)} style={{ width: 34, height: 34, borderRadius: 8, border: "1px solid " + c.line, background: "#fff", cursor: "pointer", fontSize: 16, color: c.muted }}>✕</button>
            </div>
            <div style={{ padding: "18px 22px" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: c.muted, textTransform: "uppercase", letterSpacing: ".04em" }}>To</div>
              <div style={{ fontSize: 14, color: c.ink, margin: "4px 0 14px" }}>{emailModal.welcome_email_to || "—"}</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: c.muted, textTransform: "uppercase", letterSpacing: ".04em" }}>Subject</div>
              <div style={{ fontSize: 14, color: c.ink, fontWeight: 600, margin: "4px 0 14px" }}>{emailModal.welcome_email_subject || "—"}</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: c.muted, textTransform: "uppercase", letterSpacing: ".04em" }}>Body</div>
              <div style={{ fontSize: 14, color: c.ink, marginTop: 6, whiteSpace: "pre-wrap", lineHeight: 1.5, background: "#F7F8FA", borderRadius: 10, padding: "14px 16px" }}>
                {emailModal.welcome_email_body || "—"}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
