import React, { useState, useEffect } from "react";
import {
  getWorkflowCampaigns,
  getWorkflowStages,
  getOpsTasks,
  updateOpsTask,
  transitionCampaign,
  updateCampaignAssets,
  recordPublisherEmail,
  uploadCampaignAsset,
  createCampaign,
  getAdvertisers,
  getPublishers,
  markNotLive,
  getAllAllocationsForMonth,
} from "../api";
import { useGisLoaded, getGmailAccessToken, sendViaGmail, textToHtml } from "../lib/gmail";

const c = { blue: "#2E5BFF", ink: "#0F1724", sub: "#52606D", line: "#E6EAF0", muted: "#768EA7", green: "#0F8C6A", red: "#C8321E", amber: "#B7791F", bg: "#F7F8FA" };

const ASSET_FIELDS = [
  { key: "landing_link", label: "Landing Link (UTM)", type: "input" },
  { key: "offer_title", label: "Offer Title", type: "input" },
  { key: "details_tc", label: "Details / T&C", type: "textarea" },
  { key: "how_to_redeem", label: "How to Redeem", type: "textarea" },
  { key: "promo_codes", label: "Promo Code(s)", type: "codes" },
  { key: "code_validity", label: "Code Validity", type: "hidden" },
  { key: "creative_url", label: "Creative URL (600×600)", type: "input" },
  { key: "logo_url", label: "Logo URL (300×300)", type: "input" },
  { key: "targeting", label: "Targeting / Persona", type: "textarea" },
  { key: "daily_budget", label: "Daily Budget (₹)", type: "input" },
  { key: "cpc_cpd", label: "CPC / CPD", type: "input" },
];

function buildEmailDraft(campaign) {
  const lines = ["Hi,", "", "Please find below the campaign details for your reference.", "",
    `Landing Link: ${campaign.landing_link || "—"}`, `Offer Title: ${campaign.offer_title || "—"}`, "",
    "Terms & Conditions:", campaign.details_tc || "—", "", "How to Redeem:", campaign.how_to_redeem || "—", "",
    `Promo Code(s): ${campaign.promo_codes || "—"}`, `Code Validity: ${campaign.code_validity || "—"}`, "",
    `Creative: ${campaign.creative_url || "—"}`, `Logo: ${campaign.logo_url || "—"}`, "",
    `Targeting: ${campaign.targeting || "—"}`, "", `Daily Budget: ${campaign.daily_budget || "—"}`,
    `CPC/CPD: ${campaign.cpc_cpd || "—"}`, "", "Regards,", "AdOps Team | Razorpay"];
  return lines.join("\n");
}

function fmtBudget(n) {
  if (!n) return "—";
  const v = parseFloat(String(n).replace(/[^\d.]/g, ""));
  if (isNaN(v) || v === 0) return "—";
  if (v >= 10000000) return `₹${(v / 10000000).toFixed(2)} Cr`;
  if (v >= 100000) return `₹${(v / 100000).toFixed(2)} L`;
  return `₹${v.toLocaleString("en-IN")}`;
}

// ── Kanban Card ──────────────────────────────────────────────────────────────
function CampaignCard({ campaign, onClick }) {
  const avatarColor = ["#B5546F", "#2E5BFF", "#0F8C6A", "#B7791F", "#7C3AED", "#0891B2"][
    (campaign.advertiser_name || "").charCodeAt(0) % 6
  ];
  const stage = campaign.current_stage;
  const badgeColor = stage === "LIVE" ? c.green : stage === "SHARED_TO_PUBLISHER" ? c.blue : c.muted;
  const badgeLabel = stage === "LIVE" ? "Live" : stage === "SHARED_TO_PUBLISHER" ? "Publisher Emailed" : "Draft";

  return (
    <div onClick={onClick} style={{ background: c.bg, border: `1.5px solid ${c.line}`, borderRadius: 10, padding: "12px 14px", cursor: "pointer", marginBottom: 10, boxShadow: "0 1px 4px rgba(15,23,36,0.06)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 11, color: c.muted }}>{campaign.campaign_id}</span>
        <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10, background: `${badgeColor}15`, color: badgeColor }}>{badgeLabel}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, background: avatarColor, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 14, fontWeight: 800 }}>
          {(campaign.advertiser_name || "?").charAt(0).toUpperCase()}
        </div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: c.ink }}>{campaign.advertiser_name}</div>
          <div style={{ fontSize: 12, color: c.muted }}>→ {campaign.publisher_name}</div>
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
        <span style={{ color: c.muted }}>Budget</span>
        <span style={{ fontWeight: 600, color: c.ink }}>{fmtBudget(campaign.daily_budget)}</span>
      </div>
      {campaign.targeting && (
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginTop: 2 }}>
          <span style={{ color: c.muted }}>Audience</span>
          <span style={{ fontWeight: 600, color: c.ink }}>{campaign.targeting.substring(0, 20)}{campaign.targeting.length > 20 ? "…" : ""}</span>
        </div>
      )}
    </div>
  );
}

