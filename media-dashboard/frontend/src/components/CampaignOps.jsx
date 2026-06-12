import React, { useState, useEffect } from "react";
import {
  getWorkflowCampaigns,
  getWorkflowStages,
  getOpsTasks,
  updateOpsTask,
  transitionCampaign,
} from "../api";

const s = {
  loading: { textAlign: "center", padding: 40, color: "#888" },
  empty: { textAlign: "center", padding: 30, color: "#94a3b8", fontSize: 14 },
  card: { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, padding: 16, marginBottom: 12, boxShadow: "0 1px 4px rgba(0,0,0,0.05)" },
  head: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  title: { fontSize: 15, fontWeight: 700, color: "#1e293b" },
  sub: { fontSize: 12, color: "#64748b" },
  stepper: { display: "flex", alignItems: "center", margin: "12px 0", flexWrap: "wrap", gap: 4 },
  step: { display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, padding: "4px 10px", borderRadius: 14 },
  connector: { width: 22, height: 2, background: "#e5e7eb" },
  tasks: { margin: "10px 0", display: "flex", flexDirection: "column", gap: 6 },
  task: { display: "flex", alignItems: "center", gap: 8, fontSize: 13 },
  taskBtn: { background: "#fff", border: "1px solid #d1d5db", borderRadius: 5, padding: "3px 8px", cursor: "pointer", fontSize: 12 },
  row: { display: "flex", gap: 8, alignItems: "center", marginTop: 10, flexWrap: "wrap" },
  select: { border: "1px solid #d1d5db", borderRadius: 5, padding: "6px 8px", fontSize: 13 },
  input: { border: "1px solid #d1d5db", borderRadius: 5, padding: "6px 8px", fontSize: 13, minWidth: 220 },
  btn: { background: "#2563eb", color: "#fff", border: "none", borderRadius: 5, padding: "7px 14px", cursor: "pointer", fontSize: 13, fontWeight: 600 },
  hint: { fontSize: 11, color: "#94a3b8", marginTop: 4 },
};

const DONE = { background: "#dcfce7", color: "#15803d" };
const CURRENT = { background: "#2563eb", color: "#fff" };
const FUTURE = { background: "#f1f5f9", color: "#94a3b8" };
const CANCELLED = { background: "#fee2e2", color: "#b91c1c" };

export default function CampaignOps() {
  const [campaigns, setCampaigns] = useState([]);
  const [meta, setMeta] = useState({ stages: [], labels: {}, transitions: {}, handoff_on: {} });
  const [tasksByCampaign, setTasksByCampaign] = useState({});
  const [pending, setPending] = useState({}); // campaign_id -> { to_stage, notify_recipients }
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    Promise.all([getWorkflowCampaigns(), getWorkflowStages()])
      .then(([c, m]) => {
        const camps = c.campaigns || [];
        setCampaigns(camps);
        setMeta(m);
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

  // keep a ref so the second .then can map task lists back to campaign ids
  const campaignsRef = React.useRef([]);
  useEffect(() => { campaignsRef.current = campaigns; }, [campaigns]);
  useEffect(load, []);

  const toggleTask = async (task) => {
    const next = task.status === "DONE" ? "PENDING" : "DONE";
    try {
      await updateOpsTask(task.task_id, { status: next });
      load();
    } catch (e) {
      alert("Error updating task: " + e.message);
    }
  };

  const advance = async (campaign) => {
    const p = pending[campaign.campaign_id] || {};
    if (!p.to_stage) { alert("Pick a stage to move to"); return; }
    try {
      const recips = (p.notify_recipients || "").split(",").map((x) => x.trim()).filter(Boolean);
      await transitionCampaign(campaign.campaign_id, {
        to_stage: p.to_stage,
        notify_recipients: recips.length ? recips : null,
      });
      setPending({ ...pending, [campaign.campaign_id]: {} });
      load();
    } catch (e) {
      alert("Error updating stage: " + e.message);
    }
  };

  if (loading) return <div style={s.loading}>Loading campaigns…</div>;
  if (campaigns.length === 0)
    return <div style={s.empty}>No campaigns yet. Close a lead in the Sales Pipeline to open one.</div>;

  const stages = meta.stages || [];

  return (
    <div>
      {campaigns.map((c) => {
        const current = c.current_stage;
        const curIdx = stages.indexOf(current);
        const allowed = meta.transitions?.[current] || [];
        const p = pending[c.campaign_id] || {};
        const showNotify = p.to_stage && meta.handoff_on?.[p.to_stage];
        const tasks = tasksByCampaign[c.campaign_id] || [];
        return (
          <div key={c.campaign_id} style={s.card}>
            <div style={s.head}>
              <div>
                <div style={s.title}>{c.name}</div>
                <div style={s.sub}>{c.campaign_id}{c.advertiser_ref_id ? ` · adv ${c.advertiser_ref_id}` : ""}</div>
              </div>
              <span style={{ ...s.step, ...(current === "CANCELLED" ? CANCELLED : CURRENT) }}>
                {meta.labels?.[current] || current}
              </span>
            </div>

            <div style={s.stepper}>
              {stages.map((st, i) => (
                <React.Fragment key={st}>
                  {i > 0 && <div style={s.connector} />}
                  <span style={{ ...s.step, ...(i < curIdx ? DONE : i === curIdx ? CURRENT : FUTURE) }}>
                    {i < curIdx ? "✓ " : ""}{meta.labels?.[st] || st}
                  </span>
                </React.Fragment>
              ))}
            </div>

            {tasks.length > 0 && (
              <div style={s.tasks}>
                {tasks.map((t) => (
                  <div key={t.task_id} style={s.task}>
                    <span style={{ width: 16 }}>{t.status === "DONE" ? "✅" : "⬜"}</span>
                    <span style={{ flex: 1 }}>{t.step.replace(/_/g, " ")}</span>
                    <button style={s.taskBtn} onClick={() => toggleTask(t)}>
                      {t.status === "DONE" ? "Undo" : "Mark done"}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {allowed.length > 0 ? (
              <div style={s.row}>
                <select
                  style={s.select}
                  value={p.to_stage || ""}
                  onChange={(e) => setPending({ ...pending, [c.campaign_id]: { ...p, to_stage: e.target.value } })}
                >
                  <option value="">Move to…</option>
                  {allowed.map((st) => (
                    <option key={st} value={st}>{meta.labels?.[st] || st}</option>
                  ))}
                </select>
                {showNotify && (
                  <input
                    style={s.input}
                    placeholder={`Notify ${meta.handoff_on[p.to_stage]} (comma-separated emails)`}
                    value={p.notify_recipients || ""}
                    onChange={(e) => setPending({ ...pending, [c.campaign_id]: { ...p, notify_recipients: e.target.value } })}
                  />
                )}
                <button style={s.btn} onClick={() => advance(c)}>Update Stage</button>
              </div>
            ) : (
              <div style={s.hint}>No further transitions — campaign is {meta.labels?.[current] || current}.</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
