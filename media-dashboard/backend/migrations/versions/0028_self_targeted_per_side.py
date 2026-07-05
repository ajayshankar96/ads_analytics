"""Split self_targeted into per-side flags.

A campaign can be self-targeted on one sheet but segment-filtered on the
other (e.g. the advertiser's own-user sheet has no segment column while the
publisher sheet does), so the single campaign-level boolean becomes
self_targeted_adv + self_targeted_pub.

Revision ID: 0028_self_targeted_per_side
Revises: 0027_sheet_health
"""
import sqlalchemy as sa
from alembic import op

revision = "0028_self_targeted_per_side"
down_revision = "0027_sheet_health"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("rmn_campaigns", sa.Column(
        "self_targeted_adv", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("rmn_campaigns", sa.Column(
        "self_targeted_pub", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.execute("UPDATE rmn_campaigns SET self_targeted_adv = self_targeted, "
               "self_targeted_pub = self_targeted")
    op.drop_column("rmn_campaigns", "self_targeted")


def downgrade() -> None:
    op.add_column("rmn_campaigns", sa.Column(
        "self_targeted", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.execute("UPDATE rmn_campaigns SET self_targeted = "
               "(self_targeted_adv OR self_targeted_pub)")
    op.drop_column("rmn_campaigns", "self_targeted_pub")
    op.drop_column("rmn_campaigns", "self_targeted_adv")
