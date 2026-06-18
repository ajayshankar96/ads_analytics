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
} from "../api";
import { useGisLoaded, getGmailAccessToken, sendViaGmail, textToHtml } from "../lib/gmail";

const c = { blue: "#2E5BFF", ink: "#0F1724", sub: "#52606D", line: "#E6EAF0", muted: "#768EA7", green: "#0F8C6A", red: "#C8321E", amber: "#B7791F", bg: "#F7F8FA" };

const s = {
  loading: { textAlign: "center", padding: 40, color: "#888" },
  empty: { textAlign: "center", padding: 30, color: "#94a3b8", fontSize: 14 },
  list: { display: "flex", flexDirection: "column", gap: 10 },
  card: { background: "#fff", border: `1px solid ${c.line}`, borderRadius: 12, padding: "16px 20px", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" },
  cardActive: { borderColor: c.blue, boxShadow: "0 2px 12px rgba(46,91,255,0.12)" },
  head: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  title: { fontSize: 15, fontWeight: 700, color: c.ink },
  advRef: { fontSize: 12, color: c.muted, marginTop: 2 },
  badge: { fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 14, display: "inline-block" },
  badgeActive: { background: "#EAF0FF", color: c.blue },
  badgeDone: { background: "#E3F6EE", color: c.green },
  stepper: { display: "flex", alignItems: "center", margin: "14px 0 10px", flexWrap: "wrap", gap: 4 },
  step: { fontSize: 11, fontWeight: 600, padding: "3px 9px", borderRadius: 12 },
  stepDone: { background: "#E3F6EE", color: c.green },
  stepCurrent: { background: c.blue, color: "#fff" },
  stepFuture: { background: "#F1F5F9", color: "#94a3b8" },
  connector: { width: 18, height: 2, background: c.line },
  // Detail panel
  panel: { marginTop: 16, borderTop: `1px solid ${c.line}`, paddingTop: 16 },
  section: { marginBottom: 20 },
  secTitle: { fontSize: 14, fontWeight: 800, color: c.ink, marginBottom: 12 },
  grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 },
  field: { display: "flex", flexDirection: "column", marginBottom: 12 },
  label: { fontSize: 12, fontWeight: 600, color: c.muted, marginBottom: 4, textTransform: "uppercase", letterSpacing: ".03em" },
  input: { border: `1px solid ${c.line}`, borderRadius: 7, padding: "9px 12px", fontSize: 13, color: c.ink, outline: "none", fontFamily: "inherit", width: "100%" },
  textarea: { border: `1px solid ${c.line}`, borderRadius: 7, padding: "9px 12px", fontSize: 13, color: c.ink, outline: "none", fontFamily: "inherit", width: "100%", minHeight: 80, resize: "vertical" },
  assetStatus: { display: "flex", alignItems: "center", gap: 8, marginBottom: 14 },
  assetCount: { fontSize: 13, fontWeight: 700, color: c.ink },
  assetBar: { flex: 1, height: 6, borderRadius: 3, background: "#EEF2F9", overflow: "hidden" },
  assetFill: (pct) => ({ height: "100%", borderRadius: 3, width: `${pct}%`, background: pct >= 100 ? c.green : c.amber, transition: "width .2s" }),
  btnRow: { display: "flex", gap: 10, marginTop: 14 },
  btnPrimary: { background: c.blue, color: "#fff", border: "none", borderRadius: 8, padding: "10px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer" },
  btnGhost: { background: "#fff", color: c.sub, border: `1px solid ${c.line}`, borderRadius: 8, padding: "10px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer" },
  btnGreen: { background: c.green, color: "#fff", border: "none", borderRadius: 8, padding: "10px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer" },
  emailSent: { background: "#E3F6EE", borderRadius: 10, padding: "14px 16px", marginTop: 10 },
  emailSentTitle: { fontSize: 13, fontWeight: 700, color: c.green, marginBottom: 4 },
  emailSentDetail: { fontSize: 12, color: c.sub },
  tasks: { display: "flex", flexDirection: "column", gap: 6, marginTop: 10 },
  task: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, padding: "6px 0" },
  taskBtn: { background: "#fff", border: `1px solid ${c.line}`, borderRadius: 5, padding: "3px 8px", cursor: "pointer", fontSize: 11, fontWeight: 600 },
};

