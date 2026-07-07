import React, { useState, useEffect } from "react";
import { listRoles, setUserRole, deleteUserRole } from "../api";

const c = { blue: "#2E5BFF", ink: "#0F1724", sub: "#52606D", line: "#E6EAF0", muted: "#768EA7", green: "#0F8C6A", red: "#C8321E", bg: "#F7F8FA" };

const ROLES = ["CREATOR", "ADMIN", "SALES", "OPS", "VIEWER"];
const ROLE_COLORS = { CREATOR: "#C026D3", ADMIN: "#7C3AED", SALES: "#2E5BFF", OPS: "#0F8C6A", VIEWER: "#768EA7" };
const ROLE_DESC = {
  CREATOR: "Full access — all edits, user access + DB query console",
  ADMIN: "All edits + user access (no DB query console)",
  SALES: "Edit Sales Pipeline + Budget Allocation",
  OPS: "Edit Campaign Ops + Campaign Tracking",
  VIEWER: "View everything, edit nothing",
};

const s = {
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 },
  title: { fontSize: 20, fontWeight: 800, color: c.ink },
  wrap: { background: "#fff", border: `1px solid ${c.line}`, borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 3px rgba(15,23,36,0.05)" },
  table: { width: "100%", borderCollapse: "collapse" },
  th: { textAlign: "left", fontSize: 11, fontWeight: 700, color: c.muted, textTransform: "uppercase", letterSpacing: ".04em", padding: "12px 16px", background: c.bg, borderBottom: `1px solid ${c.line}` },
  td: { padding: "12px 16px", fontSize: 13.5, color: c.ink, borderBottom: "1px solid #F1F5F9", verticalAlign: "middle" },
  badge: (role) => ({ display: "inline-block", fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 14, background: `${ROLE_COLORS[role]}15`, color: ROLE_COLORS[role] }),
  select: { border: `1px solid ${c.line}`, borderRadius: 6, padding: "6px 10px", fontSize: 12, outline: "none" },
  deleteBtn: { background: "none", border: "none", color: c.red, cursor: "pointer", fontSize: 12, fontWeight: 600 },
  addSection: { padding: "16px", borderTop: `1px solid ${c.line}`, background: c.bg, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" },
  input: { border: `1px solid ${c.line}`, borderRadius: 6, padding: "8px 12px", fontSize: 13, outline: "none", minWidth: 200 },
  addBtn: { background: c.blue, color: "#fff", border: "none", borderRadius: 6, padding: "8px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" },
  legend: { marginTop: 20, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 },
  legendCard: (role) => ({ border: `1px solid ${c.line}`, borderRadius: 8, padding: "10px 14px", borderLeft: `4px solid ${ROLE_COLORS[role]}` }),
  legendRole: { fontSize: 13, fontWeight: 700, color: c.ink },
  legendDesc: { fontSize: 12, color: c.muted, marginTop: 2 },
};

export default function RoleManager() {
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState("VIEWER");
  const [newName, setNewName] = useState("");

  const load = () => {
    setLoading(true);
    listRoles().then((d) => setRoles(d.roles || [])).catch(console.error).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const handleAdd = async () => {
    if (!newEmail.trim()) return;
    await setUserRole(newEmail.trim().toLowerCase(), newRole, newName.trim() || null);
    setNewEmail(""); setNewName("");
    load();
  };

  const handleChange = async (email, role) => {
    await setUserRole(email, role);
    load();
  };

  const handleDelete = async (email) => {
    if (!window.confirm(`Remove role for ${email}? They will become VIEWER.`)) return;
    await deleteUserRole(email);
    load();
  };

  if (loading) return <div style={{ textAlign: "center", padding: 40, color: "#888" }}>Loading roles…</div>;

  return (
    <div>
      <div style={s.header}>
        <div style={s.title}>User Roles</div>
      </div>

      <div style={s.wrap}>
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>Email</th>
              <th style={s.th}>Name</th>
              <th style={s.th}>Role</th>
              <th style={s.th}></th>
            </tr>
          </thead>
          <tbody>
            {roles.map((r) => (
              <tr key={r.email}>
                <td style={s.td}>{r.email}</td>
                <td style={{ ...s.td, color: c.muted }}>{r.name || "—"}</td>
                <td style={s.td}>
                  <select style={s.select} value={r.role} onChange={(e) => handleChange(r.email, e.target.value)}>
                    {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
                  </select>
                </td>
                <td style={s.td}>
                  <button style={s.deleteBtn} onClick={() => handleDelete(r.email)}>Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={s.addSection}>
          <input style={s.input} value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="Email address" />
          <input style={{ ...s.input, minWidth: 140 }} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Name (optional)" />
          <select style={s.select} value={newRole} onChange={(e) => setNewRole(e.target.value)}>
            {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
          </select>
          <button style={s.addBtn} onClick={handleAdd}>Add User</button>
        </div>
      </div>

      <div style={s.legend}>
        {ROLES.map((role) => (
          <div key={role} style={s.legendCard(role)}>
            <div style={s.legendRole}>{role}</div>
            <div style={s.legendDesc}>{ROLE_DESC[role]}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
