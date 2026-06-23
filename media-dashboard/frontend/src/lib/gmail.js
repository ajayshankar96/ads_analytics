// Client-side Google Sign-In + Gmail send, shared by Campaign Onboarding and
// the Sales Pipeline welcome-email step. The user signs in in the browser and
// the email is sent from their own Gmail — no token ever reaches the server.
import { useState, useEffect } from "react";

// GCP OAuth *Web application* client ID. While empty, callers should fall back
// to the server-side sender.
export const GOOGLE_WEB_CLIENT_ID =
  "38441679546-r2kloe55sdg1gsv334ohf36kqsf88t28.apps.googleusercontent.com";

// Loads the Google Identity Services script once; returns true when ready.
export function useGisLoaded() {
  const [loaded, setLoaded] = useState(
    typeof window !== "undefined" && !!window.google?.accounts?.oauth2
  );
  useEffect(() => {
    if (!GOOGLE_WEB_CLIENT_ID) return;
    if (window.google?.accounts?.oauth2) { setLoaded(true); return; }
    if (document.getElementById("gis-client")) return;
    const sc = document.createElement("script");
    sc.src = "https://accounts.google.com/gsi/client";
    sc.id = "gis-client"; sc.async = true; sc.defer = true;
    sc.onload = () => setLoaded(true);
    document.body.appendChild(sc);
  }, []);
  return loaded;
}

// Opens the Google consent/picker popup and resolves with a gmail.send + readonly token.
export function getGmailAccessToken() {
  return new Promise((resolve, reject) => {
    if (!window.google?.accounts?.oauth2) return reject(new Error("Google Sign-In not loaded yet."));
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_WEB_CLIENT_ID,
      scope: "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly",
      callback: (resp) => resp.error ? reject(new Error(resp.error)) : resolve(resp.access_token),
    });
    client.requestAccessToken();
  });
}

// Fetches the latest message's Message-ID header from a Gmail thread.
// Returns null if the thread can't be read.
export async function getLatestMessageId(token, threadId) {
  if (!threadId) return null;
  try {
    const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=metadata&metadataHeaders=Message-Id`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const messages = data.messages || [];
    if (!messages.length) return null;
    const lastMsg = messages[messages.length - 1];
    const headers = lastMsg.payload?.headers || [];
    const msgIdHeader = headers.find((h) => h.name.toLowerCase() === "message-id");
    return msgIdHeader?.value || null;
  } catch {
    return null;
  }
}

// UTF-8 safe base64 (handles ₹ etc.)
export function utf8ToBase64(str) {
  return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, p) => String.fromCharCode("0x" + p)));
}

// Sends an HTML email via the Gmail API as the signed-in user ("me").
// If threadId is provided, the email is sent as a reply on that thread.
// If inReplyTo is provided, adds In-Reply-To and References headers for threading.
export async function sendViaGmail(token, { to, cc, subject, html, threadId, inReplyTo }) {
  const headerLines = [
    `To: ${to.join(", ")}`,
    cc && cc.length ? `Cc: ${cc.join(", ")}` : null,
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=UTF-8",
    `Subject: =?UTF-8?B?${utf8ToBase64(subject)}?=`,
    inReplyTo ? `In-Reply-To: ${inReplyTo}` : null,
    inReplyTo ? `References: ${inReplyTo}` : null,
  ].filter((l) => l != null);
  // A single blank line MUST separate headers from the body (RFC 822/MIME).
  const message = headerLines.join("\r\n") + "\r\n\r\n" + html;
  const raw = utf8ToBase64(message).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const body = { raw };
  if (threadId) body.threadId = threadId;
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Gmail API error ${res.status}`);
  }
  return res.json();
}

// Escapes text and converts newlines to <br> so a plain-text draft renders as
// HTML with its line breaks preserved.
export function textToHtml(text) {
  const esc = String(text || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:14px;color:#1e293b;line-height:1.5">${esc.replace(/\n/g, "<br>")}</div>`;
}
