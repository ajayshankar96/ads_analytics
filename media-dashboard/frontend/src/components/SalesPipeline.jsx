import React, { useState, useEffect } from "react";
import { getAdvertisers, recordWelcomeEmail } from "../api";
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
  ownerName: { fontWeight: 600, color: c.ink },
  ownerEmail: { fontSize: 12, color: c.muted, marginTop: 2 },
  badge: { display: "inline-block", fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 20 },
  badgeLive: { background: "#E3F6EE", color: c.green },
  badgeDraft: { background: "#FEF3E2", color: c.amber },
  stageSub: { fontSize: 11.5, color: c.muted, marginTop: 3 },
  dash: { color: "#B0B8C4" },
  headerRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 20 },
  filterBar: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" },
  select: { border: `1px solid ${c.line}`, borderRadius: 8, padding: "8px 10px", fontSize: 13, fontWeight: 600, color: c.ink, background: "#fff", outline: "none", cursor: "pointer", maxWidth: 180 },
  clearBtn: { background: "transparent", border: "none", color: c.blue, fontSize: 12.5, fontWeight: 700, cursor: "pointer", padding: "4px 2px" },
  count: { fontSize: 12.5, color: c.muted, fontWeight: 600, whiteSpace: "nowrap" },
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
function ownerNameFromEmail(email) {
  const local = (email || "").split("@")[0];
  const name = local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  return name || email;
}

function ownerText(a) {
  const email = (a.owner_email || "").trim();
  if (!email) return null;
  return { name: ownerNameFromEmail(email), email };
}
function budgetText(a) {
  // MONTHLY advertisers surface the effective (current-month) budget with
  // a /mo suffix; AGNOSTIC ones keep the plain hint.
  const monthly = a.budget_type === "MONTHLY";
  const raw = monthly ? a.budget_effective : (a.budget_effective ?? a.budget_hint);
  if (!raw) return dash;
  const suffix = monthly ? "/mo" : "";
  const n = parseFloat(String(raw).replace(/[^\d.]/g, ""));
  if (isNaN(n) || n === 0) return `${raw}${suffix}`;
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)} Cr${suffix}`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(2)} L${suffix}`;
  return `₹${n.toLocaleString("en-IN")}${suffix}`;
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

