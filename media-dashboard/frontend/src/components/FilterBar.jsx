import React from "react";

const s = {
  bar: {
    background: "#fff",
    borderBottom: "1px solid #e0e0e0",
    padding: "10px 24px",
    display: "flex",
    flexWrap: "wrap",
    gap: 10,
    alignItems: "center",
  },
  label: { fontSize: 11, fontWeight: 600, color: "#888", textTransform: "uppercase", marginRight: 4 },
  select: {
    border: "1px solid #d1d5db",
    borderRadius: 5,
    padding: "5px 8px",
    fontSize: 13,
    color: "#222",
    background: "#fff",
    cursor: "pointer",
    minWidth: 130,
  },
  input: {
    border: "1px solid #d1d5db",
    borderRadius: 5,
    padding: "5px 8px",
    fontSize: 13,
    color: "#222",
    background: "#fff",
    width: 130,
  },
  clearBtn: {
    background: "#f3f4f6",
    border: "1px solid #d1d5db",
    borderRadius: 5,
    padding: "5px 12px",
    fontSize: 12,
    cursor: "pointer",
    color: "#555",
    fontWeight: 600,
  },
};

function FilterSelect({ label, options = [], value = [], onChange, placeholder }) {
  const selectedValue = Array.isArray(value) && value.length > 0 ? value[0] : "";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <span style={s.label}>{label}</span>
      <select
        value={selectedValue}
        style={s.select}
        onChange={(e) => onChange(e.target.value ? [e.target.value] : [])}
      >
        <option value="">{placeholder || `All ${label}`}</option>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
      {value.length > 0 && (
        <span
          style={{ fontSize: 11, color: "#2563eb", cursor: "pointer" }}
          onClick={() => onChange([])}
        >
          ({value.length} selected ✕)
        </span>
      )}
    </div>
  );
}

export default function FilterBar({ options = {}, filters = {}, onChange }) {
  const update = (key, val) => onChange({ ...filters, [key]: val });
  const updateMany = (changes) => onChange({ ...filters, ...changes });

  return (
    <div style={s.bar}>
      <FilterSelect
        label="Advertiser"
        options={options.advertisers || []}
        value={filters.advertiser || []}
        onChange={(v) => update("advertiser", v)}
      />
      <FilterSelect
        label="Publisher"
        options={options.publishers || []}
        value={filters.publisher || []}
        onChange={(v) => update("publisher", v)}
      />
      <FilterSelect
        label="Segment"
        options={options.segments || []}
        value={filters.segment || []}
        onChange={(v) => update("segment", v)}
      />

      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <span style={s.label}>Month</span>
        <input
          type="month"
          style={s.input}
          value={(filters.dateFrom || "").substring(0, 7)}
          onChange={(e) => {
            const v = e.target.value;
            if (v) {
              const [y, m] = v.split("-");
              const lastDay = new Date(parseInt(y), parseInt(m), 0).getDate();
              updateMany({ dateFrom: `${v}-01`, dateTo: `${v}-${lastDay}` });
            } else {
              updateMany({ dateFrom: "", dateTo: "" });
            }
          }}
        />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <span style={s.label}>From</span>
        <input
          type="date"
          style={s.input}
          value={filters.dateFrom || ""}
          onChange={(e) => update("dateFrom", e.target.value)}
        />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <span style={s.label}>To</span>
        <input
          type="date"
          style={s.input}
          value={filters.dateTo || ""}
          onChange={(e) => update("dateTo", e.target.value)}
        />
      </div>

      <button
        style={s.clearBtn}
        onClick={() => onChange({})}
      >
        Clear Filters
      </button>
    </div>
  );
}
