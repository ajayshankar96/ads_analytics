import React, { useEffect, useState } from "react";
import { getSheetHealth } from "../api";

const c = { blue: "#2E5BFF", ink: "#0F1724", sub: "#52606D", line: "#E6EAF0", muted: "#768EA7", green: "#0F8C6A", red: "#C8321E", amber: "#B7791F", bg: "#F7F8FA" };

// Freshness semantics (mirrors backend check_sheet_health): a sheet is judged
// by the last date where a mapped metric actually has a value — prefilled
// date columns don't count as data.
const FRESHNESS = {
  fresh:          { label: "Up to date",     color: c.green, bg: "#E3F6EE", icon: "✓" },
  lagging:        { label: "Lagging",        color: c.amber, bg: "#FDF3E3", icon: "⏳" },
  stale:          { label: "Stale",          color: c.red,   bg: "#FDEBE8", icon: "✕" },
  no_data:        { label: "No data yet",    color: c.muted, bg: c.bg,      icon: "—" },
  not_configured: { label: "Not configured", color: c.muted, bg: c.bg,      icon: "⚙" },
};

function FreshnessChip({ freshness, daysBehind }) {
  const f = FRESHNESS[freshness] || FRESHNESS.no_data;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: f.bg, color: f.color, borderRadius: 999, padding: "3px 10px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>
      {f.icon} {f.label}{freshness === "lagging" || freshness === "stale" ? ` · ${daysBehind}d behind` : ""}
    </span>
  );
}