const ASSET_FIELDS = [
  { key: "landing_link", label: "Landing Link (UTM)", type: "input" },
  { key: "offer_title", label: "Offer Title", type: "input" },
  { key: "details_tc", label: "Details / T&C", type: "textarea" },
  { key: "how_to_redeem", label: "How to Redeem", type: "textarea" },
  { key: "promo_codes", label: "Promo Code(s)", type: "input" },
  { key: "code_validity", label: "Code Validity", type: "input" },
  { key: "creative_url", label: "Creative (600×600 JPG/PNG)", type: "upload" },
  { key: "logo_url", label: "Logo (300×300 JPG/PNG)", type: "upload" },
  { key: "targeting", label: "Targeting / Persona", type: "textarea" },
  { key: "daily_budget", label: "Daily Budget (₹)", type: "input" },
  { key: "cpc_cpd", label: "CPC / CPD", type: "input" },
];

function buildEmailDraft(campaign) {
  const lines = [
    "Hi,",
    "",
    "Please find below the campaign details for your reference.",
    "",
    `Landing Link: ${campaign.landing_link || "—"}`,
    `Offer Title: ${campaign.offer_title || "—"}`,
    "",
    "Terms & Conditions:",
    campaign.details_tc || "—",
    "",
    "How to Redeem:",
    campaign.how_to_redeem || "—",
    "",
    `Promo Code(s): ${campaign.promo_codes || "—"}`,
    `Code Validity: ${campaign.code_validity || "—"}`,
    "",
    `Creative: ${campaign.creative_url || "—"}`,
    `Logo: ${campaign.logo_url || "—"}`,
    "",
    `Targeting: ${campaign.targeting || "—"}`,
    "",
    `Daily Budget: ${campaign.daily_budget || "—"}`,
    `CPC/CPD: ${campaign.cpc_cpd || "—"}`,
    "",
    "Regards,",
    "AdOps Team | Razorpay",
  ];
  return lines.join("\n");
}

