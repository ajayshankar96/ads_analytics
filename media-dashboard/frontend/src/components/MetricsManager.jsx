import React, { useState, useEffect } from "react";
import { getMetricConfig, saveMetricConfig } from "../api";

/* Shared helpers + the ⚙ "Manage metrics" modal for the two performance tabs.

   The backend keeps one config row per scope ('advertiser' | 'publisher'):
     { hidden: [builtin keys], custom: [{key, label, kind: 'base'|'derived',
       source|formula, fmt}] }
   Perf responses embed it as `metric_config`, so tables render custom columns
   in the same round trip; this modal edits it via /api/performance/metric-config. */

// ── Value formatting (shared by both performance tables) ─────────────────────
export function fmtCompact(n) {
  if (n === undefined || n === null || n === "N/A") return "—";
  if (typeof n === "string") return n;
  if (n >= 1e7) return `${(n / 1e7).toFixed(1)}Cr`;
  if (n >= 1e5) return `${(n / 1e5).toFixed(1)}L`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toLocaleString();
}

const fmtGoal = (goal) => {
  if (!goal || !goal.goal_type) return "—";
  if (goal.goal_type === "CAC") return goal.target_cac != null ? `CAC ≤ ₹${goal.target_cac}` : "CAC";
  return goal.target_roas != null ? `ROAS ≥ ${goal.target_roas}x` : "ROAS";
};

// Render one cell's text for a row item + column descriptor ({key, fmt}).
export function formatCell(item, col) {
  const v = item[col.key];
  switch (col.fmt) {
    case "goal": return fmtGoal(item.goal);
    case "percent": return v === null || v === undefined ? "—" : `${v}%`;
    case "currency": return v === null || v === undefined ? "—" : `₹${fmtCompact(v)}`;
    case "currency2": return v ? `₹${v}` : "—"; // raw (uncompressed) rupee value
    case "multiple": return v === null || v === undefined ? "—" : `${v}x`;
    case "decimal": return v === null || v === undefined ? "—" : Number(v).toLocaleString();
    default: return fmtCompact(v);
  }
}

// Effective column list = built-ins minus hidden ones, plus customs. Derived
// metrics get no previous-period delta (same as ROAS/CAC — ratios of totals).
export function buildColumns(builtins, metricConfig) {
  const hidden = new Set((metricConfig?.hidden || []).map((k) => String(k).toLowerCase()));
  const custom = metricConfig?.custom || [];
  return [
    ...builtins.filter((col) => !hidden.has(col.key)),
    ...custom.map((m) => ({
      key: m.key,
      label: m.label || m.key,
      fmt: m.fmt || "number",
      delta: m.kind !== "derived",
      custom: true,
    })),
  ];
}

const FMT_OPTIONS = [
  ["number", "Number (1.2L)"],
  ["currency", "Currency (₹)"],
  ["percent", "Percent (%)"],
  ["decimal", "Plain decimal"],
  ["multiple", "Multiple (x)"],
];

const ui = {
  overlay: { position: "fixed", inset: 0, background: "rgba(15,23,36,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 },
  panel: { background: "#fff", borderRadius: 12, padding: "20px 22px", width: 640, maxWidth: "94vw", maxHeight: "86vh", overflowY: "auto", boxShadow: "0 12px 40px rgba(0,0,0,0.22)" },
  head: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 },
  x: { border: "none", background: "none", fontSize: 22, color: "#64748b", cursor: "pointer", lineHeight: 1, padding: 2 },
  sectionTitle: { fontSize: 11, fontWeight: 800, color: "#64748b", textTransform: "uppercase", letterSpacing: ".05em", margin: "18px 0 8px" },
  chip: { display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer", padding: "4px 10px", borderRadius: 6, border: "1px solid #d1d5db", userSelect: "none" },
  customRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "8px 10px", border: "1px solid #e2e8f0", borderRadius: 8, marginBottom: 6 },
  kindTag: { marginLeft: 8, fontSize: 10, fontWeight: 700, color: "#7c3aed", background: "#f3e8ff", borderRadius: 8, padding: "1px 7px", verticalAlign: "middle" },
  removeBtn: { border: "1px solid #fecaca", background: "#fef2f2", color: "#dc2626", borderRadius: 6, padding: "4px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" },
  input: { border: "1px solid #d1d5db", borderRadius: 6, padding: "6px 9px", fontSize: 12, outline: "none", background: "#fff" },
  addBtn: { background: "#2563eb", color: "#fff", border: "none", borderRadius: 6, padding: "7px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" },
  cancelBtn: { background: "#fff", color: "#334155", border: "1px solid #d1d5db", borderRadius: 6, padding: "7px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" },
  saveBtn: { background: "#059669", color: "#fff", border: "none", borderRadius: 6, padding: "7px 16px", fontSize: 12, fontWeight: 700, cursor: "pointer" },
};