function MarkSentIcon({ advertiser, userEmail, onMarked }) {
  const [hovered, setHovered] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const isOwner = userEmail && advertiser.owner_email && userEmail.toLowerCase() === advertiser.owner_email.toLowerCase();

  const handleMark = async () => {
    setSaving(true);
    try {
      await recordWelcomeEmail(advertiser.id, { to: advertiser.poc_email || "offline", subject: "Sent offline", body: "Marked as sent offline by owner" });
      setConfirming(false);
      if (onMarked) onMarked();
    } catch (e) {
      alert("Failed to mark: " + e.message);
    } finally { setSaving(false); }
  };

  if (confirming) {
    return (
      <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        <span style={{ fontSize: 10, fontWeight: 600, color: c.ink, whiteSpace: "nowrap" }}>Mailed offline?</span>
        <button onClick={handleMark} disabled={saving} style={{ background: c.green, color: "#fff", border: "none", borderRadius: 5, padding: "3px 8px", fontSize: 10, fontWeight: 700, cursor: "pointer" }}>
          {saving ? "..." : "Confirm"}
        </button>
        <button onClick={() => { setConfirming(false); setHovered(false); }} style={{ background: "transparent", border: `1px solid ${c.line}`, borderRadius: 5, padding: "3px 6px", fontSize: 10, cursor: "pointer", color: c.muted }}>No</button>
      </div>
    );
  }

  return (
    <span
      title={isOwner ? "Click to mark email as sent (offline)" : "Welcome email not sent yet"}
      style={{ display: "inline-flex", opacity: hovered && isOwner ? 1 : 0.6, cursor: isOwner ? "pointer" : "default", transition: "opacity 0.15s" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => isOwner && setConfirming(true)}
    >
      <MailIcon color={hovered && isOwner ? c.green : "#B0B8C4"} />
    </span>
  );
}

export default function SalesPipeline({ userRole = "VIEWER", userEmail = "" }) {
  const canEdit = ["CREATOR", "ADMIN", "SALES"].includes(userRole);
  const [advertisers, setAdvertisers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [wizard, setWizard] = useState(null);
  const [emailModal, setEmailModal] = useState(null);
  const [viewAdv, setViewAdv] = useState(null);

  // Filters — options are derived from the loaded advertisers.
  const [fOwner, setFOwner] = useState("");
  const [fCategory, setFCategory] = useState("");
  const [fBuyType, setFBuyType] = useState("");
  const [fStatus, setFStatus] = useState("");

  const load = () => {
    setLoading(true);
    getAdvertisers().then((d) => setAdvertisers(d.advertisers || [])).catch(console.error).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const closeWizard = () => { setWizard(null); load(); };

  const ownerOptions = [...new Set(
    advertisers.map((a) => (a.owner_email || "").trim().toLowerCase()).filter(Boolean)
  )].sort();
  const categoryOptions = [...new Set(advertisers.map((a) => a.category).filter(Boolean))].sort();
  const buyTypeOptions = [...new Set(advertisers.map((a) => a.buy_type).filter(Boolean))].sort();

  const hasFilters = !!(fOwner || fCategory || fBuyType || fStatus);
  const clearFilters = () => { setFOwner(""); setFCategory(""); setFBuyType(""); setFStatus(""); };

  const filtered = advertisers.filter((a) => {
    if (fOwner && (a.owner_email || "").trim().toLowerCase() !== fOwner) return false;
    if (fCategory && (a.category || "") !== fCategory) return false;
    if (fBuyType && (a.buy_type || "") !== fBuyType) return false;
    if (fStatus === "ONBOARDED" && a.status !== "ONBOARDED") return false;
    if (fStatus === "DRAFT" && a.status === "ONBOARDED") return false;
    return true;
  });

  if (loading) return <div style={s.loading}>Loading advertisers…</div>;

  return (
    <div>
      <div style={s.headerRow}>
        {canEdit ? <button style={{ ...s.addBtn, marginBottom: 0 }} onClick={() => setWizard({})}>+ New Advertiser</button> : <div />}
        {advertisers.length > 0 && (
          <div style={s.filterBar}>
            <select style={s.select} value={fOwner} onChange={(e) => setFOwner(e.target.value)} title="Filter by owner">
              <option value="">All owners</option>
              {ownerOptions.map((em) => <option key={em} value={em}>{ownerNameFromEmail(em)}</option>)}
            </select>
            <select style={s.select} value={fCategory} onChange={(e) => setFCategory(e.target.value)} title="Filter by category">
              <option value="">All categories</option>
              {categoryOptions.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
            </select>
            <select style={s.select} value={fBuyType} onChange={(e) => setFBuyType(e.target.value)} title="Filter by buy type">
              <option value="">All buy types</option>
              {buyTypeOptions.map((bt) => <option key={bt} value={bt}>{bt}</option>)}
            </select>
            <select style={s.select} value={fStatus} onChange={(e) => setFStatus(e.target.value)} title="Filter by status">
              <option value="">All statuses</option>
              <option value="ONBOARDED">Onboarded</option>
              <option value="DRAFT">Draft</option>
            </select>
            {hasFilters && (
              <>
                <span style={s.count}>{filtered.length} of {advertisers.length}</span>
                <button style={s.clearBtn} onClick={clearFilters}>Clear</button>
              </>
            )}
          </div>
        )}
      </div>
      {wizard !== null && <AdvertiserWizard advertiser={wizard && wizard.id ? wizard : undefined} onClose={closeWizard} userEmail={userEmail} />}
      {viewAdv !== null && <AdvertiserDetails advertiser={viewAdv} onClose={() => { setViewAdv(null); load(); }} userEmail={userEmail} userRole={userRole} />}

      {advertisers.length === 0 ? (
        <div style={s.empty}>No advertisers yet. Click “+ New Advertiser” to onboard one.</div>
      ) : filtered.length === 0 ? (
        <div style={s.empty}>
          No advertisers match the current filters.{" "}
          <span style={{ ...s.clearBtn, textDecoration: "underline" }} onClick={clearFilters}>Clear filters</span>
        </div>
      ) : (
        <div style={s.wrap}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Advertiser</th>
                <th style={s.th}>Owner</th>
                <th style={s.th}>Category</th>
                <th style={s.th}>Buy type · Rate</th>
                <th style={{ ...s.th, ...s.thRight }}>Total budget</th>
                <th style={{ ...s.th, ...s.thRight }}>Live offers</th>
                <th style={{ ...s.th, textAlign: "center" }}>Email</th>
                <th style={s.th}>Status</th>
                <th style={{ ...s.th, textAlign: "center" }}>Details</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => {
                const live = a.status === "ONBOARDED";
                const owner = ownerText(a);
                return (
                  <tr key={a.id} style={{ ...s.tr, cursor: "default" }}>
                    <td style={s.td}>
                      <div style={s.advCell}>
                        <div style={{ ...s.avatar, background: avatarColor(a.name) }}>{(a.name || "?").trim().charAt(0).toUpperCase()}</div>
                        <div>
                          <div style={s.name}>{a.name || "Untitled"}</div>
                          <div style={s.id}>{a.id}</div>
                        </div>
                      </div>
                    </td>
                    <td style={s.td}>
                      {owner ? <><div style={s.ownerName}>{owner.name}</div><div style={s.ownerEmail}>{owner.email}</div></> : dash}
                    </td>
                    <td style={s.td}>{a.category ? <span style={s.cat}>{a.category}</span> : dash}</td>
                    <td style={s.td}>
                      {a.buy_type ? <><span style={s.pill}>{a.buy_type}</span><span style={s.rate}>{rateText(a)}</span></> : dash}
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
                        <MarkSentIcon advertiser={a} userEmail={userEmail} onMarked={load} />
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
