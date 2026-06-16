import React, { useState, useEffect } from "react";
import {
  getWorkflowCampaigns,
  getWorkflowStages,
  getOpsTasks,
  updateOpsTask,
  transitionCampaign,
  updateCampaignAssets,
  recordPublisherEmail,
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
  { key: "creative_url", label: "Creative (URL/link)", type: "input" },
  { key: "logo_url", label: "Logo (URL/link)", type: "input" },
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

function CampaignDetail({ campaign, meta, tasks, onReload }) {
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
  }, [campaign.campaign_id]);

  const filledCount = ASSET_FIELDS.filter((f) => assets[f.key]?.trim()).length;
  const totalFields = ASSET_FIELDS.length;
  const allFilled = filledCount === totalFields;
  const pct = (filledCount / totalFields) * 100;

  const handleSaveAssets = async () => {
    setSaving(true);
    try {
      await updateCampaignAssets(campaign.campaign_id, assets);
      onReload();
    } catch (e) { alert("Save failed: " + e.message); }
    finally { setSaving(false); }
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
      const token = await getGmailAccessToken();
      await sendViaGmail(token, { to: emailTo.split(",").map((x) => x.trim()), subject: emailSubject, html: textToHtml(emailBody) });
      await recordPublisherEmail(campaign.campaign_id, { to: emailTo, subject: emailSubject, body: emailBody });
      try {
        await transitionCampaign(campaign.campaign_id, { to_stage: "SHARED_TO_PUBLISHER" });
      } catch (e) { /* might already be at this stage */ }
      onReload();
    } catch (e) { alert("Send failed: " + e.message); }
    finally { setSending(false); }
  };

  const handleTransition = async (toStage) => {
    try {
      await transitionCampaign(campaign.campaign_id, { to_stage: toStage });
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

  const showAssetForm = ["OPS_SETUP", "ASSETS_RECEIVED"].includes(stage);
  const showEmailCompose = (stage === "OPS_SETUP" || stage === "ASSETS_RECEIVED") && !emailSent;
  const showPostSend = ["SHARED_TO_PUBLISHER", "CREATIVE_REVIEW", "LIVE", "COMPLETED"].includes(stage) || emailSent;

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

      {/* Asset Form */}
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
                {f.type === "textarea" ? (
                  <textarea style={s.textarea} value={assets[f.key]} onChange={(e) => setAssets({ ...assets, [f.key]: e.target.value })} placeholder="—" />
                ) : (
                  <input style={s.input} value={assets[f.key]} onChange={(e) => setAssets({ ...assets, [f.key]: e.target.value })} placeholder="—" />
                )}
              </div>
            ))}
          </div>
          <div style={s.btnRow}>
            <button style={s.btnPrimary} onClick={handleSaveAssets} disabled={saving}>{saving ? "Saving…" : "Save Assets"}</button>
            {allFilled && !emailDrafted && (
              <button style={s.btnGreen} onClick={handleDraftEmail}>Draft email to publisher →</button>
            )}
          </div>
        </div>
      )}

      {/* Email Compose (draft → review → send) */}
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

      {/* Post-send: show sent email info */}
      {showPostSend && emailSent && (
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

      {/* Stage transitions for later stages */}
      {stage === "SHARED_TO_PUBLISHER" && (
        <div style={s.btnRow}>
          <button style={s.btnPrimary} onClick={() => handleTransition("CREATIVE_REVIEW")}>Mark Creative Review ✓</button>
        </div>
      )}
      {stage === "CREATIVE_REVIEW" && (
        <div style={s.btnRow}>
          <button style={s.btnGreen} onClick={() => handleTransition("LIVE")}>Go Live 🚀</button>
        </div>
      )}
      {stage === "LIVE" && (
        <div style={s.btnRow}>
          <button style={s.btnPrimary} onClick={() => handleTransition("COMPLETED")}>Mark Completed</button>
        </div>
      )}
    </div>
  );
}

export default function CampaignOps() {
  const [campaigns, setCampaigns] = useState([]);
  const [meta, setMeta] = useState({ stages: [], labels: {}, transitions: {}, handoff_on: {} });
  const [tasksByCampaign, setTasksByCampaign] = useState({});
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    Promise.all([getWorkflowCampaigns(), getWorkflowStages()])
      .then(([cRes, m]) => {
        const camps = cRes.campaigns || [];
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
  if (campaigns.length === 0)
    return <div style={s.empty}>No campaigns yet. Onboard an advertiser in the Sales Pipeline to open one.</div>;

  const stages = meta.stages || [];

  return (
    <div style={s.list}>
      {campaigns.map((cam) => {
        const curIdx = stages.indexOf(cam.current_stage);
        const isSelected = selected === cam.campaign_id;
        const isTerminal = ["COMPLETED", "CANCELLED"].includes(cam.current_stage);
        return (
          <div key={cam.campaign_id} style={{ ...s.card, ...(isSelected ? s.cardActive : {}) }}>
            <div style={{ ...s.head, cursor: "pointer" }} onClick={() => setSelected(isSelected ? null : cam.campaign_id)}>
              <div>
                <div style={s.title}>{cam.name}</div>
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
                onReload={load}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
