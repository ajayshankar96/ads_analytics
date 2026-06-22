"""add rmn_sheet_urls table for advertiser/publisher sheet URL mapping

Revision ID: 0012_sheet_urls
Revises: 0011_campaign_metrics
Create Date: 2026-06-22

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0012_sheet_urls"
down_revision: Union[str, None] = "0011_campaign_metrics"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "rmn_sheet_urls",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("type", sa.String(16), nullable=False),  # 'advertiser' or 'publisher'
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_rmn_sheet_urls_type_name", "rmn_sheet_urls", ["type", "name"])

    # Seed with known URLs
    sheet_urls = sa.table(
        "rmn_sheet_urls",
        sa.column("type", sa.String),
        sa.column("name", sa.String),
        sa.column("url", sa.Text),
    )
    op.bulk_insert(sheet_urls, [
        # Publishers
        {"type": "publisher", "name": "Navi", "url": "https://docs.google.com/spreadsheets/d/1CnQPn0YLvnxy4pj5QA74GUL2f8-p0bQHuoCS1ZO4kuw"},
        {"type": "publisher", "name": "Flipkart", "url": "https://docs.google.com/spreadsheets/d/1kTgaHG_fTHLSkZG2b-EPoWF4drNmZLswaBv9isqtFbc"},
        {"type": "publisher", "name": "Fampay", "url": "https://docs.google.com/spreadsheets/d/1_EYRWikyjXJJEyl3dtZNnNjy0-c_q-DH7Z58krpUtCA"},
        {"type": "publisher", "name": "Zepto", "url": "https://docs.google.com/spreadsheets/d/1s6CFKAVy5ZeW3hEwzrSD17ignu-ucadZsBdBlk71q0c"},
        {"type": "publisher", "name": "Amazon", "url": "https://docs.google.com/spreadsheets/d/1eysu5Spx1UfDtnkExqnL2B1oZfEsy-hZGgmyFNsioCA"},
        # Advertisers
        {"type": "advertiser", "name": "Boat", "url": "https://docs.google.com/spreadsheets/d/16gwfUDExQnqB1KjtsS8Hfkvq1Jf1-Q_kP62dAkgsHAw"},
        {"type": "advertiser", "name": "Mamaearth", "url": "https://docs.google.com/spreadsheets/d/1zRqoscSMnFGLWAgpJJYrtACyT70J-n5mP_pdciCMYR8"},
        {"type": "advertiser", "name": "The Derma Co.", "url": "https://docs.google.com/spreadsheets/d/1zRqoscSMnFGLWAgpJJYrtACyT70J-n5mP_pdciCMYR8"},
        {"type": "advertiser", "name": "Honasa", "url": "https://docs.google.com/spreadsheets/d/1zRqoscSMnFGLWAgpJJYrtACyT70J-n5mP_pdciCMYR8"},
        {"type": "advertiser", "name": "Lenskart", "url": "https://docs.google.com/spreadsheets/d/1PiJzU4XWl7TIpzZ6fIGmT4MVTtEXl2TyCGDQEYveVcs"},
        {"type": "advertiser", "name": "GIVA", "url": "https://docs.google.com/spreadsheets/d/1BZyYarvkNYOCqxgm8s13SG4_ZKzOdKfD9XyOQsDWucU"},
        {"type": "advertiser", "name": "mCaffeine", "url": "https://docs.google.com/spreadsheets/d/1dVYcon1TTS1HXkn_iDqUn-CY38gIi4eeewGbsqFbK0M"},
        {"type": "advertiser", "name": "Hyphen", "url": "https://docs.google.com/spreadsheets/d/1dVYcon1TTS1HXkn_iDqUn-CY38gIi4eeewGbsqFbK0M"},
        {"type": "advertiser", "name": "Zoomin", "url": "https://docs.google.com/spreadsheets/d/1QHn268PKFzmt7BsULaGSFfXw81KUEmfbywhI97HPhc4"},
        {"type": "advertiser", "name": "Dot&Key", "url": "https://docs.google.com/spreadsheets/d/1jeWeNSI5t9wPaKA4jSRT9KSJHN-tOEogll3cfONSdFw"},
        {"type": "advertiser", "name": "Kimti", "url": "https://docs.google.com/spreadsheets/d/1aEvA34VpkLwiyV7a_CGguPw4LM4KxaH3"},
        {"type": "advertiser", "name": "Snitch", "url": "https://docs.google.com/spreadsheets/d/1XybY6yyPCtixYzpvA4SchY-iviu8V-Jmr-7YQha0g5o"},
        {"type": "advertiser", "name": "Big Basket", "url": "https://docs.google.com/spreadsheets/d/1f3UYh3O2b1Qr0faWGsGf4nMLkZHxZOuvkJnSdw4lQTo"},
        {"type": "advertiser", "name": "Galderma", "url": "https://docs.google.com/spreadsheets/d/1mlvAK23BUImXkDvfVOlZY7ubaR8h6f3fTVRo7sbFlv4"},
        {"type": "advertiser", "name": "Palmonas", "url": "https://docs.google.com/spreadsheets/d/1jVxwFuPxGSP4uwx8cLgUar_AQX9tN98lnVH4vKd52Fk"},
        {"type": "advertiser", "name": "TIRA Beauty", "url": "https://docs.google.com/spreadsheets/d/17OjyVNL1EHC6hHxdb-DG2t1pvHzogBK_HwQEg9zl1H4"},
        {"type": "advertiser", "name": "Ixigo", "url": "https://docs.google.com/spreadsheets/d/1hyi-GHkcQ9SPoKUC5hQfcNUmR-iZ69uxOSHRnL30C38"},
        {"type": "advertiser", "name": "Aries One", "url": "https://docs.google.com/spreadsheets/d/14UdXm3uVcH83yEtp5ydKNqY6YufgQlKZ_lHIT5UF5Ag"},
        {"type": "advertiser", "name": "Renee", "url": "https://docs.google.com/spreadsheets/d/1HWlaPQazgMNUWk1ppx3Xd-plPgy_3MAWVHcv-2xA8PA"},
        {"type": "advertiser", "name": "Kapiva", "url": "https://docs.google.com/spreadsheets/d/1iCVzzectKC9SutUyLX3wcwyWFqoGOKAUbQ_SbudMRaA"},
        {"type": "advertiser", "name": "Sanfe", "url": "https://docs.google.com/spreadsheets/d/1T5ERprhsIMR3QtOnp7pgn5ZR0Sakbbb6i2s-sZuoqTU"},
        {"type": "advertiser", "name": "Clay Co.", "url": "https://docs.google.com/spreadsheets/d/1E26hh1eHrGxDmdwIKoLzz2Rwg9gImrhr94JuHsjzclw"},
        {"type": "advertiser", "name": "Ditto", "url": "https://docs.google.com/spreadsheets/d/1qjxNSQVndLhiFggIXWP-DQbn7Qk-hcZRVR8UaBRhTwE"},
        {"type": "advertiser", "name": "Amli Savings", "url": "https://docs.google.com/spreadsheets/d/13weHhrwkt-WyuMOIk8KYh7j5rSGt-CYbsTlKx9M9PjU"},
        {"type": "advertiser", "name": "Axis Maxlife", "url": "https://docs.google.com/spreadsheets/d/13weHhrwkt-WyuMOIk8KYh7j5rSGt-CYbsTlKx9M9PjU"},
        {"type": "advertiser", "name": "Kiwi", "url": "https://docs.google.com/spreadsheets/d/1bkjjljFJyA_9O2a5LAKPvAyslYhPDvxJy8tBjBDMaMU"},
        {"type": "advertiser", "name": "Airtel Personal Loan", "url": "https://docs.google.com/spreadsheets/d/1fOXodEeuVTso48Xzt_1JDaChzm_2OJwo"},
        {"type": "advertiser", "name": "Estuary World", "url": "https://docs.google.com/spreadsheets/d/1RSI38Io9vuTGMFMkzbqeGsN01GzKGYsD"},
    ])


def downgrade() -> None:
    op.drop_table("rmn_sheet_urls")
