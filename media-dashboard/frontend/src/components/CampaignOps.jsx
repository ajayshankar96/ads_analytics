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
  cloneCampaign,
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
    `CPC/CPD: ${campaign.cpc_cpd || "—"}`, "", "Regards,", "AdOps Team | Razorpay");
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
  const [emailCc, setEmailCc] = useState("");
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
    } catch (e) { alert("Transition failed: " + e.message); }
  };

  const handleSendEmail = async () => {
    if (!emailTo.trim()) { alert("Enter recipient email(s)"); return; }
    setSending(true);
    try {
      await handleSave();
      const token = await getGmailAccessToken();
      const cc = emailCc.split(",").map((x) => x.trim()).filter(Boolean);
      // If this campaign has thread info (e.g. cloned from a LIVE campaign), reply on the same thread
      const threadId = campaign.publisher_email_thread_id || undefined;
      const inReplyTo = campaign.publisher_email_message_id || undefined;
      const subjectLine = threadId && !emailSubject.startsWith("Re:") ? `Re: ${emailSubject}` : emailSubject;
      const gmailRes = await sendViaGmail(token, { to: emailTo.split(",").map((x) => x.trim()), cc: cc.length ? cc : undefined, subject: subjectLine, html: textToHtml(emailBody), threadId, inReplyTo });
      // Save thread info so future clones can also reply on this thread
      await recordPublisherEmail(campaign.campaign_id, { to: emailTo, subject: subjectLine, body: emailBody, thread_id: gmailRes.threadId || null, message_id: gmailRes.id || null });
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
        await transitionCampaign(campaign.campaign_id, { to_stage: STAGE_PATH[i] }).catch(() => {});
      }
      onReload();
    } catch (e) { alert("Failed: " + e.message); }
  };

  const handleClone = async () => {
    try {
      const res = await cloneCampaign(campaign.campaign_id);
      alert(`New draft created: ${res.campaign.campaign_id}\nAll fields pre-filled from ${campaign.campaign_id}. Find it in the Draft column.`);
      onReload();
    } catch (e) { alert("Clone failed: " + e.message); }
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
        {isLive && canEdit && (
          <button onClick={handleClone} style={{ background: c.blue, color: "#fff", border: "none", borderRadius: 8, padding: "10px 20px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
            + Edit (New Version)
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
        {/* Promo Code Section */}
        {isAssetStage && canEdit && (
          <div style={{ padding: "14px", background: "#fff", border: `1px solid ${c.line}`, borderRadius: 8 }}>
            <CodesSection assets={assets} setAssets={setAssets} />
          </div>
        )}
        {!isAssetStage && assets.promo_codes && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: "#fff", border: `1px solid ${c.line}`, borderRadius: 8 }}>
            <div style={{ width: 24, height: 24, borderRadius: "50%", background: "#E3F6EE", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ color: c.green, fontSize: 13 }}>✓</span>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: c.ink }}>Promo Codes</div>
              <div style={{ fontSize: 12, color: c.muted, marginTop: 1 }}>{(() => { try { const d = JSON.parse(assets.promo_codes); return d.type === "none" ? "No Code" : d.type === "dynamic" ? "Dynamic Codes" : d.codes || "Static Codes"; } catch { return assets.promo_codes; } })()}</div>
            </div>
          </div>
        )}
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
