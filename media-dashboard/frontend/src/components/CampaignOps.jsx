import React, { useState, useEffect, useRef } from "react";
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
  cloneCampaign,
  getAdvertisers,
  getPublishers,
  markNotLive,
  getAllAllocationsForMonth,
  getCampaignChangelog,
} from "../api";
import { useGisLoaded, getGmailAccessToken, sendViaGmail, textToHtml, getLatestMessageId, getRfcMessageId } from "../lib/gmail";

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
  { key: "publisher_billing_rate", label: "Publisher Billing", type: "publisher_billing" },
];

const PUBLISHER_BILLING_MODELS = [
  { value: "cpc", label: "CPC" },
  { value: "cpm", label: "CPM" },
];

function publisherBillingText(campaign) {
  const model = (campaign.publisher_billing_model || (campaign.cpc_cpd ? "cpc" : "")).toUpperCase();
  const rate = campaign.publisher_billing_rate || campaign.cpc_cpd;
  if (!model || !rate) return "—";
  return `${model} ₹${rate}`;
}

function buildEmailDraft(campaign) {
  const lines = ["Hi,", "", "Please find below the campaign details for your reference.", "",
    `Landing Link: ${campaign.landing_link || "—"}`, `Offer Title: ${campaign.offer_title || "—"}`, "",
    "Terms & Conditions:", campaign.details_tc || "—", "", "How to Redeem:", campaign.how_to_redeem || "—", ""];

  // Add promo code section only if not "no code"
  let codeData = {};
  try { codeData = JSON.parse(campaign.promo_codes || "{}"); } catch {}
  if (codeData.type !== "none") {
    if (codeData.type === "static") {
      lines.push(`Promo Code(s): ${codeData.codes || "—"}`);
    } else if (codeData.type === "dynamic") {
      lines.push(`Promo Code(s): Dynamic (see attached sheets)`);
    } else {
      lines.push(`Promo Code(s): ${campaign.promo_codes || "—"}`);
    }
    if (codeData.start_date || codeData.end_date) {
      lines.push(`Code Validity: ${codeData.start_date || ""} to ${codeData.end_date || ""}`);
    } else if (campaign.code_validity) {
      lines.push(`Code Validity: ${campaign.code_validity}`);
    }
    lines.push("");
  }

  lines.push(`Creative: ${campaign.creative_url || "—"}`, `Logo: ${campaign.logo_url || "—"}`, "",
    `Targeting: ${campaign.targeting || "—"}`, "", `Daily Budget: ${campaign.daily_budget || "—"}`,
    `Publisher Billing: ${publisherBillingText(campaign)}`, "", "Regards,", "AdOps Team | Razorpay");
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

// ── Asset form building blocks ───────────────────────────────────────────────
const inputBase = { border: `1px solid ${c.line}`, borderRadius: 7, padding: "9px 12px", fontSize: 13, width: "100%", outline: "none", boxSizing: "border-box", color: c.ink, background: "#fff" };

function FieldBlock({ label, hint, filled, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: c.ink, display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
        {label}
        <span title={filled ? "Filled" : "Missing"} style={{ width: 7, height: 7, borderRadius: "50%", background: filled ? c.green : "#D3DCE6", display: "inline-block", flexShrink: 0 }} />
      </label>
      {children}
      {hint && <div style={{ fontSize: 11, color: c.muted, marginTop: 3 }}>{hint}</div>}
    </div>
  );
}

function SectionCard({ num, title, done, total, children }) {
  const complete = done >= total;
  return (
    <div style={{ background: "#fff", border: `1px solid ${c.line}`, borderRadius: 10, padding: "16px 18px 6px", marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <span style={{ width: 22, height: 22, borderRadius: "50%", background: complete ? "#E3F6EE" : "#EAF0FF", color: complete ? c.green : c.blue, fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          {complete ? "✓" : num}
        </span>
        <span style={{ fontSize: 12, fontWeight: 700, color: c.ink, textTransform: "uppercase", letterSpacing: ".05em" }}>{title}</span>
        <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700, color: complete ? c.green : c.muted }}>{done}/{total}</span>
      </div>
      {children}
    </div>
  );
}

// Creative / logo: Drive upload (backend endpoint already existed, was never
// wired to the UI) + live image preview + dimension check against the spec.
function CreativeField({ campaignId, field, label, dims, value, onChange, canEdit }) {
  const [uploading, setUploading] = useState(false);
  const [imgSize, setImgSize] = useState(null); // {w,h} | "error" | null
  const fileRef = useRef(null);
  const mismatch = value && imgSize && imgSize !== "error" && (imgSize.w !== dims.w || imgSize.h !== dims.h);

  const handleFile = async (file) => {
    if (!file) return;
    if (!["image/jpeg", "image/png"].includes(file.type)) { alert("Only JPG/PNG files are allowed"); return; }
    setUploading(true);
    try {
      const res = await uploadCampaignAsset(campaignId, field, file);
      setImgSize(null);
      onChange(res.url);
    } catch (e) { alert("Upload failed: " + e.message); }
    finally { setUploading(false); }
  };

  return (
    <div style={{ flex: 1, minWidth: 240, marginBottom: 14 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: c.ink, display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
        {label}
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: value ? c.green : "#D3DCE6", display: "inline-block" }} />
      </label>
      <div style={{ display: "flex", gap: 12 }}>
        <div style={{ width: 96, height: 96, border: `1px solid ${c.line}`, borderRadius: 8, background: c.bg, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 }}>
          {value ? (
            <img src={value} alt={label}
              style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
              onLoad={(e) => setImgSize({ w: e.target.naturalWidth, h: e.target.naturalHeight })}
              onError={() => setImgSize("error")} />
          ) : (
            <span style={{ fontSize: 10, color: c.muted, textAlign: "center", lineHeight: 1.5 }}>{dims.w}×{dims.h}<br />preview</span>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          {canEdit && (
            <>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png" style={{ display: "none" }}
                onChange={(e) => { handleFile(e.target.files && e.target.files[0]); e.target.value = ""; }} />
              <button onClick={() => fileRef.current && fileRef.current.click()} disabled={uploading}
                style={{ border: `1.5px dashed ${c.blue}`, background: "#fff", color: c.blue, borderRadius: 7, padding: "8px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", width: "100%", opacity: uploading ? 0.6 : 1 }}>
                {uploading ? "Uploading…" : "⬆ Upload JPG/PNG"}
              </button>
            </>
          )}
          <input style={{ ...inputBase, fontSize: 12, marginTop: canEdit ? 6 : 0 }} disabled={!canEdit}
            value={value || ""} onChange={(e) => { setImgSize(null); onChange(e.target.value); }}
            placeholder={canEdit ? "…or paste image URL" : "—"} />
          {value && imgSize === "error" && <div style={{ fontSize: 11, color: c.red, marginTop: 3 }}>⚠ Couldn't load an image from this URL</div>}
          {mismatch && <div style={{ fontSize: 11, color: c.amber, marginTop: 3 }}>⚠ Image is {imgSize.w}×{imgSize.h} — expected {dims.w}×{dims.h}</div>}
        </div>
      </div>
    </div>
  );
}

function promoCodesSummary(raw) {
  if (!raw) return "—";
  try {
    const d = JSON.parse(raw);
    if (d.type === "none") return "No Code";
    const validity = d.start_date || d.end_date ? ` · valid ${d.start_date || "…"} → ${d.end_date || "…"}` : "";
    if (d.type === "dynamic") return `Dynamic (${(d.sheets_links || []).filter(Boolean).length} sheet${(d.sheets_links || []).filter(Boolean).length === 1 ? "" : "s"})${validity}`;
    return `${d.codes || "Static Codes"}${validity}`;
  } catch { return raw; }
}

// Read-only assets summary (post-handoff stages, or viewers): tidy label/value
// grid instead of the edit checklist.
function AssetsSummary({ assets }) {
  const model = (assets.publisher_billing_model || "cpc").toUpperCase();
  const billing = assets.publisher_billing_rate ? `${model} ₹${assets.publisher_billing_rate}` : "—";
  const link = (url) => url ? <a href={url} target="_blank" rel="noreferrer" style={{ color: c.blue, wordBreak: "break-all", textDecoration: "none" }}>{url}</a> : "—";
  const img = (url) => url ? (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <img src={url} alt="" style={{ width: 44, height: 44, objectFit: "contain", border: `1px solid ${c.line}`, borderRadius: 6, background: c.bg }} />
      {link(url)}
    </div>
  ) : "—";
  const text = (v) => v ? <span style={{ whiteSpace: "pre-wrap" }}>{v}</span> : "—";
  const rows = [
    ["Offer Title", text(assets.offer_title)],
    ["Landing Link (UTM)", link(assets.landing_link)],
    ["Details / T&C", text(assets.details_tc)],
    ["How to Redeem", text(assets.how_to_redeem)],
    ["Promo Code(s)", promoCodesSummary(assets.promo_codes)],
    ["Creative (600×600)", img(assets.creative_url)],
    ["Logo (300×300)", img(assets.logo_url)],
    ["Targeting / Persona", text(assets.targeting)],
    ["Daily Budget", fmtBudget(assets.daily_budget)],
    ["Publisher Billing", billing],
  ];
  return (
    <div style={{ background: "#fff", border: `1px solid ${c.line}`, borderRadius: 10, padding: "6px 18px", marginBottom: 12 }}>
      {rows.map(([label, value]) => (
        <div key={label} style={{ display: "flex", gap: 14, padding: "10px 0", borderBottom: `1px solid ${c.bg}`, fontSize: 13 }}>
          <div style={{ width: 170, flexShrink: 0, color: c.muted, fontWeight: 600, fontSize: 12, paddingTop: 1 }}>{label}</div>
          <div style={{ flex: 1, color: c.ink, minWidth: 0 }}>{value}</div>
        </div>
      ))}
    </div>
  );
}

// ── Kanban Card ──────────────────────────────────────────────────────────────
function CodesSection({ assets, setAssets }) {
  const codeData = (() => { try { return JSON.parse(assets.promo_codes || '{}'); } catch { return {}; } })();
  const codeType = codeData.type || "static";
  const codes = codeData.codes || "";
  const sheetsLinks = codeData.sheets_links || [""];
  const utmUrl = codeData.utm_url || "";
  const startDate = codeData.start_date || "";
  const endDate = codeData.end_date || "";

  const update = (patch) => {
    const merged = { ...codeData, ...patch };
    setAssets((prev) => ({ ...prev, promo_codes: JSON.stringify(merged), code_validity: merged.end_date || "" }));
  };

  const tabStyle = (active) => ({ padding: "6px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", borderRadius: 6, border: "none", background: active ? c.blue : "#F1F5F9", color: active ? "#fff" : c.sub });

  return (
    <div>
      <label style={{ fontSize: 12, fontWeight: 600, color: c.muted, textTransform: "uppercase", marginBottom: 6, display: "block" }}>Code Type *</label>
      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        <button style={tabStyle(codeType === "static")} onClick={() => update({ type: "static" })}>Static Codes</button>
        <button style={tabStyle(codeType === "dynamic")} onClick={() => update({ type: "dynamic" })}>Dynamic Codes</button>
        <button style={tabStyle(codeType === "none")} onClick={() => update({ type: "none" })}>No Code</button>
      </div>

      {codeType === "static" && (<>
        <div style={{ marginBottom: 10 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: c.ink, display: "block", marginBottom: 4 }}>Codes (comma-separated)</label>
          <input style={{ border: `1px solid ${c.line}`, borderRadius: 7, padding: "9px 12px", fontSize: 13, width: "100%", outline: "none" }}
            value={codes} onChange={(e) => update({ codes: e.target.value })} placeholder="CODE1, CODE2, CODE3" />
          <div style={{ fontSize: 11, color: c.muted, marginTop: 3 }}>Enter multiple codes separated by commas</div>
        </div>
        <div style={{ marginBottom: 10 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: c.ink, display: "block", marginBottom: 4 }}>UTM URL</label>
          <input style={{ border: `1px solid ${c.line}`, borderRadius: 7, padding: "9px 12px", fontSize: 13, width: "100%", outline: "none" }}
            value={utmUrl} onChange={(e) => update({ utm_url: e.target.value })} placeholder="https://example.com/?utm_source=alliance&utm_medium=..." />
          <div style={{ fontSize: 11, color: c.muted, marginTop: 3 }}>Paste the full tracking URL — UTM parameters will be extracted automatically</div>
        </div>
      </>)}

      {codeType === "dynamic" && (<>
        <div style={{ marginBottom: 10 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: c.ink, display: "block", marginBottom: 4 }}>Codes (Google Sheets Links) *</label>
          {sheetsLinks.map((link, i) => (
            <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
              <input style={{ border: `1px solid ${c.line}`, borderRadius: 7, padding: "9px 12px", fontSize: 13, flex: 1, outline: "none" }}
                value={link} onChange={(e) => { const u = [...sheetsLinks]; u[i] = e.target.value; update({ sheets_links: u }); }}
                placeholder="https://docs.google.com/spreadsheets/d/..." />
              {sheetsLinks.length > 1 && <button onClick={() => update({ sheets_links: sheetsLinks.filter((_, idx) => idx !== i) })} style={{ background: "#FEE2E2", color: c.red, border: "none", borderRadius: 6, padding: "0 8px", cursor: "pointer", fontSize: 14 }}>×</button>}
            </div>
          ))}
          <button onClick={() => update({ sheets_links: [...sheetsLinks, ""] })}
            style={{ border: `1.5px dashed ${c.blue}`, background: "none", color: c.blue, borderRadius: 7, padding: "8px", width: "100%", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
            ⊕ Add another sheet
          </button>
          <div style={{ fontSize: 11, color: c.muted, marginTop: 3 }}>One sheet per Advertiser × Publisher × Segment × Offer combination.</div>
        </div>
        <div style={{ marginBottom: 10 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: c.ink, display: "block", marginBottom: 4 }}>UTM URL</label>
          <input style={{ border: `1px solid ${c.line}`, borderRadius: 7, padding: "9px 12px", fontSize: 13, width: "100%", outline: "none" }}
            value={utmUrl} onChange={(e) => update({ utm_url: e.target.value })} placeholder="https://example.com/?utm_source=alliance&utm_medium=..." />
          <div style={{ fontSize: 11, color: c.muted, marginTop: 3 }}>Paste the full tracking URL</div>
        </div>
      </>)}

      {codeType === "none" && (
        <div style={{ background: "#FEF3E2", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#92400E", marginBottom: 10 }}>
          ⚠ <strong>No Code</strong> — This campaign does not use coupon codes for attribution.
        </div>
      )}

      {codeType !== "none" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: c.ink, display: "block", marginBottom: 4 }}>Validity Start Date</label>
            <input type="date" style={{ border: `1px solid ${c.line}`, borderRadius: 7, padding: "9px 12px", fontSize: 13, width: "100%", outline: "none" }}
              value={startDate} onChange={(e) => update({ start_date: e.target.value })} />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: c.ink, display: "block", marginBottom: 4 }}>Validity End Date</label>
            <input type="date" style={{ border: `1px solid ${c.line}`, borderRadius: 7, padding: "9px 12px", fontSize: 13, width: "100%", outline: "none" }}
              value={endDate} onChange={(e) => update({ end_date: e.target.value })} />
          </div>
        </div>
      )}
    </div>
  );
}

function CampaignCard({ campaign, onClick, onClone }) {
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
      {onClone && (
        <button onClick={(e) => { e.stopPropagation(); onClone(); }}
          title="Clone this campaign into a new Draft"
          style={{ marginTop: 10, width: "100%", background: "#fff", border: `1px dashed ${c.blue}`, color: c.blue, borderRadius: 6, padding: "5px 0", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
          ⧉ Clone campaign
        </button>
      )}
    </div>
  );
}

// ── Detail View (shown when a card is clicked) ───────────────────────────────
function CampaignDetailView({ campaign, onBack, onReload, canEdit, onClone }) {
  const [assets, setAssets] = useState({});
  const [saving, setSaving] = useState(false);
  const hasThread = !!(campaign.publisher_email_thread_id);
  const [emailTo, setEmailTo] = useState(hasThread ? (campaign.publisher_email_to || "") : "");
  const [emailCc, setEmailCc] = useState("");
  const [emailSubject, setEmailSubject] = useState(hasThread ? (campaign.publisher_email_subject || "") : "");
  const [emailBody, setEmailBody] = useState("");
  const [sending, setSending] = useState(false);
  const [showEmail, setShowEmail] = useState(false);
  const gisReady = useGisLoaded();
  const stage = campaign.current_stage;
  const emailSent = !!campaign.publisher_email_sent_at;

  useEffect(() => {
    const a = {};
    ASSET_FIELDS.forEach((f) => { a[f.key] = campaign[f.key] || ""; });
    a.publisher_billing_model = campaign.publisher_billing_model || "cpc";
    a.publisher_billing_rate = campaign.publisher_billing_rate || campaign.cpc_cpd || "";
    setAssets(a);
  }, [campaign.campaign_id, campaign.current_stage]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await updateCampaignAssets(campaign.campaign_id, assets);
      if (stage === "LIVE" && res.changes && res.changes.length > 0) {
        setLastChanges(res.changes);
        setShowUpdateEmailPrompt(true);
      }
    }
    catch (e) { alert("Save failed: " + e.message); }
    finally { setSaving(false); }
  };

  const handleSendUpdateEmail = async () => {
    try {
      const token = await getGmailAccessToken();
      const threadId = campaign.publisher_email_thread_id || undefined;
      let inReplyTo = threadId ? await getLatestMessageId(token, threadId) : null;
      if (!inReplyTo) inReplyTo = campaign.publisher_email_message_id || undefined;
      const changeLines = lastChanges.map((ch) => `• ${ch.field}: ${ch.old || "(empty)"} → ${ch.new}`).join("\n");
      const body = `Hi,\n\nPlease note the following updates to campaign ${campaign.advertiser_name} → ${campaign.publisher_name}:\n\n${changeLines}\n\nThank you,\nRMN Team`;
      const subject = threadId || inReplyTo ? `Re: ${campaign.publisher_email_subject || "Campaign Update"}` : `Campaign Update: ${campaign.advertiser_name}`;
      const to = (campaign.publisher_email_to || "").split(",").map((x) => x.trim()).filter(Boolean);
      if (!to.length) { alert("No publisher email on file"); setShowUpdateEmailPrompt(false); return; }
      await sendViaGmail(token, { to, subject, html: textToHtml(body), threadId, inReplyTo });
      alert("Update email sent!");
    } catch (e) { alert("Email failed: " + e.message); }
    setShowUpdateEmailPrompt(false);
    setLastChanges([]);
  };

  const loadChangelog = async () => {
    try {
      const res = await getCampaignChangelog(campaign.campaign_id);
      setChangelog(res.entries || []);
    } catch { setChangelog([]); }
  };

  const handleMarkAssetsReceived = async () => {
    if (assetsDone < ASSET_TOTAL && !window.confirm(`${ASSET_TOTAL - assetsDone} field(s) are still empty. Mark assets received anyway?`)) return;
    await handleSave();
    try {
      await transitionCampaign(campaign.campaign_id, { to_stage: "ASSETS_RECEIVED" });
      setShowEmail(true);
      setEmailSubject(`Campaign Details: ${campaign.advertiser_name} — ${assets.offer_title || "RMN"}`);
      setEmailBody(buildEmailDraft({ ...campaign, ...assets }));
    } catch (e) { alert("Transition failed: " + e.message); }
  };

  const handleSendEmail = async () => {
    if (!emailTo.trim()) { alert("Enter recipient email(s)"); return; }
    setSending(true);
    try {
      await handleSave();
      const token = await getGmailAccessToken();
      const cc = emailCc.split(",").map((x) => x.trim()).filter(Boolean);
      const threadId = campaign.publisher_email_thread_id || undefined;
      // Try to get the latest Message-ID from the thread (works if sender has the thread in their mailbox)
      // Falls back to the stored RFC Message-ID (works for CC'd users who can't read the thread via ID)
      let inReplyTo = threadId ? await getLatestMessageId(token, threadId) : null;
      if (!inReplyTo) inReplyTo = campaign.publisher_email_message_id || undefined;
      const subjectLine = (threadId || inReplyTo) && !emailSubject.startsWith("Re:") ? `Re: ${emailSubject}` : emailSubject;
      const gmailRes = await sendViaGmail(token, { to: emailTo.split(",").map((x) => x.trim()), cc: cc.length ? cc : undefined, subject: subjectLine, html: textToHtml(emailBody), threadId, inReplyTo });
      // Fetch the RFC Message-ID of what we just sent (for cross-user threading)
      const rfcMsgId = await getRfcMessageId(token, gmailRes.id);
      await recordPublisherEmail(campaign.campaign_id, { to: emailTo, subject: subjectLine, body: emailBody, thread_id: gmailRes.threadId || null, message_id: rfcMsgId || gmailRes.id || null });
      await transitionCampaign(campaign.campaign_id, { to_stage: "CREATIVE_REVIEW" }).catch(() => {});
      await transitionCampaign(campaign.campaign_id, { to_stage: "SHARED_TO_PUBLISHER" }).catch(() => {});
      onReload();
    } catch (e) { alert("Send failed: " + e.message); }
    finally { setSending(false); }
  };

  const handleMarkLive = async () => {
    try {
      // Step through any intermediate stages to reach LIVE
      const STAGE_PATH = ["OPS_SETUP", "ASSETS_RECEIVED", "CREATIVE_REVIEW", "SHARED_TO_PUBLISHER", "LIVE"];
      const curIdx = STAGE_PATH.indexOf(stage);
      const targetIdx = STAGE_PATH.indexOf("LIVE");
      for (let i = curIdx + 1; i <= targetIdx; i++) {
        await transitionCampaign(campaign.campaign_id, { to_stage: STAGE_PATH[i] });
      }
      onReload();
    } catch (e) { alert("Failed: " + e.message); }
  };

  const [changelog, setChangelog] = useState([]);
  const [showChangelog, setShowChangelog] = useState(false);
  const [showUpdateEmailPrompt, setShowUpdateEmailPrompt] = useState(false);
  const [lastChanges, setLastChanges] = useState([]);

  const isAssetStage = stage === "OPS_SETUP" || stage === "LIVE";
  const isEmailedStage = ["ASSETS_RECEIVED", "CREATIVE_REVIEW", "SHARED_TO_PUBLISHER"].includes(stage);
  const isLive = stage === "LIVE";

  // Asset completeness — 10 asks: 8 simple fields + promo codes + billing pair.
  const has = (k) => !!String(assets[k] ?? "").trim();
  const codeData = (() => { try { return JSON.parse(assets.promo_codes || "{}"); } catch { return {}; } })();
  const codesFilled = codeData.type === "none"
    || (codeData.type === "static" && !!(codeData.codes || "").trim())
    || (codeData.type === "dynamic" && (codeData.sheets_links || []).some((l) => l && l.trim()));
  const assetFilled = {
    offer_title: has("offer_title"), details_tc: has("details_tc"), how_to_redeem: has("how_to_redeem"),
    landing_link: has("landing_link"), promo_codes: codesFilled,
    creative_url: has("creative_url"), logo_url: has("logo_url"),
    targeting: has("targeting"), daily_budget: has("daily_budget"),
    publisher_billing: !!(assets.publisher_billing_model && has("publisher_billing_rate")),
  };
  const secDone = {
    offer: ["offer_title", "details_tc", "how_to_redeem"].filter((k) => assetFilled[k]).length,
    tracking: ["landing_link", "promo_codes"].filter((k) => assetFilled[k]).length,
    creatives: ["creative_url", "logo_url"].filter((k) => assetFilled[k]).length,
    budget: ["targeting", "daily_budget", "publisher_billing"].filter((k) => assetFilled[k]).length,
  };
  const assetsDone = Object.values(assetFilled).filter(Boolean).length;
  const ASSET_TOTAL = Object.keys(assetFilled).length;

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
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {(isEmailedStage || isLive) && canEdit && onClone && (
            <button onClick={onClone} title="Clone this campaign into a new Draft"
              style={{ background: "#fff", color: c.blue, border: `1.5px solid ${c.blue}`, borderRadius: 8, padding: "10px 20px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
              ⧉ Clone
            </button>
          )}
          {isEmailedStage && canEdit && (
            <button onClick={handleMarkLive} style={{ background: c.green, color: "#fff", border: "none", borderRadius: 8, padding: "10px 20px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
              ⊙ Mark Live
            </button>
          )}
          {isLive && canEdit && (
            <span style={{ fontSize: 12, color: c.green, fontWeight: 600 }}>Edit fields directly below ↓</span>
          )}
        </div>
      </div>

      {/* Assets: progress header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: c.muted, textTransform: "uppercase", letterSpacing: ".04em" }}>
          Assets {stage === "OPS_SETUP" ? "· fill all fields" : stage === "LIVE" ? "· edit directly" : "· received"}
        </div>
        {isAssetStage && canEdit && (
          <>
            <div style={{ flex: "0 1 200px", height: 6, background: "#EDF1F6", borderRadius: 3, overflow: "hidden" }}>
              <div style={{ width: `${Math.round((assetsDone / ASSET_TOTAL) * 100)}%`, height: "100%", background: assetsDone === ASSET_TOTAL ? c.green : c.blue, borderRadius: 3, transition: "width .25s" }} />
            </div>
            <span style={{ fontSize: 12, fontWeight: 700, color: assetsDone === ASSET_TOTAL ? c.green : c.sub }}>{assetsDone}/{ASSET_TOTAL} complete</span>
          </>
        )}
      </div>

      {!(isAssetStage && canEdit) ? (
        <AssetsSummary assets={assets} />
      ) : (
        <>
          <SectionCard num={1} title="Offer Details" done={secDone.offer} total={3}>
            <FieldBlock label="Offer Title" filled={assetFilled.offer_title} hint={campaign.offer_title ? "Set at campaign creation." : undefined}>
              <input style={{ ...inputBase, ...(campaign.offer_title ? { background: "#F3F4F6", color: "#6B7280" } : {}) }}
                value={assets.offer_title ?? ""} disabled={!!campaign.offer_title}
                onChange={(e) => setAssets({ ...assets, offer_title: e.target.value })}
                placeholder="e.g. Flat ₹150 off on orders above ₹999" />
            </FieldBlock>
            <FieldBlock label="Details / T&C" filled={assetFilled.details_tc}>
              <textarea style={{ ...inputBase, minHeight: 110, resize: "vertical", lineHeight: 1.5 }} value={assets.details_tc ?? ""}
                onChange={(e) => setAssets({ ...assets, details_tc: e.target.value })}
                placeholder="Paste the full offer terms & conditions…" />
            </FieldBlock>
            <FieldBlock label="How to Redeem" filled={assetFilled.how_to_redeem}>
              <textarea style={{ ...inputBase, minHeight: 90, resize: "vertical", lineHeight: 1.5 }} value={assets.how_to_redeem ?? ""}
                onChange={(e) => setAssets({ ...assets, how_to_redeem: e.target.value })}
                placeholder={"1. Add items to cart\n2. Apply code at checkout…"} />
            </FieldBlock>
          </SectionCard>

          <SectionCard num={2} title="Tracking & Codes" done={secDone.tracking} total={2}>
            <FieldBlock label="Landing Link (UTM)" filled={assetFilled.landing_link}
              hint="Final landing-page URL with UTM parameters — this goes into the publisher email.">
              <input style={inputBase} value={assets.landing_link ?? ""}
                onChange={(e) => setAssets({ ...assets, landing_link: e.target.value })}
                placeholder="https://brand.com/offer?utm_source=…" />
            </FieldBlock>
            <div style={{ borderTop: `1px solid ${c.bg}`, paddingTop: 12, marginBottom: 14 }}>
              <CodesSection assets={assets} setAssets={setAssets} />
            </div>
          </SectionCard>

          <SectionCard num={3} title="Creatives" done={secDone.creatives} total={2}>
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
              <CreativeField campaignId={campaign.campaign_id} field="creative_url" label="Creative (600×600)" dims={{ w: 600, h: 600 }}
                value={assets.creative_url} onChange={(v) => setAssets((prev) => ({ ...prev, creative_url: v }))} canEdit={canEdit} />
              <CreativeField campaignId={campaign.campaign_id} field="logo_url" label="Logo (300×300)" dims={{ w: 300, h: 300 }}
                value={assets.logo_url} onChange={(v) => setAssets((prev) => ({ ...prev, logo_url: v }))} canEdit={canEdit} />
            </div>
          </SectionCard>

          <SectionCard num={4} title="Targeting & Budget" done={secDone.budget} total={3}>
            <FieldBlock label="Targeting / Persona" filled={assetFilled.targeting}>
              <textarea style={{ ...inputBase, minHeight: 70, resize: "vertical", lineHeight: 1.5 }} value={assets.targeting ?? ""}
                onChange={(e) => setAssets({ ...assets, targeting: e.target.value })}
                placeholder="Audience / cohort this campaign targets…" />
            </FieldBlock>
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <FieldBlock label="Daily Budget" filled={assetFilled.daily_budget}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ position: "relative", flex: 1 }}>
                      <span style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", fontSize: 13, color: c.muted }}>₹</span>
                      <input type="number" min="0" style={{ ...inputBase, paddingLeft: 26 }} value={assets.daily_budget ?? ""}
                        onChange={(e) => setAssets({ ...assets, daily_budget: e.target.value })} placeholder="0" />
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 700, color: assetFilled.daily_budget ? c.green : c.muted, whiteSpace: "nowrap" }}>{fmtBudget(assets.daily_budget)}</span>
                  </div>
                </FieldBlock>
              </div>
              <div style={{ flex: 1, minWidth: 220 }}>
                <FieldBlock label="Publisher Billing" filled={assetFilled.publisher_billing}>
                  <div style={{ display: "flex", gap: 8 }}>
                    <select style={{ ...inputBase, width: 90, flexShrink: 0 }} value={assets.publisher_billing_model || "cpc"}
                      onChange={(e) => setAssets({ ...assets, publisher_billing_model: e.target.value })}>
                      {PUBLISHER_BILLING_MODELS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </select>
                    <div style={{ position: "relative", flex: 1 }}>
                      <span style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", fontSize: 13, color: c.muted }}>₹</span>
                      <input type="number" step="0.01" min="0" style={{ ...inputBase, paddingLeft: 26 }} value={assets.publisher_billing_rate ?? ""}
                        onChange={(e) => setAssets({ ...assets, publisher_billing_rate: e.target.value })} placeholder="Rate" />
                    </div>
                  </div>
                </FieldBlock>
              </div>
            </div>
          </SectionCard>
        </>
      )}

      {/* Sticky action bar */}
      {isAssetStage && canEdit && !showEmail && (
        <div style={{ position: "sticky", bottom: 0, background: "#fff", border: `1px solid ${c.line}`, borderRadius: 10, padding: "12px 16px", display: "flex", gap: 10, alignItems: "center", zIndex: 5, boxShadow: "0 -4px 14px rgba(15,23,36,0.08)" }}>
          <button onClick={handleSave} disabled={saving} style={{ background: c.blue, color: "#fff", border: "none", borderRadius: 8, padding: "10px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
            {saving ? "Saving…" : "Save Assets"}
          </button>
          {stage === "OPS_SETUP" && (
            <button onClick={handleMarkAssetsReceived} style={{ background: c.green, color: "#fff", border: "none", borderRadius: 8, padding: "10px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
              Mark Assets Received & Draft Email →
            </button>
          )}
          <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 600, color: assetsDone === ASSET_TOTAL ? c.green : c.muted }}>
            {assetsDone === ASSET_TOTAL ? "✓ All fields complete" : `${ASSET_TOTAL - assetsDone} field${ASSET_TOTAL - assetsDone === 1 ? "" : "s"} remaining`}
          </span>
        </div>
      )}

      {/* Email compose */}
      {(showEmail || (stage === "OPS_SETUP" && emailSent)) && !isEmailedStage && !isLive && (
        <div style={{ background: "#F0F4FF", borderRadius: 10, padding: "16px", marginTop: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: c.ink, marginBottom: 12 }}>Send to Publisher</div>
          <div style={{ marginBottom: 8 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: c.muted, display: "block", marginBottom: 3 }}>To</label>
            <input style={{ border: `1px solid ${c.line}`, borderRadius: 6, padding: "8px 10px", fontSize: 13, width: "100%", outline: "none" }}
              value={emailTo} onChange={(e) => setEmailTo(e.target.value)} placeholder="publisher@example.com" />
          </div>
          <div style={{ marginBottom: 8 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: c.muted, display: "block", marginBottom: 3 }}>CC</label>
            <input style={{ border: `1px solid ${c.line}`, borderRadius: 6, padding: "8px 10px", fontSize: 13, width: "100%", outline: "none" }}
              value={emailCc} onChange={(e) => setEmailCc(e.target.value)} placeholder="manager@brand.com, team@razorpay.com" />
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
          <button onClick={async () => {
            await handleSave();
            await recordPublisherEmail(campaign.campaign_id, { to: emailTo || "sent offline", subject: emailSubject || "Sent offline", body: emailBody || "" });
            await transitionCampaign(campaign.campaign_id, { to_stage: "CREATIVE_REVIEW" }).catch(() => {});
            await transitionCampaign(campaign.campaign_id, { to_stage: "SHARED_TO_PUBLISHER" }).catch(() => {});
            onReload();
          }} style={{ background: "#fff", color: c.sub, border: `1px solid ${c.line}`, borderRadius: 8, padding: "10px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            Mark as sent (sent offline)
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

      {/* Update email prompt (LIVE edits) */}
      {showUpdateEmailPrompt && (
        <div style={{ background: "#FFF8E1", borderRadius: 8, padding: "14px", marginTop: 16, border: "1px solid #FFE082" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: c.ink, marginBottom: 8 }}>Changes saved! Send update email to publisher?</div>
          <div style={{ fontSize: 12, color: c.sub, marginBottom: 10 }}>
            {lastChanges.map((ch, i) => <div key={i}>• {ch.field}: {ch.old || "(empty)"} → {ch.new}</div>)}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={handleSendUpdateEmail} disabled={!gisReady}
              style={{ background: c.green, color: "#fff", border: "none", borderRadius: 6, padding: "8px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
              Yes, send email
            </button>
            <button onClick={() => { setShowUpdateEmailPrompt(false); setLastChanges([]); }}
              style={{ background: "#fff", color: c.sub, border: `1px solid ${c.line}`, borderRadius: 6, padding: "8px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
              No, just save
            </button>
          </div>
        </div>
      )}

      {/* Change History */}
      {isLive && (
        <div style={{ marginTop: 24 }}>
          <button onClick={() => { setShowChangelog(!showChangelog); if (!showChangelog) loadChangelog(); }}
            style={{ background: "none", border: "none", color: c.blue, cursor: "pointer", fontSize: 13, fontWeight: 600, padding: 0 }}>
            {showChangelog ? "▾ Hide Change History" : "▸ Change History"}
          </button>
          {showChangelog && (
            <div style={{ marginTop: 10, maxHeight: 300, overflowY: "auto" }}>
              {changelog.length === 0 && <div style={{ fontSize: 12, color: c.muted }}>No changes logged yet.</div>}
              {changelog.map((entry) => (
                <div key={entry.id} style={{ padding: "8px 0", borderBottom: `1px solid ${c.line}`, fontSize: 12 }}>
                  <span style={{ color: c.muted }}>{new Date(entry.changed_at).toLocaleString("en-IN")}</span>
                  {" — "}
                  <span style={{ color: c.ink, fontWeight: 600 }}>{(entry.changed_by || "").split("@")[0]}</span>
                  {" changed "}
                  <span style={{ fontWeight: 600 }}>{entry.field}</span>
                  {entry.source && <span style={{ color: c.muted }}> · {entry.source.split("_").join(" ")}</span>}
                  {entry.old_value && <span style={{ color: c.red }}> from "{entry.old_value.substring(0, 40)}"</span>}
                  <span style={{ color: c.green }}> to "{(entry.new_value || "").substring(0, 40)}"</span>
                </div>
              ))}
            </div>
          )}
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
    if (!advId || !pubId) return;
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

// ── Clone Campaign Modal ─────────────────────────────────────────────────────
// Emailed/Live campaigns can be cloned into a new Draft. The user picks which
// fields to change (offer title, segment/targeting, …); everything else is
// copied as-is from the source campaign.
const CLONE_FIELDS = [
  { key: "offer_title", label: "Offer Title", type: "input", placeholder: "e.g. Flat ₹200 off on orders above ₹999" },
  { key: "targeting", label: "Segment / Targeting", type: "textarea", placeholder: "Audience / cohort this campaign targets…" },
  { key: "landing_link", label: "Landing Link (UTM)", type: "input", placeholder: "https://brand.com/offer?utm_source=…" },
  { key: "details_tc", label: "Details / T&C", type: "textarea" },
  { key: "how_to_redeem", label: "How to Redeem", type: "textarea" },
  { key: "promo_codes", label: "Promo Code(s)", type: "codes" },
  { key: "creative_url", label: "Creative URL (600×600)", type: "input", placeholder: "https://…" },
  { key: "logo_url", label: "Logo URL (300×300)", type: "input", placeholder: "https://…" },
  { key: "daily_budget", label: "Daily Budget (₹)", type: "number" },
  { key: "publisher_billing", label: "Publisher Billing", type: "billing" },
];

function CloneModal({ campaign, onClose, onCloned }) {
  const [checked, setChecked] = useState({});
  const [cloning, setCloning] = useState(false);
  const [draft, setDraft] = useState(() => ({
    offer_title: campaign.offer_title || "",
    targeting: campaign.targeting || "",
    landing_link: campaign.landing_link || "",
    details_tc: campaign.details_tc || "",
    how_to_redeem: campaign.how_to_redeem || "",
    promo_codes: campaign.promo_codes || "",
    code_validity: campaign.code_validity || "",
    creative_url: campaign.creative_url || "",
    logo_url: campaign.logo_url || "",
    daily_budget: campaign.daily_budget || "",
    publisher_billing_model: campaign.publisher_billing_model || "cpc",
    publisher_billing_rate: campaign.publisher_billing_rate || campaign.cpc_cpd || "",
  }));

  const toggle = (key) => setChecked((prev) => ({ ...prev, [key]: !prev[key] }));
  const nChanges = CLONE_FIELDS.filter((f) => checked[f.key]).length;

  const handleClone = async () => {
    setCloning(true);
    try {
      const overrides = {};
      CLONE_FIELDS.forEach(({ key }) => {
        if (!checked[key]) return;
        if (key === "publisher_billing") {
          overrides.publisher_billing_model = draft.publisher_billing_model;
          overrides.publisher_billing_rate = draft.publisher_billing_rate;
        } else if (key === "promo_codes") {
          overrides.promo_codes = draft.promo_codes;
          overrides.code_validity = draft.code_validity || "";
        } else {
          overrides[key] = draft[key];
        }
      });
      const res = await cloneCampaign(campaign.campaign_id, overrides);
      onCloned(res.campaign);
    } catch (e) {
      alert("Clone failed: " + e.message);
      setCloning(false);
    }
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,23,36,0.45)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 12, width: 560, maxWidth: "100%", maxHeight: "85vh", display: "flex", flexDirection: "column", boxShadow: "0 12px 40px rgba(15,23,36,0.25)" }}>
        {/* Header */}
        <div style={{ padding: "16px 20px", borderBottom: `1px solid ${c.line}`, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: c.ink }}>⧉ Clone Campaign</div>
            <div style={{ fontSize: 12, color: c.muted, marginTop: 2 }}>
              {campaign.advertiser_name} → {campaign.publisher_name} · {campaign.campaign_id}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: c.muted, cursor: "pointer", fontSize: 16, padding: 0 }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ padding: "14px 20px", overflowY: "auto", flex: 1 }}>
          <div style={{ background: "#F0F4FF", borderRadius: 8, padding: "10px 12px", fontSize: 12, color: c.sub, marginBottom: 14 }}>
            The clone is created in <b>Draft</b> with every field copied from this campaign.
            Tick anything you want to change — offer title, segment, or any other field — and enter the new value.
          </div>
          {CLONE_FIELDS.map((f) => (
            <div key={f.key} style={{ border: `1px solid ${checked[f.key] ? c.blue : c.line}`, borderRadius: 8, padding: "10px 12px", marginBottom: 8, background: checked[f.key] ? "#F7FAFF" : "#fff" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, fontWeight: 600, color: c.ink }}>
                <input type="checkbox" checked={!!checked[f.key]} onChange={() => toggle(f.key)} style={{ cursor: "pointer" }} />
                {f.label}
                {!checked[f.key] && (
                  <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 400, color: c.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 220 }}>
                    {f.key === "promo_codes" ? promoCodesSummary(campaign.promo_codes)
                      : f.key === "publisher_billing" ? publisherBillingText(campaign)
                      : f.key === "daily_budget" ? fmtBudget(campaign.daily_budget)
                      : (campaign[f.key] || "—")}
                  </span>
                )}
              </label>
              {checked[f.key] && (
                <div style={{ marginTop: 8 }}>
                  {f.type === "input" && (
                    <input style={inputBase} value={draft[f.key]} placeholder={f.placeholder}
                      onChange={(e) => setDraft((prev) => ({ ...prev, [f.key]: e.target.value }))} />
                  )}
                  {f.type === "textarea" && (
                    <textarea style={{ ...inputBase, minHeight: 80, resize: "vertical", lineHeight: 1.5 }} value={draft[f.key]} placeholder={f.placeholder}
                      onChange={(e) => setDraft((prev) => ({ ...prev, [f.key]: e.target.value }))} />
                  )}
                  {f.type === "number" && (
                    <div style={{ position: "relative" }}>
                      <span style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", fontSize: 13, color: c.muted }}>₹</span>
                      <input type="number" min="0" style={{ ...inputBase, paddingLeft: 26 }} value={draft[f.key]}
                        onChange={(e) => setDraft((prev) => ({ ...prev, [f.key]: e.target.value }))} placeholder="0" />
                    </div>
                  )}
                  {f.type === "codes" && <CodesSection assets={draft} setAssets={setDraft} />}
                  {f.type === "billing" && (
                    <div style={{ display: "flex", gap: 8 }}>
                      <select style={{ ...inputBase, width: 90, flexShrink: 0 }} value={draft.publisher_billing_model}
                        onChange={(e) => setDraft((prev) => ({ ...prev, publisher_billing_model: e.target.value }))}>
                        {PUBLISHER_BILLING_MODELS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                      </select>
                      <div style={{ position: "relative", flex: 1 }}>
                        <span style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", fontSize: 13, color: c.muted }}>₹</span>
                        <input type="number" step="0.01" min="0" style={{ ...inputBase, paddingLeft: 26 }} value={draft.publisher_billing_rate}
                          onChange={(e) => setDraft((prev) => ({ ...prev, publisher_billing_rate: e.target.value }))} placeholder="Rate" />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{ padding: "12px 20px", borderTop: `1px solid ${c.line}`, display: "flex", gap: 10, alignItems: "center" }}>
          <button onClick={handleClone} disabled={cloning}
            style={{ background: c.blue, color: "#fff", border: "none", borderRadius: 8, padding: "10px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer", opacity: cloning ? 0.6 : 1 }}>
            {cloning ? "Cloning…" : nChanges > 0 ? `Create Clone in Draft (${nChanges} change${nChanges === 1 ? "" : "s"})` : "Create Exact Clone in Draft"}
          </button>
          <button onClick={onClose} style={{ background: "#fff", color: c.sub, border: `1px solid ${c.line}`, borderRadius: 8, padding: "10px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
        </div>
      </div>
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
  const [cloneTarget, setCloneTarget] = useState(null);

  const load = () => {
    setLoading(true);
    return Promise.all([getWorkflowCampaigns(), getPublishers()]).then(([cRes, pRes]) => {
      setCampaigns(cRes.campaigns || []);
      setPublishers(pRes.publishers || []);
    }).catch(console.error).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  // After a clone: refresh the board and open the new draft for editing.
  const handleCloned = async (newCamp) => {
    setCloneTarget(null);
    await load();
    if (newCamp && newCamp.campaign_id) setSelected(newCamp.campaign_id);
  };

  const cloneModal = cloneTarget && (
    <CloneModal campaign={cloneTarget} onClose={() => setCloneTarget(null)} onCloned={handleCloned} />
  );

  if (loading) return <div style={{ textAlign: "center", padding: 40, color: "#888" }}>Loading…</div>;

  // If a campaign is selected, show detail view
  if (selected) {
    const cam = campaigns.find((c) => c.campaign_id === selected);
    if (cam) return (
      <>
        <CampaignDetailView campaign={cam} onBack={() => setSelected(null)} onReload={() => { load(); setSelected(null); }} canEdit={canEdit}
          onClone={canEdit ? () => setCloneTarget(cam) : null} />
        {cloneModal}
      </>
    );
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
          {emailed.map((cam) => <CampaignCard key={cam.campaign_id} campaign={cam} onClick={() => setSelected(cam.campaign_id)} onClone={canEdit ? () => setCloneTarget(cam) : null} />)}
        </div>

        <div style={colStyle}>
          <div style={colTitle}>
            <span style={{ fontSize: 14, fontWeight: 700, color: c.ink }}>Live</span>
            <span style={{ fontSize: 12, color: c.muted, background: "#fff", borderRadius: 10, padding: "1px 7px" }}>{live.length}</span>
          </div>
          <div style={{ fontSize: 11, color: c.muted, marginBottom: 12 }}>Activated in Campaign Mgmt</div>
          {live.map((cam) => <CampaignCard key={cam.campaign_id} campaign={cam} onClick={() => setSelected(cam.campaign_id)} onClone={canEdit ? () => setCloneTarget(cam) : null} />)}
        </div>
      </div>
      {cloneModal}
    </div>
  );
}