// ── Detail View (shown when a card is clicked) ───────────────────────────────
function CampaignDetailView({ campaign, onBack, onReload, canEdit }) {
  const [assets, setAssets] = useState({});
  const [saving, setSaving] = useState(false);
  const [emailTo, setEmailTo] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [sending, setSending] = useState(false);
  const [showEmail, setShowEmail] = useState(false);
  const gisReady = useGisLoaded();
  const stage = campaign.current_stage;
  const emailSent = !!campaign.publisher_email_sent_at;

  useEffect(() => {
    const a = {};
    ASSET_FIELDS.forEach((f) => { a[f.key] = campaign[f.key] || ""; });
    setAssets(a);
  }, [campaign.campaign_id, campaign.current_stage]);

  const handleSave = async () => {
    setSaving(true);
    try { await updateCampaignAssets(campaign.campaign_id, assets); }
    catch (e) { alert("Save failed: " + e.message); }
    finally { setSaving(false); }
  };

  const handleMarkAssetsReceived = async () => {
    await handleSave();
    try {
      await transitionCampaign(campaign.campaign_id, { to_stage: "ASSETS_RECEIVED" });
      setShowEmail(true);
      setEmailSubject(`Campaign Details: ${campaign.advertiser_name} — ${assets.offer_title || "RMN"}`);
      setEmailBody(buildEmailDraft({ ...campaign, ...assets }));
      onReload();
    } catch (e) { alert("Transition failed: " + e.message); }
  };

  const handleSendEmail = async () => {
    if (!emailTo.trim()) { alert("Enter recipient email(s)"); return; }
    setSending(true);
    try {
      await handleSave();
      const token = await getGmailAccessToken();
      await sendViaGmail(token, { to: emailTo.split(",").map((x) => x.trim()), subject: emailSubject, html: textToHtml(emailBody) });
      await recordPublisherEmail(campaign.campaign_id, { to: emailTo, subject: emailSubject, body: emailBody });
      await transitionCampaign(campaign.campaign_id, { to_stage: "CREATIVE_REVIEW" }).catch(() => {});
      await transitionCampaign(campaign.campaign_id, { to_stage: "SHARED_TO_PUBLISHER" }).catch(() => {});
      onReload();
    } catch (e) { alert("Send failed: " + e.message); }
    finally { setSending(false); }
  };

  const handleMarkLive = async () => {
    try {
      await transitionCampaign(campaign.campaign_id, { to_stage: "CREATIVE_REVIEW" }).catch(() => {});
      await transitionCampaign(campaign.campaign_id, { to_stage: "LIVE" }).catch(() => {});
      onReload();
    } catch (e) { alert("Failed: " + e.message); }
  };

  const isAssetStage = stage === "OPS_SETUP";
  const isEmailedStage = ["ASSETS_RECEIVED", "CREATIVE_REVIEW", "SHARED_TO_PUBLISHER"].includes(stage);
  const isLive = stage === "LIVE";

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <button onClick={onBack} style={{ background: "none", border: "none", color: c.blue, cursor: "pointer", fontSize: 13, fontWeight: 600, padding: 0, marginBottom: 6 }}>← Back to queue</button>
          <div style={{ fontSize: 18, fontWeight: 800, color: c.ink }}>
            {campaign.advertiser_name} → {campaign.publisher_name}
            <span style={{ marginLeft: 10, fontSize: 12, fontWeight: 600, padding: "3px 10px", borderRadius: 10, background: isLive ? "#E3F6EE" : "#EAF0FF", color: isLive ? c.green : c.blue }}>
              {isLive ? "Live" : isEmailedStage ? "Publisher Emailed" : "Draft"}
            </span>
          </div>
          <div style={{ fontSize: 12, color: c.muted, marginTop: 2 }}>{campaign.campaign_id} · {campaign.offer_title || ""}</div>
        </div>
        {isEmailedStage && canEdit && (
          <button onClick={handleMarkLive} style={{ background: c.green, color: "#fff", border: "none", borderRadius: 8, padding: "10px 20px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
            ⊙ Mark Live
          </button>
        )}
      </div>

      {/* Assets list */}
      <div style={{ fontSize: 12, fontWeight: 700, color: c.muted, textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 10 }}>
        Assets {isAssetStage ? "· Fill all fields" : "· Received"}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
        {ASSET_FIELDS.filter((f) => f.type !== "hidden" && f.type !== "codes").map((f) => {
          const val = assets[f.key] || "";
          const filled = !!val.trim();
          return (
            <div key={f.key} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: "#fff", border: `1px solid ${c.line}`, borderRadius: 8 }}>
              <div style={{ width: 24, height: 24, borderRadius: "50%", background: filled ? "#E3F6EE" : "#F1F5F9", display: "flex", alignItems: "center", justifyContent: "center" }}>
                {filled ? <span style={{ color: c.green, fontSize: 13 }}>✓</span> : <span style={{ color: c.muted, fontSize: 13 }}>○</span>}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: c.ink }}>{f.label}</div>
                {filled && <div style={{ fontSize: 12, color: c.muted, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 400 }}>{val}</div>}
              </div>
              {isAssetStage && canEdit && (
                f.type === "textarea" ? (
                  <textarea style={{ border: `1px solid ${c.line}`, borderRadius: 6, padding: "6px 8px", fontSize: 12, width: 300, minHeight: 40, resize: "vertical", outline: "none" }}
                    value={val} onChange={(e) => setAssets({ ...assets, [f.key]: e.target.value })} placeholder="—" />
                ) : (
                  <input style={{ border: `1px solid ${c.line}`, borderRadius: 6, padding: "6px 8px", fontSize: 12, width: 250, outline: "none",
                    ...(f.key === "offer_title" && campaign.offer_title ? { background: "#F3F4F6", color: "#6B7280" } : {}) }}
                    value={val} onChange={(e) => setAssets({ ...assets, [f.key]: e.target.value })}
                    disabled={f.key === "offer_title" && !!campaign.offer_title} placeholder="—" />
                )
              )}
            </div>
          );
        })}
      </div>

      {/* Action buttons */}
      {isAssetStage && canEdit && !showEmail && (
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={handleSave} disabled={saving} style={{ background: c.blue, color: "#fff", border: "none", borderRadius: 8, padding: "10px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
            {saving ? "Saving…" : "Save Assets"}
          </button>
          <button onClick={handleMarkAssetsReceived} style={{ background: c.green, color: "#fff", border: "none", borderRadius: 8, padding: "10px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
            Mark Assets Received & Draft Email →
          </button>
        </div>
      )}

      {/* Email compose */}
      {(showEmail || (isAssetStage && emailSent)) && !isEmailedStage && (
        <div style={{ background: "#F0F4FF", borderRadius: 10, padding: "16px", marginTop: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: c.ink, marginBottom: 12 }}>Send to Publisher</div>
          <div style={{ marginBottom: 8 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: c.muted, display: "block", marginBottom: 3 }}>To</label>
            <input style={{ border: `1px solid ${c.line}`, borderRadius: 6, padding: "8px 10px", fontSize: 13, width: "100%", outline: "none" }}
              value={emailTo} onChange={(e) => setEmailTo(e.target.value)} placeholder="publisher@example.com" />
          </div>
          <div style={{ marginBottom: 8 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: c.muted, display: "block", marginBottom: 3 }}>Subject</label>
            <input style={{ border: `1px solid ${c.line}`, borderRadius: 6, padding: "8px 10px", fontSize: 13, width: "100%", outline: "none" }}
              value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} />
          </div>
          <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: c.muted, display: "block", marginBottom: 3 }}>Body</label>
            <textarea style={{ border: `1px solid ${c.line}`, borderRadius: 6, padding: "8px 10px", fontSize: 12, width: "100%", minHeight: 150, outline: "none", resize: "vertical" }}
              value={emailBody} onChange={(e) => setEmailBody(e.target.value)} />
          </div>
          <button onClick={handleSendEmail} disabled={sending || !gisReady}
            style={{ background: c.green, color: "#fff", border: "none", borderRadius: 8, padding: "10px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
            {sending ? "Sending…" : "Send Email & Move to Publisher Emailed ✉️"}
          </button>
        </div>
      )}

      {/* Email sent info */}
      {emailSent && (
        <div style={{ background: "#E3F6EE", borderRadius: 8, padding: "12px 14px", marginTop: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: c.green }}>✉️ Email sent to publisher</div>
          <div style={{ fontSize: 12, color: c.sub, marginTop: 3 }}>To: {campaign.publisher_email_to} · {new Date(campaign.publisher_email_sent_at).toLocaleString("en-IN")}</div>
        </div>
      )}
    </div>
  );
}

// ── Create Campaign Panel ────────────────────────────────────────────────────
function CreateCampaignPanel({ canEdit, onCreated }) {
  const [showPanel, setShowPanel] = useState(false);
  const [advertisers, setAdvertisers] = useState([]);
  const [allPublishers, setAllPublishers] = useState([]);
  const [allocations, setAllocations] = useState([]);
  const [advId, setAdvId] = useState("");
  const [pubId, setPubId] = useState("");
  const [offerTitle, setOfferTitle] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (showPanel) {
      Promise.all([getAdvertisers(), getPublishers()]).then(([a, p]) => {
        setAdvertisers((a.advertisers || []).filter((x) => x.status === "ONBOARDED"));
        setAllPublishers(p.publishers || []);
      });
      fetch("/api/allocations?month=" + new Date().toISOString().slice(0, 7), { credentials: "same-origin" })
        .then((r) => r.json()).then((d) => setAllocations(d.allocations || [])).catch(() => {});
    }
  }, [showPanel]);

  const availablePublishers = advId
    ? allPublishers.filter((p) => allocations.some((a) => a.advertiser_id === advId && a.publisher_id === p.id && a.amount > 0))
    : [];

  const handleCreate = async () => {
    if (!advId || !pubId || !offerTitle.trim()) return;
    setCreating(true);
    try {
      await createCampaign({ advertiser_id: advId, publisher_id: pubId, offer_title: offerTitle.trim() });
      setShowPanel(false); setAdvId(""); setPubId(""); setOfferTitle("");
      onCreated();
    } catch (e) { alert("Failed: " + e.message); }
    finally { setCreating(false); }
  };

  if (!canEdit) return null;
  return (
    <div style={{ marginBottom: 16 }}>
      {!showPanel ? (
        <button onClick={() => setShowPanel(true)} style={{ background: c.blue, color: "#fff", border: "none", borderRadius: 8, padding: "9px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>+ Create Campaign</button>
      ) : (
        <div style={{ background: "#F0F4FF", border: `1px solid ${c.line}`, borderRadius: 10, padding: "14px 18px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: c.ink }}>New Campaign</span>
            <button onClick={() => setShowPanel(false)} style={{ background: "none", border: "none", color: c.muted, cursor: "pointer" }}>✕</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
            <select style={{ border: `1px solid ${c.line}`, borderRadius: 6, padding: "8px", fontSize: 12 }} value={advId} onChange={(e) => { setAdvId(e.target.value); setPubId(""); }}>
              <option value="">Advertiser…</option>
              {advertisers.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <select style={{ border: `1px solid ${c.line}`, borderRadius: 6, padding: "8px", fontSize: 12 }} value={pubId} onChange={(e) => setPubId(e.target.value)} disabled={!advId}>
              <option value="">{advId ? "Publisher…" : "Select adv first"}</option>
              {availablePublishers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <input style={{ border: `1px solid ${c.line}`, borderRadius: 6, padding: "8px", fontSize: 12 }} value={offerTitle} onChange={(e) => setOfferTitle(e.target.value)} placeholder="Offer title" />
          </div>
          <button onClick={handleCreate} disabled={creating || !advId || !pubId || !offerTitle.trim()}
            style={{ background: c.green, color: "#fff", border: "none", borderRadius: 6, padding: "8px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", opacity: (!advId || !pubId || !offerTitle.trim()) ? 0.5 : 1 }}>
            {creating ? "…" : "Create"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main: Kanban Board ───────────────────────────────────────────────────────
export default function CampaignOps({ userRole = "VIEWER" }) {
  const canEdit = userRole === "ADMIN" || userRole === "OPS";
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [pubFilter, setPubFilter] = useState("all");
  const [publishers, setPublishers] = useState([]);

  const load = () => {
    setLoading(true);
    Promise.all([getWorkflowCampaigns(), getPublishers()]).then(([cRes, pRes]) => {
      setCampaigns(cRes.campaigns || []);
      setPublishers(pRes.publishers || []);
    }).catch(console.error).finally(() => setLoading(false));
  };
  useEffect(load, []);

  if (loading) return <div style={{ textAlign: "center", padding: 40, color: "#888" }}>Loading…</div>;

  // If a campaign is selected, show detail view
  if (selected) {
    const cam = campaigns.find((c) => c.campaign_id === selected);
    if (cam) return <CampaignDetailView campaign={cam} onBack={() => setSelected(null)} onReload={() => { load(); setSelected(null); }} canEdit={canEdit} />;
  }

  // Filter by publisher
  const filtered = pubFilter === "all" ? campaigns : campaigns.filter((c) => c.publisher_name === pubFilter);

  // Group into columns
  const draft = filtered.filter((c) => c.current_stage === "OPS_SETUP");
  const emailed = filtered.filter((c) => ["ASSETS_RECEIVED", "CREATIVE_REVIEW", "SHARED_TO_PUBLISHER"].includes(c.current_stage));
  const live = filtered.filter((c) => c.current_stage === "LIVE");

  const colStyle = { flex: 1, minWidth: 280, background: "#fff", border: `1.5px solid ${c.line}`, borderRadius: 12, padding: "14px" };
  const colTitle = { display: "flex", alignItems: "center", gap: 8, marginBottom: 4 };

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: c.ink }}>Campaign Queue</div>
          <div style={{ fontSize: 12, color: c.muted }}>Click a card to view details and advance stages</div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={() => setPubFilter("all")} style={{ padding: "5px 12px", borderRadius: 6, fontSize: 12, fontWeight: 600, border: `1px solid ${pubFilter === "all" ? c.blue : c.line}`, background: pubFilter === "all" ? "#EAF0FF" : "#fff", color: pubFilter === "all" ? c.blue : c.sub, cursor: "pointer" }}>All publishers</button>
          {publishers.map((p) => (
            <button key={p.id} onClick={() => setPubFilter(p.name)} style={{ padding: "5px 12px", borderRadius: 6, fontSize: 12, fontWeight: 600, border: `1px solid ${pubFilter === p.name ? c.blue : c.line}`, background: pubFilter === p.name ? "#EAF0FF" : "#fff", color: pubFilter === p.name ? c.blue : c.sub, cursor: "pointer" }}>{p.name}</button>
          ))}
        </div>
      </div>

      <CreateCampaignPanel canEdit={canEdit} onCreated={load} />

      {/* Kanban columns */}
      <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
        <div style={colStyle}>
          <div style={colTitle}>
            <span style={{ fontSize: 14, fontWeight: 700, color: c.ink }}>Draft</span>
            <span style={{ fontSize: 12, color: c.muted, background: "#fff", borderRadius: 10, padding: "1px 7px" }}>{draft.length}</span>
          </div>
          <div style={{ fontSize: 11, color: c.muted, marginBottom: 12 }}>Ops fills assets here</div>
          {draft.map((cam) => <CampaignCard key={cam.campaign_id} campaign={cam} onClick={() => setSelected(cam.campaign_id)} />)}
        </div>

        <div style={colStyle}>
          <div style={colTitle}>
            <span style={{ fontSize: 14, fontWeight: 700, color: c.ink }}>Publisher Emailed</span>
            <span style={{ fontSize: 12, color: c.muted, background: "#fff", borderRadius: 10, padding: "1px 7px" }}>{emailed.length}</span>
          </div>
          <div style={{ fontSize: 11, color: c.muted, marginBottom: 12 }}>Awaiting confirmation</div>
          {emailed.map((cam) => <CampaignCard key={cam.campaign_id} campaign={cam} onClick={() => setSelected(cam.campaign_id)} />)}
        </div>

        <div style={colStyle}>
          <div style={colTitle}>
            <span style={{ fontSize: 14, fontWeight: 700, color: c.ink }}>Live</span>
            <span style={{ fontSize: 12, color: c.muted, background: "#fff", borderRadius: 10, padding: "1px 7px" }}>{live.length}</span>
          </div>
          <div style={{ fontSize: 11, color: c.muted, marginBottom: 12 }}>Activated in Campaign Mgmt</div>
          {live.map((cam) => <CampaignCard key={cam.campaign_id} campaign={cam} onClick={() => setSelected(cam.campaign_id)} />)}
        </div>
      </div>
    </div>
  );
}