function CampaignDetail({ campaign, meta, tasks, canEdit = false, onReload }) {
  const [assets, setAssets] = useState({});
  const [saving, setSaving] = useState(false);
  const [emailTo, setEmailTo] = useState(campaign.publisher_email_to || "");
  const [emailSubject, setEmailSubject] = useState(campaign.publisher_email_subject || "");
  const [emailBody, setEmailBody] = useState(campaign.publisher_email_body || "");
  const [sending, setSending] = useState(false);
  const [emailDrafted, setEmailDrafted] = useState(false);
  const gisReady = useGisLoaded();

  const stage = campaign.current_stage;
  const emailSent = !!campaign.publisher_email_sent_at;

  useEffect(() => {
    const a = {};
    ASSET_FIELDS.forEach((f) => { a[f.key] = campaign[f.key] || ""; });
    setAssets(a);
  }, [campaign.campaign_id, campaign.current_stage, campaign.creative_url, campaign.logo_url]);

  const filledCount = ASSET_FIELDS.filter((f) => assets[f.key]?.trim()).length;
  const totalFields = ASSET_FIELDS.length;
  const allFilled = filledCount === totalFields;
  const pct = (filledCount / totalFields) * 100;

  const [assetsSaved, setAssetsSaved] = useState(false);

  const handleSaveAssets = async () => {
    setSaving(true);
    try {
      await updateCampaignAssets(campaign.campaign_id, assets);
      setAssetsSaved(true);
      setTimeout(() => setAssetsSaved(false), 2000);
    } catch (e) { alert("Save failed: " + e.message); }
    finally { setSaving(false); }
  };

  const handleFileUpload = async (field, file) => {
    try {
      const result = await uploadCampaignAsset(campaign.campaign_id, field, file);
      setAssets((prev) => ({ ...prev, [field]: result.url }));
      onReload();
    } catch (e) { alert("Upload failed: " + e.message); }
  };

  const handleDraftEmail = () => {
    const subject = `Campaign Details: ${campaign.name} — ${campaign.offer_title || "RMN"}`;
    setEmailSubject(subject);
    setEmailBody(buildEmailDraft({ ...campaign, ...assets }));
    setEmailDrafted(true);
  };

  const handleSendEmail = async () => {
    if (!emailTo.trim()) { alert("Enter recipient email(s)"); return; }
    if (!emailBody.trim()) { alert("Email body cannot be empty"); return; }
    setSending(true);
    try {
      // 1. Save assets first so they persist
      await updateCampaignAssets(campaign.campaign_id, assets);
      // 2. Send email
      const token = await getGmailAccessToken();
      await sendViaGmail(token, { to: emailTo.split(",").map((x) => x.trim()), subject: emailSubject, html: textToHtml(emailBody) });
      await recordPublisherEmail(campaign.campaign_id, { to: emailTo, subject: emailSubject, body: emailBody });
      // 3. Transition to SHARED_TO_PUBLISHER (should be at CREATIVE_REVIEW already)
      try { await transitionCampaign(campaign.campaign_id, { to_stage: "SHARED_TO_PUBLISHER" }); } catch (e) { /* already past */ }
      onReload();
    } catch (e) { alert("Send failed: " + e.message); }
    finally { setSending(false); }
  };

  const STAGE_ORDER = ["OPS_SETUP", "ASSETS_RECEIVED", "CREATIVE_REVIEW", "SHARED_TO_PUBLISHER", "LIVE"];
  const [notLiveReason, setNotLiveReason] = useState("");

  const handleTransition = async (toStage) => {
    try {
      // Step through intermediate stages to reach the target
      const curIdx = STAGE_ORDER.indexOf(stage);
      const targetIdx = STAGE_ORDER.indexOf(toStage);
      if (targetIdx > curIdx) {
        for (let i = curIdx + 1; i <= targetIdx; i++) {
          await transitionCampaign(campaign.campaign_id, { to_stage: STAGE_ORDER[i] });
        }
      } else {
        await transitionCampaign(campaign.campaign_id, { to_stage: toStage });
      }
      onReload();
    } catch (e) { alert("Transition failed: " + e.message); }
  };

  const toggleTask = async (task) => {
    const next = task.status === "DONE" ? "PENDING" : "DONE";
    try {
      await updateOpsTask(task.task_id, { status: next });
      onReload();
    } catch (e) { alert("Error: " + e.message); }
  };

  const showAssetForm = stage === "OPS_SETUP" && !emailSent;
  const showCreativeReview = stage === "ASSETS_RECEIVED" || stage === "CREATIVE_REVIEW";
  const showEmailCompose = stage === "CREATIVE_REVIEW" && !emailSent;
  const showLiveChoice = stage === "SHARED_TO_PUBLISHER";

  return (
    <div style={s.panel}>
      {/* Ops Tasks */}
      {tasks.length > 0 && (
        <div style={s.section}>
          <div style={s.secTitle}>Ops Checklist</div>
          <div style={s.tasks}>
            {tasks.map((t) => {
              const isReceiveAssets = t.step === "RECEIVE_ASSETS";
              const blocked = isReceiveAssets && t.status !== "DONE" && !allFilled;
              return (
                <div key={t.task_id} style={s.task}>
                  <span>{t.status === "DONE" ? "✅" : "⬜"}</span>
                  <span style={{ flex: 1 }}>{t.step.replace(/_/g, " ")}</span>
                  {blocked ? (
                    <span style={{ fontSize: 11, color: c.muted }}>Fill all assets first</span>
                  ) : (
                    <button style={s.taskBtn} onClick={() => toggleTask(t)}>{t.status === "DONE" ? "Undo" : "Mark done"}</button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Step 1: Asset Form (OPS_SETUP) */}
      {showAssetForm && (
        <div style={s.section}>
          <div style={s.secTitle}>Campaign Assets</div>
          <div style={s.assetStatus}>
            <span style={s.assetCount}>{filledCount}/{totalFields} received</span>
            <div style={s.assetBar}><div style={s.assetFill(pct)} /></div>
          </div>
          <div style={s.grid2}>
            {ASSET_FIELDS.map((f) => (
              <div key={f.key} style={s.field}>
                <label style={s.label}>{f.label}</label>
                {f.type === "upload" ? (
                  <div>
                    {assets[f.key] ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <img src={assets[f.key]} alt={f.label} style={{ width: 48, height: 48, borderRadius: 6, objectFit: "cover", border: `1px solid ${c.line}` }} />
                        <span style={{ fontSize: 12, color: c.green, fontWeight: 600 }}>Uploaded ✓</span>
                        <label style={{ ...s.taskBtn, cursor: "pointer" }}>
                          Replace
                          <input type="file" accept="image/jpeg,image/png" style={{ display: "none" }} onChange={(e) => { const file = e.target.files?.[0]; if (file) handleFileUpload(f.key, file); }} />
                        </label>
                      </div>
                    ) : (
                      <label style={{ ...s.input, cursor: "pointer", display: "flex", alignItems: "center", gap: 8, color: c.muted }}>
                        📎 Click to upload JPG/PNG
                        <input type="file" accept="image/jpeg,image/png" style={{ display: "none" }} onChange={(e) => { const file = e.target.files?.[0]; if (file) handleFileUpload(f.key, file); }} />
                      </label>
                    )}
                  </div>
                ) : f.type === "textarea" ? (
                  <textarea style={s.textarea} value={assets[f.key]} onChange={(e) => setAssets({ ...assets, [f.key]: e.target.value })} placeholder="—" />
                ) : (
                  <input style={s.input} value={assets[f.key]} onChange={(e) => setAssets({ ...assets, [f.key]: e.target.value })} placeholder="—" />
                )}
              </div>
            ))}
          </div>
          <div style={s.btnRow}>
            <button style={s.btnPrimary} onClick={handleSaveAssets} disabled={saving}>{saving ? "Saving…" : assetsSaved ? "Saved ✓" : "Save Assets"}</button>
            {allFilled && (
              <button style={s.btnGreen} onClick={async () => { await updateCampaignAssets(campaign.campaign_id, assets); await handleTransition("ASSETS_RECEIVED"); }}>
                Mark Assets Received →
              </button>
            )}
          </div>
        </div>
      )}

      {/* Step 2: Creative Review (ASSETS_RECEIVED / CREATIVE_REVIEW) */}
      {showCreativeReview && (
        <div style={s.section}>
          <div style={s.secTitle}>Creative Review</div>
          <div style={{ display: "flex", gap: 20, marginBottom: 16, flexWrap: "wrap" }}>
            {campaign.creative_url && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: c.muted, marginBottom: 6, textTransform: "uppercase" }}>Creative</div>
                <a href={campaign.creative_url} target="_blank" rel="noopener noreferrer">
                  <img src={campaign.creative_url} alt="Creative" style={{ width: 150, height: 150, borderRadius: 10, objectFit: "cover", border: `1px solid ${c.line}`, cursor: "pointer" }} />
                </a>
              </div>
            )}
            {campaign.logo_url && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: c.muted, marginBottom: 6, textTransform: "uppercase" }}>Logo</div>
                <a href={campaign.logo_url} target="_blank" rel="noopener noreferrer">
                  <img src={campaign.logo_url} alt="Logo" style={{ width: 100, height: 100, borderRadius: 10, objectFit: "contain", border: `1px solid ${c.line}`, cursor: "pointer" }} />
                </a>
              </div>
            )}
          </div>
          {stage === "ASSETS_RECEIVED" && (
            <div style={s.btnRow}>
              <button style={s.btnPrimary} onClick={() => handleTransition("CREATIVE_REVIEW")}>Approve Creatives ✓</button>
            </div>
          )}
        </div>
      )}

      {/* Step 3: Email to Publisher (CREATIVE_REVIEW stage) */}
      {showEmailCompose && !emailDrafted && (
        <div style={s.btnRow}>
          <button style={s.btnGreen} onClick={handleDraftEmail}>Draft email to publisher →</button>
        </div>
      )}
      {showEmailCompose && emailDrafted && (
        <div style={s.section}>
          <div style={s.secTitle}>Share to Publisher — Review & Send</div>
          <div style={s.field}>
            <label style={s.label}>To (comma-separated)</label>
            <input style={s.input} value={emailTo} onChange={(e) => setEmailTo(e.target.value)} placeholder="publisher@example.com" />
          </div>
          <div style={s.field}>
            <label style={s.label}>Subject</label>
            <input style={s.input} value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} />
          </div>
          <div style={s.field}>
            <label style={s.label}>Body</label>
            <textarea style={{ ...s.textarea, minHeight: 200 }} value={emailBody} onChange={(e) => setEmailBody(e.target.value)} />
          </div>
          <div style={s.btnRow}>
            <button style={s.btnGreen} onClick={handleSendEmail} disabled={sending || !gisReady}>
              {sending ? "Sending…" : "Send email & mark shared ✉️"}
            </button>
            <button style={s.btnGhost} onClick={() => handleTransition("SHARED_TO_PUBLISHER")}>Skip (mark shared without email)</button>
          </div>
        </div>
      )}

      {/* Post-send email info */}
      {emailSent && (
        <div style={s.section}>
          <div style={s.emailSent}>
            <div style={s.emailSentTitle}>✉️ Email sent to publisher</div>
            <div style={s.emailSentDetail}>
              <strong>To:</strong> {campaign.publisher_email_to}<br/>
              <strong>Subject:</strong> {campaign.publisher_email_subject}<br/>
              <strong>Sent:</strong> {new Date(campaign.publisher_email_sent_at).toLocaleString("en-IN")}
            </div>
          </div>
        </div>
      )}

      {/* Step 4: Live or Not Live (SHARED_TO_PUBLISHER) */}
      {showLiveChoice && (
        <div style={s.section}>
          <div style={s.secTitle}>Campaign Status</div>
          <div style={{ fontSize: 13, color: c.sub, marginBottom: 14 }}>Is this campaign live on the publisher?</div>
          <div style={s.btnRow}>
            <button style={s.btnGreen} onClick={() => handleTransition("LIVE")}>Yes, Mark Live 🚀</button>
          </div>
          <div style={{ marginTop: 16, padding: "14px 16px", background: "#FEF3E2", borderRadius: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#B7791F", marginBottom: 8 }}>Not going live?</div>
            <textarea style={{ ...s.textarea, minHeight: 60 }} value={notLiveReason} onChange={(e) => setNotLiveReason(e.target.value)} placeholder="Enter reason why this campaign is not going live..." />
            <button style={{ ...s.btnGhost, marginTop: 8, color: c.red, borderColor: c.red }} onClick={async () => {
              if (!notLiveReason.trim()) { alert("Please enter a reason"); return; }
              try { await markNotLive(campaign.campaign_id, notLiveReason); onReload(); } catch (e) { alert(e.message); }
            }}>Mark Not Live</button>
          </div>
        </div>
      )}

      {/* Terminal: Live */}
      {stage === "LIVE" && (
        <div style={s.emailSent}>
          <div style={s.emailSentTitle}>🚀 Campaign is Live</div>
          <div style={s.emailSentDetail}>Head to the <strong>Campaign Success & Tracking</strong> tab to set up tracking.</div>
        </div>
      )}

      {/* Terminal: Not Live */}
      {stage === "NOT_LIVE" && (
        <div style={{ background: "#FEE2E2", borderRadius: 10, padding: "14px 16px" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: c.red }}>Campaign Not Live</div>
          <div style={{ fontSize: 12, color: c.sub, marginTop: 4 }}>Reason: {campaign.not_live_reason || "—"}</div>
        </div>
      )}
    </div>
  );
}

function NewCampaignModal({ onClose, onCreated }) {
  const [advertisers, setAdvertisers] = useState([]);
  const [publishers, setPublishers] = useState([]);
  const [advId, setAdvId] = useState("");
  const [pubId, setPubId] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    Promise.all([getAdvertisers(), getPublishers()]).then(([a, p]) => {
      setAdvertisers((a.advertisers || []).filter((x) => x.status === "ONBOARDED"));
      setPublishers(p.publishers || []);
    });
  }, []);

  const handleCreate = async () => {
    if (!advId || !pubId) { alert("Select both advertiser and publisher"); return; }
    setCreating(true);
    try {
      await createCampaign({ advertiser_id: advId, publisher_id: pubId });
      onCreated();
      onClose();
    } catch (e) { alert("Failed: " + e.message); }
    finally { setCreating(false); }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,36,0.45)", zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 14, padding: "28px 32px", width: 420, boxShadow: "0 20px 60px rgba(15,23,36,0.25)" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 18, fontWeight: 800, color: c.ink, marginBottom: 18 }}>New Campaign</div>
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: c.muted, display: "block", marginBottom: 4 }}>Advertiser</label>
          <select style={{ ...s.input, width: "100%" }} value={advId} onChange={(e) => setAdvId(e.target.value)}>
            <option value="">Select advertiser…</option>
            {advertisers.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.id})</option>)}
          </select>
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: c.muted, display: "block", marginBottom: 4 }}>Publisher</label>
          <select style={{ ...s.input, width: "100%" }} value={pubId} onChange={(e) => setPubId(e.target.value)}>
            <option value="">Select publisher…</option>
            {publishers.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}
          </select>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
          <button style={s.btnGhost} onClick={onClose}>Cancel</button>
          <button style={s.btnPrimary} onClick={handleCreate} disabled={creating}>{creating ? "Creating…" : "Create Campaign"}</button>
        </div>
      </div>
    </div>
  );
}

