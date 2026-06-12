"""
Pure workflow logic for the RMN Sales + Campaign-Ops lifecycle: enums, id/time
helpers, and the campaign stage machine. No I/O here — persistence lives in
`workflow_repo` (Postgres) and HTTP wiring in `main.py`.
"""

import uuid
from datetime import datetime, timezone
from typing import List, Optional

# ── Sales enums ───────────────────────────────────────────────────────────────
NEGOTIATION_STATUSES = ["NEW", "NEGOTIATING", "WON", "LOST"]
BUY_TYPES = ["CPM", "CPC", "CPA", "ROAS_COMMIT"]
AGREEMENT_STATUSES = ["DRAFT", "SIGNED", "CANCELLED"]


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ── Campaign stage machine (Dashboard 2) ─────────────────────────────────────
# Mirrors the process doc's Ops milestones. A campaign is created at OPS_SETUP
# from a signed agreement.
STAGE_OPS_SETUP          = "OPS_SETUP"
STAGE_ASSETS_RECEIVED    = "ASSETS_RECEIVED"
STAGE_SHARED_TO_PUBLISHER = "SHARED_TO_PUBLISHER"
STAGE_CREATIVE_REVIEW    = "CREATIVE_REVIEW"
STAGE_LIVE               = "LIVE"
STAGE_COMPLETED          = "COMPLETED"
STAGE_CANCELLED          = "CANCELLED"

OPS_STAGES = [
    STAGE_OPS_SETUP,
    STAGE_ASSETS_RECEIVED,
    STAGE_SHARED_TO_PUBLISHER,
    STAGE_CREATIVE_REVIEW,
    STAGE_LIVE,
    STAGE_COMPLETED,
]

_FORWARD = {
    STAGE_OPS_SETUP:           [STAGE_ASSETS_RECEIVED],
    STAGE_ASSETS_RECEIVED:     [STAGE_SHARED_TO_PUBLISHER],
    STAGE_SHARED_TO_PUBLISHER: [STAGE_CREATIVE_REVIEW],
    STAGE_CREATIVE_REVIEW:     [STAGE_LIVE],
    STAGE_LIVE:                [STAGE_COMPLETED],
    STAGE_COMPLETED:           [],
    STAGE_CANCELLED:           [],
}

# Reaching these stages triggers a hand-off notification, addressed to:
HANDOFF_ON = {
    STAGE_SHARED_TO_PUBLISHER: "PUBLISHER",
    STAGE_LIVE:                "CAMPAIGN_MGMT",
}

STAGE_LABELS = {
    STAGE_OPS_SETUP:           "Ops Setup",
    STAGE_ASSETS_RECEIVED:     "Assets Received",
    STAGE_SHARED_TO_PUBLISHER: "Shared to Publisher",
    STAGE_CREATIVE_REVIEW:     "Creative Review",
    STAGE_LIVE:                "Live",
    STAGE_COMPLETED:           "Completed",
    STAGE_CANCELLED:           "Cancelled",
}

# Ops checklist seeded when a campaign is created (Dashboard 2 milestones).
OPS_STEPS = ["RECEIVE_ASSETS", "SHARED_TO_PUBLISHER", "CREATIVE_REVIEW", "GO_LIVE"]
TASK_STATUSES = ["PENDING", "IN_PROGRESS", "DONE", "BLOCKED"]


def normalize_stage(raw: str) -> str:
    s = (raw or "").strip().upper().replace(" ", "_")
    return s or STAGE_OPS_SETUP


def allowed_transitions(from_stage: str) -> List[str]:
    cur = normalize_stage(from_stage)
    nxt = list(_FORWARD.get(cur, []))
    if cur not in (STAGE_COMPLETED, STAGE_CANCELLED):
        nxt.append(STAGE_CANCELLED)
    return nxt


def validate_transition(from_stage: str, to_stage: str) -> Optional[str]:
    """Return None if legal, else an error message."""
    to_norm = normalize_stage(to_stage)
    if to_norm not in OPS_STAGES + [STAGE_CANCELLED]:
        return f"unknown stage {to_stage!r}"
    if to_norm not in allowed_transitions(from_stage):
        return f"illegal transition {normalize_stage(from_stage)} -> {to_norm}"
    return None