function SummaryCard({ label, value, color, sub, active, onClick }) {
  return (
    <div onClick={onClick} style={{ flex: 1, minWidth: 150, background: "#fff", border: `1px solid ${active ? color : c.line}`, borderRadius: 12, padding: "14px 16px", cursor: onClick ? "pointer" : "default", boxShadow: active ? `0 0 0 2px ${color}22` : "none" }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: c.muted, textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: c.sub, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function AlertBadge({ alert }) {
  const isErr = alert.severity === "error";
  return (
    <div style={{ display: "flex", gap: 7, alignItems: "flex-start", background: isErr ? "#FDEBE8" : "#FDF3E3", borderRadius: 7, padding: "6px 10px", marginTop: 4 }}>
      <span style={{ fontSize: 11 }}>{isErr ? "🚨" : "⚠️"}</span>
      <span style={{ fontSize: 11, color: isErr ? c.red : c.amber, lineHeight: 1.5 }}>{alert.message}</span>
    </div>
  );
}

export default function SheetHealth() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState(null); // null | freshness key | "alerts"
  const [expanded, setExpanded] = useState({}); // rowKey -> bool

  const load = async (refresh = false) => {
    setLoading(true); setError(null);
    try { setData(await getSheetHealth(refresh)); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(false); }, []);

  const sheets = data?.sheets || [];
  const summary = data?.summary || {};
  const visible = sheets.filter((s) => {
    if (!filter) return true;
    if (filter === "alerts") return (s.alerts || []).some((a) => a.severity === "error");
    return s.freshness === filter;
  });

  return (
    <div style={{ padding: 24, maxWidth: 1200 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: c.ink }}>Sheet Health</h2>
          <div style={{ fontSize: 12, color: c.sub, marginTop: 4, maxWidth: 640 }}>
            Freshness and consistency of every configured advertiser / publisher data sheet.
            A sheet counts as updated only when metric values are filled — prefilled dates don't count.
            Alerts fire when a sheet no longer matches the setup that was saved (renamed headers, missing tabs, changed segments).
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <button onClick={() => load(true)} disabled={loading} style={{ background: c.blue, color: "#fff", border: "none", borderRadius: 8, padding: "9px 16px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
            {loading ? "Checking sheets…" : "↻ Re-check now"}
          </button>
          {data?.generated_at && (
            <div style={{ fontSize: 10, color: c.muted, marginTop: 5 }}>
              Last checked {new Date(data.generated_at).toLocaleString()} {data.cached ? "(cached)" : ""}
            </div>
          )}
        </div>
      </div>

      {error && <div style={{ background: "#FDEBE8", color: c.red, borderRadius: 8, padding: "10px 14px", fontSize: 12, marginTop: 12 }}>Failed to load: {error}</div>}

      {loading && !data && (
        <div style={{ padding: 60, textAlign: "center", color: c.muted, fontSize: 13 }}>
          Scanning every configured sheet… this reads live Google Sheets and can take a minute.
        </div>
      )}

      {data && (
        <>
          <div style={{ display: "flex", gap: 12, marginTop: 16, flexWrap: "wrap" }}>
            <SummaryCard label="Up to date" value={summary.fresh || 0} color={c.green} sub="data through yesterday" active={filter === "fresh"} onClick={() => setFilter(filter === "fresh" ? null : "fresh")} />
            <SummaryCard label="Lagging" value={summary.lagging || 0} color={c.amber} sub="2–6 days behind" active={filter === "lagging"} onClick={() => setFilter(filter === "lagging" ? null : "lagging")} />
            <SummaryCard label="Stale" value={summary.stale || 0} color={c.red} sub="7+ days behind" active={filter === "stale"} onClick={() => setFilter(filter === "stale" ? null : "stale")} />
            <SummaryCard label="Alerts" value={summary.with_alerts || 0} color={summary.with_alerts ? c.red : c.muted} sub="setup changed / broken" active={filter === "alerts"} onClick={() => setFilter(filter === "alerts" ? null : "alerts")} />
            <SummaryCard label="Not configured" value={summary.not_configured || 0} color={c.muted} sub="no mapping saved" active={filter === "not_configured"} onClick={() => setFilter(filter === "not_configured" ? null : "not_configured")} />
          </div>

          {filter && (
            <div style={{ fontSize: 11, color: c.sub, marginTop: 10 }}>
              Showing {visible.length} of {sheets.length} sheets · <span onClick={() => setFilter(null)} style={{ color: c.blue, cursor: "pointer", fontWeight: 600 }}>clear filter</span>
            </div>
          )}

          <div style={{ background: "#fff", border: `1px solid ${c.line}`, borderRadius: 12, marginTop: 14, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: c.bg }}>
                  {["Campaign", "Sheet", "Segment", "Tabs matched", "Latest data", "Freshness", "Alerts"].map((h) => (
                    <th key={h} style={{ textAlign: "left", padding: "10px 12px", fontSize: 10, fontWeight: 700, color: c.muted, textTransform: "uppercase", letterSpacing: 0.4, borderBottom: `1px solid ${c.line}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 && (
                  <tr><td colSpan={7} style={{ padding: 30, textAlign: "center", color: c.muted }}>No sheets {filter ? "match this filter" : "are configured yet"}.</td></tr>
                )}
                {visible.map((s) => {
                  const key = `${s.campaign_id}-${s.side}`;
                  const errAlerts = (s.alerts || []).filter((a) => a.severity === "error");
                  const warnAlerts = (s.alerts || []).filter((a) => a.severity !== "error");
                  const isOpen = !!expanded[key];
                  return (
                    <React.Fragment key={key}>
                      <tr style={{ borderBottom: `1px solid #F1F3F6`, background: errAlerts.length ? "#FFFBFA" : "#fff" }}>
                        <td style={{ padding: "10px 12px", verticalAlign: "top" }}>
                          <div style={{ fontWeight: 700, color: c.ink }}>{s.campaign_id}</div>
                          <div style={{ fontSize: 11, color: c.sub }}>{s.campaign_name}</div>
                        </td>
                        <td style={{ padding: "10px 12px", verticalAlign: "top" }}>
                          <span style={{ display: "inline-block", background: s.side === "publisher" ? "#EAF0FF" : "#E3F6EE", color: s.side === "publisher" ? c.blue : c.green, borderRadius: 5, padding: "2px 8px", fontSize: 10, fontWeight: 700, textTransform: "uppercase" }}>{s.side}</span>
                          <div style={{ fontSize: 11, color: c.sub, marginTop: 3 }}>
                            {s.party || "—"} {s.sheet_url && <a href={s.sheet_url} target="_blank" rel="noopener noreferrer" style={{ color: c.blue }}>↗</a>}
                          </div>
                        </td>
                        <td style={{ padding: "10px 12px", verticalAlign: "top", fontSize: 11, color: c.ink }}>
                          {s.segment || "—"}
                          {s.self_targeted && <div style={{ fontSize: 10, color: c.muted }}>self-targeted</div>}
                        </td>
                        <td style={{ padding: "10px 12px", verticalAlign: "top", fontSize: 11, color: c.ink }}>
                          {(s.tabs_matched || []).length
                            ? <span title={(s.tabs_matched || []).join(", ")}>{s.tabs_matched.length} tab(s)</span>
                            : <span style={{ color: s.freshness === "not_configured" ? c.muted : c.red }}>none</span>}
                        </td>
                        <td style={{ padding: "10px 12px", verticalAlign: "top", fontSize: 11, color: c.ink, whiteSpace: "nowrap" }}>
                          {s.latest_data_date || "—"}
                        </td>
                        <td style={{ padding: "10px 12px", verticalAlign: "top" }}>
                          <FreshnessChip freshness={s.freshness} daysBehind={s.days_behind} />
                        </td>
                        <td style={{ padding: "10px 12px", verticalAlign: "top", minWidth: 180 }}>
                          {(s.alerts || []).length === 0 ? (
                            <span style={{ fontSize: 11, color: c.green, fontWeight: 600 }}>✓ consistent</span>
                          ) : (
                            <span onClick={() => setExpanded((p) => ({ ...p, [key]: !p[key] }))} style={{ fontSize: 11, fontWeight: 700, cursor: "pointer", color: errAlerts.length ? c.red : c.amber }}>
                              {errAlerts.length > 0 && `🚨 ${errAlerts.length} alert(s)`}
                              {errAlerts.length > 0 && warnAlerts.length > 0 && " · "}
                              {warnAlerts.length > 0 && `⚠️ ${warnAlerts.length} warning(s)`}
                              {" "}{isOpen ? "▲" : "▼"}
                            </span>
                          )}
                        </td>
                      </tr>
                      {isOpen && (s.alerts || []).length > 0 && (
                        <tr style={{ borderBottom: `1px solid #F1F3F6` }}>
                          <td colSpan={7} style={{ padding: "4px 12px 12px 12px", background: "#FCFCFD" }}>
                            {(s.alerts || []).map((a, i) => <AlertBadge key={i} alert={a} />)}
                            {s.fingerprint_captured_at && (
                              <div style={{ fontSize: 10, color: c.muted, marginTop: 6 }}>
                                Compared against setup saved {new Date(s.fingerprint_captured_at).toLocaleString()}. Re-saving the sheet config in Campaign Tracking updates the baseline.
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