export default function CampaignOps({ userRole = "VIEWER" }) {
  const canEdit = userRole === "ADMIN" || userRole === "OPS";
  const [campaigns, setCampaigns] = useState([]);
  const [meta, setMeta] = useState({ stages: [], labels: {}, transitions: {}, handoff_on: {} });
  const [tasksByCampaign, setTasksByCampaign] = useState({});
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    Promise.all([getWorkflowCampaigns(), getWorkflowStages()])
      .then(([cRes, m]) => {
        const camps = (cRes.campaigns || []).filter((c) => !["LIVE", "COMPLETED", "NOT_LIVE", "CANCELLED"].includes(c.current_stage));
        setCampaigns(camps);
        setMeta(m);
        campaignsRef.current = camps;
        return Promise.all(camps.map((cp) => getOpsTasks(cp.campaign_id)));
      })
      .then((taskLists) => {
        const map = {};
        (taskLists || []).forEach((tl, i) => {
          if (campaignsRef.current[i]) map[campaignsRef.current[i].campaign_id] = tl.ops_tasks || [];
        });
        setTasksByCampaign(map);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  const campaignsRef = React.useRef([]);
  useEffect(load, []);

  if (loading) return <div style={s.loading}>Loading campaigns…</div>;

  const stages = meta.stages || [];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: c.muted }}>{campaigns.length} campaign{campaigns.length !== 1 ? "s" : ""}</div>
      </div>
      {campaigns.length === 0 ? (
        <div style={s.empty}>No campaigns yet. Click "+ New Campaign" or onboard an advertiser to create one.</div>
      ) : (
      <div style={s.list}>
      {campaigns.map((cam) => {
        const curIdx = stages.indexOf(cam.current_stage);
        const isSelected = selected === cam.campaign_id;
        const isTerminal = ["COMPLETED", "CANCELLED"].includes(cam.current_stage);
        return (
          <div key={cam.campaign_id} style={{ ...s.card, ...(isSelected ? s.cardActive : {}) }}>
            <div style={{ ...s.head, cursor: "pointer" }} onClick={() => setSelected(isSelected ? null : cam.campaign_id)}>
              <div>
                <div style={s.title}>
                  {cam.advertiser_name || cam.name}
                  {cam.publisher_name && <span style={{ fontWeight: 400, color: c.muted }}> → {cam.publisher_name}</span>}
                </div>
                <div style={s.advRef}>{cam.campaign_id}{cam.advertiser_ref_id ? ` · ${cam.advertiser_ref_id}` : ""}</div>
              </div>
              <span style={{ ...s.badge, ...(isTerminal ? s.badgeDone : s.badgeActive) }}>
                {meta.labels?.[cam.current_stage] || cam.current_stage}
              </span>
            </div>

            <div style={s.stepper}>
              {stages.map((st, i) => (
                <React.Fragment key={st}>
                  {i > 0 && <div style={s.connector} />}
                  <span style={{ ...s.step, ...(i < curIdx ? s.stepDone : i === curIdx ? s.stepCurrent : s.stepFuture) }}>
                    {i < curIdx ? "✓ " : ""}{meta.labels?.[st] || st}
                  </span>
                </React.Fragment>
              ))}
            </div>

            {isSelected && (
              <CampaignDetail
                campaign={cam}
                meta={meta}
                tasks={tasksByCampaign[cam.campaign_id] || []}
                canEdit={canEdit}
                onReload={load}
              />
            )}
          </div>
        );
      })}
      </div>
      )}
    </div>
  );
}