export default function MetricsManager({ scope, builtins, onClose, onSaved }) {
  const [cfg, setCfg] = useState(null); // {hidden, custom, available_columns, formula_keys}
  const [hidden, setHidden] = useState([]);
  const [custom, setCustom] = useState([]);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  // add-metric form
  const [kind, setKind] = useState("base");
  const [label, setLabel] = useState("");
  const [source, setSource] = useState("");
  const [formula, setFormula] = useState("");
  const [fmtType, setFmtType] = useState("number");

  useEffect(() => {
    getMetricConfig(scope)
      .then((d) => { setCfg(d); setHidden(d.hidden || []); setCustom(d.custom || []); })
      .catch((e) => setErr(e.message || "Failed to load metric config"));
  }, [scope]);

  const toggleHidden = (key) =>
    setHidden(hidden.includes(key) ? hidden.filter((k) => k !== key) : [...hidden, key]);

  // Names usable inside a derived formula: server-known keys + any base
  // customs added in this dialog but not yet saved.
  const formulaKeys = [...new Set([
    ...(cfg?.formula_keys || []),
    ...custom.filter((m) => m.kind === "base").map((m) => m.key),
  ])].sort();

  const addMetric = () => {
    const trimmed = label.trim();
    const key = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    if (!key) { setErr("Enter a metric name"); return; }
    if (builtins.some((b) => b.key === key) || custom.some((m) => m.key === key)) {
      setErr(`"${trimmed}" clashes with an existing metric`); return;
    }
    if (kind === "base" && !source) { setErr("Pick the data column this metric reads from"); return; }
    if (kind === "derived" && !formula.trim()) { setErr("Enter the calculation formula"); return; }
    const entry = kind === "base"
      ? { key, label: trimmed, kind, source, fmt: fmtType }
      : { key, label: trimmed, kind, formula: formula.trim(), fmt: fmtType };
    setCustom([...custom, entry]);
    setLabel(""); setSource(""); setFormula(""); setErr("");
  };

  const save = async () => {
    setSaving(true); setErr("");
    try {
      await saveMetricConfig({ scope, hidden, custom });
      onSaved();
      onClose();
    } catch (e) {
      setErr(e.message || "Save failed"); // backend rejects bad formulas / dup keys
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={ui.overlay} onClick={onClose}>
      <div style={ui.panel} onClick={(e) => e.stopPropagation()}>
        <div style={ui.head}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#0f1724" }}>
              Manage metrics — {scope} performance
            </div>
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
              Changes apply to everyone viewing this tab.
            </div>
          </div>
          <button onClick={onClose} style={ui.x} title="Close">×</button>
        </div>

        {!cfg && !err && <div style={{ padding: 30, textAlign: "center", color: "#888" }}>Loading…</div>}

        {cfg && (
          <>
            <div style={ui.sectionTitle}>Built-in metrics (untick to hide)</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {builtins.map((b) => {
                const visible = !hidden.includes(b.key);
                return (
                  <label key={b.key} style={{ ...ui.chip, borderColor: visible ? "#2563eb" : "#d1d5db", background: visible ? "#eff6ff" : "#fff", color: visible ? "#1e293b" : "#94a3b8" }}>
                    <input type="checkbox" checked={visible} onChange={() => toggleHidden(b.key)} />
                    {b.label}
                  </label>
                );
              })}
            </div>

            <div style={ui.sectionTitle}>Custom metrics</div>
            {custom.length === 0 && (
              <div style={{ fontSize: 12, color: "#94a3b8" }}>None yet — add one below.</div>
            )}
            {custom.map((m) => (
              <div key={m.key} style={ui.customRow}>
                <div>
                  <span style={{ fontWeight: 700, fontSize: 13, color: "#0f1724" }}>{m.label}</span>
                  <span style={{ ...ui.kindTag, ...(m.kind !== "derived" ? { color: "#0891b2", background: "#e0f2fe" } : {}) }}>
                    {m.kind === "derived" ? "derived" : "column"}
                  </span>
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 2, fontFamily: m.kind === "derived" ? "monospace" : "inherit" }}>
                    {m.kind === "derived" ? m.formula : `reads data column “${m.source}”`}
                  </div>
                </div>
                <button onClick={() => setCustom(custom.filter((x) => x.key !== m.key))} style={ui.removeBtn}>
                  Remove
                </button>
              </div>
            ))}

            <div style={ui.sectionTitle}>Add a metric</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <select value={kind} onChange={(e) => { setKind(e.target.value); setErr(""); }} style={ui.input}>
                <option value="base">From a data column</option>
                <option value="derived">Derived (formula)</option>
              </select>
              <input
                value={label}
                onChange={(e) => { setLabel(e.target.value); setErr(""); }}
                placeholder="Metric name (e.g. Installs)"
                style={{ ...ui.input, width: 170 }}
              />
              {kind === "base" ? (
                <select value={source} onChange={(e) => { setSource(e.target.value); setErr(""); }} style={{ ...ui.input, maxWidth: 210 }}>
                  <option value="">Data column…</option>
                  {(cfg.available_columns || []).map((col) => (
                    <option key={col} value={col}>{col}</option>
                  ))}
                </select>
              ) : (
                <input
                  value={formula}
                  onChange={(e) => { setFormula(e.target.value); setErr(""); }}
                  placeholder="e.g. revenue / clicks"
                  style={{ ...ui.input, width: 210, fontFamily: "monospace" }}
                />
              )}
              <select value={fmtType} onChange={(e) => setFmtType(e.target.value)} style={ui.input} title="Display format">
                {FMT_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <button onClick={addMetric} style={ui.addBtn}>+ Add</button>
            </div>
            {kind === "derived" ? (
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 6 }}>
                Use numbers, <span style={{ fontFamily: "monospace" }}>+ - * /</span> and parentheses over:{" "}
                <span style={{ fontFamily: "monospace" }}>{formulaKeys.join(", ")}</span>
              </div>
            ) : (
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 6 }}>
                Column metrics sum that data column per row and show period-over-period deltas.
              </div>
            )}
          </>
        )}

        {err && <div style={{ fontSize: 12, color: "#dc2626", marginTop: 12, fontWeight: 600 }}>{err}</div>}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
          <button onClick={onClose} style={ui.cancelBtn}>Cancel</button>
          <button onClick={save} disabled={saving || !cfg} style={{ ...ui.saveBtn, opacity: saving || !cfg ? 0.6 : 1 }}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
