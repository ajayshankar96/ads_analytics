import React, { useState, useRef, useEffect } from "react";

const API_BASE = process.env.REACT_APP_API_URL || "";

async function sendMessage(message, history) {
  const res = await fetch(`${API_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Request failed");
  }
  return res.json();
}

const ALL_SUGGESTIONS = [
  "Which advertisers are not refreshed?",
  "When was data last updated?",
  "Which publishers have outdated data?",
  "What are the total impressions?",
  "Which advertiser has the highest spends?",
  "How many advertisers have both pub & adv data outdated?",
  "What is the overall CTR?",
  "Which publisher has the most impressions?",
  "How many advertisers are up to date?",
  "What is the total advertiser spend?",
];

function pickRandom(arr, n) {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

export default function ChatBot() {
  const [open, setOpen]         = useState(false);
  const [messages, setMessages] = useState([
    { role: "assistant", content: "Hi! I can answer questions about the dashboard data — freshness, metrics, advertiser/publisher status. What would you like to know?" }
  ]);
  const [input, setInput]       = useState("");
  const [loading, setLoading]   = useState(false);
  const [history, setHistory]   = useState([]);
  const [suggestions, setSuggestions] = useState(() => pickRandom(ALL_SUGGESTIONS, 4));
  const bottomRef               = useRef(null);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

  const send = async (text, fromChip = false) => {
    const msg = text || input.trim();
    if (!msg || loading) return;
    setInput("");
    // Refresh chips when one is clicked — exclude the one just used
    if (fromChip) {
      const pool = ALL_SUGGESTIONS.filter(s => s !== msg);
      setSuggestions(pickRandom(pool, 4));
    }

    const userMsg = { role: "user", content: msg };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    try {
      const { reply } = await sendMessage(msg, history);
      setMessages(prev => [...prev, { role: "assistant", content: reply }]);
      setHistory(prev => [...prev, { role: "user", content: msg }, { role: "assistant", content: reply }]);
    } catch (e) {
      setMessages(prev => [...prev, { role: "assistant", content: `⚠️ ${e.message}` }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(!open)}
        style={{
          position: "fixed", bottom: 24, right: 24, zIndex: 1000,
          width: 52, height: 52, borderRadius: "50%",
          background: "#0f2557", border: "none", cursor: "pointer",
          boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 22, color: "#fff",
          transition: "transform 0.2s",
        }}
        title="Ask about data"
      >
        {open ? "✕" : "💬"}
      </button>

      {/* Chat panel */}
      {open && (
        <div style={{
          position: "fixed", bottom: 88, right: 24, zIndex: 999,
          width: 360, height: 500,
          background: "#fff", borderRadius: 12,
          boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
          display: "flex", flexDirection: "column",
          border: "1px solid #e2e8f0", overflow: "hidden",
        }}>
          {/* Header */}
          <div style={{
            background: "#0f2557", padding: "12px 16px",
            display: "flex", alignItems: "center", gap: 10,
          }}>
            <div style={{ background: "rgba(255,255,255,0.15)", borderRadius: "50%", width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>
              🤖
            </div>
            <div>
              <div style={{ color: "#fff", fontWeight: 700, fontSize: 14 }}>Data Assistant</div>
              <div style={{ color: "rgba(255,255,255,0.65)", fontSize: 11 }}>Powered by Claude</div>
            </div>
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
            {messages.map((m, i) => (
              <div key={i} style={{
                display: "flex",
                justifyContent: m.role === "user" ? "flex-end" : "flex-start",
              }}>
                <div style={{
                  maxWidth: "82%",
                  padding: "8px 12px",
                  borderRadius: m.role === "user" ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
                  background: m.role === "user" ? "#0f2557" : "#f1f5f9",
                  color: m.role === "user" ? "#fff" : "#1e293b",
                  fontSize: 13,
                  lineHeight: 1.5,
                  whiteSpace: "pre-wrap",
                }}>
                  {m.content}
                </div>
              </div>
            ))}

            {loading && (
              <div style={{ display: "flex", justifyContent: "flex-start" }}>
                <div style={{ padding: "8px 14px", borderRadius: "12px 12px 12px 2px", background: "#f1f5f9", fontSize: 18 }}>
                  <span style={{ animation: "pulse 1s infinite" }}>●</span>
                  <span style={{ animation: "pulse 1s 0.2s infinite", marginLeft: 3 }}>●</span>
                  <span style={{ animation: "pulse 1s 0.4s infinite", marginLeft: 3 }}>●</span>
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Suggestion chips — always visible */}
          <div style={{
            borderTop: "1px solid #e2e8f0",
            padding: "8px 12px",
            display: "flex", flexWrap: "wrap", gap: 5,
            background: "#f8fafc",
          }}>
            {suggestions.map((s, i) => (
              <button
                key={i}
                onClick={() => send(s, true)}
                disabled={loading}
                style={{
                  padding: "4px 10px", borderRadius: 12,
                  border: "1px solid #cbd5e1",
                  background: loading ? "#f1f5f9" : "#fff",
                  cursor: loading ? "default" : "pointer",
                  fontSize: 11, color: "#475569",
                  transition: "background 0.15s",
                }}
              >
                {s}
              </button>
            ))}
          </div>

          {/* Input */}
          <div style={{ borderTop: "1px solid #e2e8f0", padding: "10px 12px", display: "flex", gap: 8 }}>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !e.shiftKey && send()}
              placeholder="Ask about the data…"
              disabled={loading}
              style={{
                flex: 1, border: "1px solid #e2e8f0", borderRadius: 20,
                padding: "7px 14px", fontSize: 13, outline: "none",
                background: loading ? "#f9fafb" : "#fff",
              }}
            />
            <button
              onClick={() => send()}
              disabled={!input.trim() || loading}
              style={{
                width: 34, height: 34, borderRadius: "50%",
                background: input.trim() && !loading ? "#0f2557" : "#e2e8f0",
                border: "none", cursor: input.trim() && !loading ? "pointer" : "default",
                color: "#fff", fontSize: 15, display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              ➤
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes pulse { 0%,100%{opacity:.3} 50%{opacity:1} }
      `}</style>
    </>
  );
}
