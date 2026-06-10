#!/usr/bin/env python3
"""
Re-generate the Media Dashboard OAuth token WITH Drive scope added.

Why: the deployed token only has the `spreadsheets` scope, so any Drive API
call (folders, file listing/appProperties, and auto-sharing reports with the
team) fails with 403. Adding `drive.file` unlocks all of that.

A refresh token can't gain new scopes — you must re-consent in a browser.
This script reuses the client_id/client_secret already in your current token,
so you don't need anything from Google Cloud Console.

─────────────────────────────────────────────────────────────────────────────
USAGE (run locally — it opens a browser):

  # 1. Pull the current token out of the k8s secret into a file
  kubectl get secret media-dashboard-secrets -n analytics-tools \
    --context dev-serve \
    -o jsonpath='{.data.OAUTH_TOKEN_JSON_CONTENT}' | base64 -d > current_token.json

  # 2. Install deps (if not already) and run this script
  pip install google-auth-oauthlib
  python3 generate_oauth_token.py current_token.json

  # → A browser opens. Pick the SAME Google account that owns the reports.
  #   Approve BOTH "See/edit your spreadsheets" AND "See/create/open files
  #   this app created in Drive". It writes new_oauth_token.json.

  # 3. Push the new token back into the secret
  kubectl patch secret media-dashboard-secrets -n analytics-tools \
    --context dev-serve --type=merge \
    -p "{\"data\":{\"OAUTH_TOKEN_JSON_CONTENT\":\"$(base64 -i new_oauth_token.json | tr -d '\n')\"}}"

  # 4. Tell Claude — it will re-apply the Drive code, redeploy, and migrate.
─────────────────────────────────────────────────────────────────────────────
"""

import json
import sys

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    # Full Drive scope (not drive.file): needed so the app can move + tag the
    # 45 pre-existing report spreadsheets that were created under the old
    # spreadsheets-only token. drive.file only covers files this app created
    # via the Drive API, so it can't touch those legacy files.
    "https://www.googleapis.com/auth/drive",
    # Gmail send: lets the app email campaign summaries from the authed account.
    "https://www.googleapis.com/auth/gmail.send",
]


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 generate_oauth_token.py <current_token.json>")
        sys.exit(1)

    with open(sys.argv[1]) as f:
        cur = json.load(f)

    client_id = cur.get("client_id")
    client_secret = cur.get("client_secret")
    if not client_id or not client_secret:
        print("ERROR: current token has no client_id/client_secret — cannot proceed.")
        sys.exit(1)

    from google_auth_oauthlib.flow import InstalledAppFlow

    client_config = {
        "installed": {
            "client_id": client_id,
            "client_secret": client_secret,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": cur.get("token_uri", "https://oauth2.googleapis.com/token"),
            "redirect_uris": ["http://localhost"],
        }
    }

    flow = InstalledAppFlow.from_client_config(client_config, SCOPES)
    # access_type=offline + prompt=consent guarantees a fresh refresh_token
    creds = flow.run_local_server(port=0, access_type="offline", prompt="consent")

    out = {
        "token": creds.token,
        "refresh_token": creds.refresh_token,
        "token_uri": creds.token_uri,
        "client_id": creds.client_id,
        "client_secret": creds.client_secret,
        "scopes": list(creds.scopes),
    }
    with open("new_oauth_token.json", "w") as f:
        json.dump(out, f, indent=2)

    print("\n✅ Wrote new_oauth_token.json")
    print("   Granted scopes:", out["scopes"])
    for required in ("drive", "gmail.send"):
        full = f"https://www.googleapis.com/auth/{required}"
        if full not in out["scopes"]:
            print(f"   ⚠️  Scope NOT granted: {full} — make sure you approved that permission.")


if __name__ == "__main__":
    main()
