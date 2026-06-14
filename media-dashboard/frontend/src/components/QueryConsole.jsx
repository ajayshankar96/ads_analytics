import React, { useState, useEffect } from "react";
import { listDbTables, runQuery } from "../api";

const c = { blue: "#2E5BFF", ink: "#0F1724", sub: "#52606D", line: "#E6EAF0", muted: "#768EA7", bg: "#F7F8FA" };

const s = {
  overlay: { position: "fixed", inset: 0, background: "rgba(15,23,36,0.45)", zIndex: 10050, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 },
  modal: { background: "#fff", borderRadius: 14, width: "100%", maxWidth: 1040, height: "85vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(15,23,36,0.3)", overflow: "hidden" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 20px", borderBottom: `1px solid ${c.line}` },
  title: { fontSize: 16, fontWeight: 800, color: c.ink, display: "flex", alignItems: "center", gap: 8 },
  badge: { fontSize: 11, fontWeight: 700, color: c.green || "#0F8C6A", background: "#E3F6EE", padding: "2px 8px", borderRadius: 20 },
  close: { width: 34, height: 34, borderRadius: 8, border: `1px solid ${c.line}`, background: "#fff", cursor: "pointer", fontSize: 16, color: c.muted },
  body: { display: "flex", flex: 1, minHeight: 0 },
  side: { width: 200, borderRight: `1px solid ${c.line}`, overflowY: "auto", padding: "12px 0", background: c.bg, flexShrink: 0 },
  sideHd: { fontSize: 11, fontWeight: 700, color: c.muted, textTransform: "uppercase", letterSpacing: ".05em", padding: "4px 16px 8px" },
  tbl: { padding: "7px 16px", fontSize: 13, color: c.ink, cursor: "pointer", fontFamily: "ui-monospace, monospace", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  main: { flex: 1, display: "flex", flexDirection: "column", minWidth: 0 },
  editor: { padding: 14, borderBottom: `1px solid ${c.line}` },
  textarea: { width: "100%", minHeight: 96, border: `1px solid ${c.line}`, borderRadius: 8, padding: "10px 12px", fontSize: 13, fontFamily: "ui-monospace, monospace", color: c.ink, outline: "none", resize: "vertical" },
  bar: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 },
  run: { background: c.blue, color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer" },
  hint: { fontSize: 12, color: c.muted },
  results: { flex: 1, overflow: "auto", padding: "0" },
  err: { margin: 14, padding: "10px 14px", background: "#FDECE9", color: "#C8321E", borderRadius: 8, fontSize: 13, fontFamily: "ui-monospace, monospace", whiteSpace: "pre-wrap" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 12.5 },
  th: { position: "sticky", top: 0, textAlign: "left", padding: "9px 12px", background: "#EEF2F9", color: c.ink, fontWeight: 700, borderBottom: `1px solid ${c.line}`, whiteSpace: "nowrap", fontFamily: "ui-monospace, monospace" },
  td: { padding: "8px 12px", borderBottom: `1px solid #F1F5F9`, color: c.ink, whiteSpace: "nowrap", fontFamily: "ui-monospace, monospace", maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis" },
  foot: { padding: "8px 16px", borderTop: `1px solid ${c.line}`, fontSize: 12, color: c.muted },
  empty: { padding: 40, textAlign: "center", color: c.muted, fontSize: 13 },
};

export default function QueryConsole({ onClose }) {
  const [tables, setTables] = useState([]);
  const [sql, setSql] = useState("SELECT * FROM rmn_advertisers ORDER BY created_at DESC LIMIT 100;");
  const [res, setRes] = useState(null);
  const [err, setErr] = useState("");
  const [running, setRunning] = useState(false);

  useEffect(() => { listDbTables().then((d) => setTables(d.tables || [])).catch(() => {}); }, []);

  const run = async (q) => {
    const query = q !== undefined ? q : sql;
    setRunning(true); setErr(""); setRes(null);
    try {
      const d = await runQuery(query);
      setRes(d);
    } catch (e) {
      setErr(e.message);
    } finally {
      setRunning(false);
    }
  };

  const pickTable = (t) => { const q = `SELECT * FROM ${t} LIMIT 100;`; setSql(q); run(q); };
  const onKey = (e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") run(); };

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={(e) => e.stopPropagation()}>
        <div style={s.header}>
          <div style={s.title}>🛢️ Query console <span style={s.badge}>READ-ONLY</span></div>
          <button style={s.close} onClick={onClose}>✕</button>
        </div>
        <div style={s.body}>
          <div style={s.side}>
            <div style={s.sideHd}>Tables</div>
            {tables.map((t) => <div key={t} style={s.tbl} title={t} onClick={() => pickTable(t)}>{t}</div>)}
          </div>
          <div style={s.main}>
            <div style={s.editor}>
              <textarea style={s.textarea} value={sql} onChange={(e) => setSql(e.target.value)} onKeyDown={onKey}
                placeholder="SELECT … (SELECT/WITH only)" spellCheck={false} />
              <div style={s.bar}>
                <span style={s.hint}>SELECT / WITH only · max 1,000 rows · ⌘/Ctrl+Enter to run</span>
                <button style={s.run} onClick={() => run()} disabled={running}>{running ? "Running…" : "Run ▶"}</button>
              </div>
            </div>
            <div style={s.results}>
              {err && <div style={s.err}>{err}</div>}
              {res && !err && (
                res.rows.length === 0 ? (
                  <div style={s.empty}>No rows.</div>
                ) : (
                  <table style={s.table}>
                    <thead><tr>{res.columns.map((col) => <th key={col} style={s.th}>{col}</th>)}</tr></thead>
                    <tbody>
                      {res.rows.map((row, i) => (
                        <tr key={i}>{row.map((cell, j) => <td key={j} style={s.td} title={cell === null ? "NULL" : String(cell)}>{cell === null ? <span style={{ color: "#B0B8C4" }}>NULL</span> : String(cell)}</td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                )
              )}
              {!res && !err && <div style={s.empty}>Pick a table on the left or write a query, then Run.</div>}
            </div>
            {res && !err && <div style={s.foot}>{res.row_count} row{res.row_count === 1 ? "" : "s"}{res.truncated ? " (capped at 1,000)" : ""}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
