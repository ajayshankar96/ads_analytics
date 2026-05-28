"""
TrustScan Analytics - Streamlit Version
Simple single-file app for querying Trino trust/credit data
"""

import streamlit as st
import trino
from trino.auth import BasicAuthentication
import pandas as pd
import os

# Page config
st.set_page_config(
    page_title="TrustScan Analytics",
    page_icon="🔍",
    layout="wide"
)

# Title
st.title("🔍 TrustScan Analytics")
st.markdown("Query trust and credit scoring data from Trino")

# Sidebar for Trino connection
with st.sidebar:
    st.header("⚙️ Configuration")
    trino_host = st.text_input("Trino Host", value=os.getenv("TRINO_HOST", "trino.razorpay.com"))
    trino_user = st.text_input("Username", value=os.getenv("TRINO_USER", ""))
    trino_password = st.text_input("Password", type="password", value=os.getenv("TRINO_PASSWORD", ""))

# Helper function to connect to Trino
@st.cache_resource
def get_trino_connection(host, user, password):
    auth = BasicAuthentication(user, password) if password else None
    return trino.dbapi.connect(
        host=host,
        port=443,
        user=user,
        http_scheme="https",
        auth=auth,
        catalog="hive",
        schema="aggregate_ba",
    )

# Helper function to run query
def run_query(query):
    try:
        conn = get_trino_connection(trino_host, trino_user, trino_password)
        df = pd.read_sql_query(query, conn)
        conn.close()
        return df
    except Exception as e:
        st.error(f"Query failed: {str(e)}")
        return None

# Tabs for different queries
tab1, tab2, tab3, tab4 = st.tabs(["📱 Trust Scan", "📊 Bands Scan", "📈 Batch Query", "💡 Impressions"])

# Tab 1: Trust Scan (Single Phone)
with tab1:
    st.header("Trust Scan - Single Phone Lookup")

    phone = st.text_input("Enter 10-digit phone number:", max_chars=10, key="trust_phone")

    if st.button("🔍 Search", key="trust_search"):
        if phone and len(phone) == 10 and phone.isdigit():
            with st.spinner("Querying Trino..."):
                # DPD Query
                dpd_query = f"""
                SELECT dpd30_band, dpd90_band,
                       dpd30_credit_score, dpd90_credit_score,
                       dpd30_default_probability, dpd90_default_probability,
                       date
                FROM hive.aggregate_ba.ts_dpd_predictions_ajay_9_april
                WHERE contact = '{phone}'
                ORDER BY date DESC
                LIMIT 1
                """
                dpd_df = run_query(dpd_query)

                # CD Query
                cd_query = f"""
                SELECT cd_band, predicted_income, predicted_income_bucket,
                       cd_credit_score, cd_default_probability, cohort, date
                FROM hive.aggregate_ba.ts_dpd_predictions_cd_income_20_april
                WHERE contact = '{phone}'
                ORDER BY date DESC
                LIMIT 1
                """
                cd_df = run_query(cd_query)

                # Display results
                col1, col2 = st.columns(2)

                with col1:
                    st.subheader("📉 DPD Predictions")
                    if dpd_df is not None and not dpd_df.empty:
                        st.metric("DPD 30 Band", dpd_df['dpd30_band'].iloc[0])
                        st.metric("DPD 90 Band", dpd_df['dpd90_band'].iloc[0])
                        st.metric("DPD 30 Score", f"{dpd_df['dpd30_credit_score'].iloc[0]:.2f}")
                        st.metric("DPD 90 Score", f"{dpd_df['dpd90_credit_score'].iloc[0]:.2f}")
                        st.metric("DPD 30 Probability", f"{dpd_df['dpd30_default_probability'].iloc[0] * 100:.1f}%")
                        st.metric("DPD 90 Probability", f"{dpd_df['dpd90_default_probability'].iloc[0] * 100:.1f}%")
                    else:
                        st.warning("No DPD data found")

                with col2:
                    st.subheader("💳 CD Predictions")
                    if cd_df is not None and not cd_df.empty:
                        st.metric("CD Band", cd_df['cd_band'].iloc[0])
                        st.metric("Predicted Income", f"₹{cd_df['predicted_income'].iloc[0]:,.0f}" if cd_df['predicted_income'].iloc[0] else "N/A")
                        st.metric("Income Bucket", cd_df['predicted_income_bucket'].iloc[0])
                        st.metric("CD Score", f"{cd_df['cd_credit_score'].iloc[0]:.2f}")
                        st.metric("CD Probability", f"{cd_df['cd_default_probability'].iloc[0] * 100:.1f}%")
                        st.metric("Cohort", cd_df['cohort'].iloc[0])
                    else:
                        st.warning("No CD data found")
        else:
            st.error("Please enter a valid 10-digit phone number")

# Tab 2: Bands Scan
with tab2:
    st.header("Bands Scan - Credit Bands Lookup")

    phone_bands = st.text_input("Enter 10-digit phone number:", max_chars=10, key="bands_phone")

    if st.button("🔍 Search", key="bands_search"):
        if phone_bands and len(phone_bands) == 10 and phone_bands.isdigit():
            with st.spinner("Querying Trino..."):
                query = f"""
                SELECT ts.dpd30_band, ts.dpd90_band, ts.cd_dpd30_band,
                       ts.predicted_income_bucket, ts.thick_thin_data,
                       ts.model_version, ts.part1_computed_at,
                       ts.dpd_30_prob_band, ts.dpd_90_prob_band, ts.cd_dpd_30_prob_band
                FROM hive.aggregate_ba.engage_trustscan_api_ready_variables ts
                JOIN hive.aggregate_ba.all_unique_contacts_trustscan uc
                  ON ts.main_contact = LOWER(uc.hashed_contact)
                WHERE uc.contact = '{phone_bands}'
                LIMIT 1
                """
                df = run_query(query)

                if df is not None and not df.empty:
                    col1, col2, col3 = st.columns(3)

                    with col1:
                        st.metric("DPD 30 Band", df['dpd30_band'].iloc[0])
                        st.metric("DPD 90 Band", df['dpd90_band'].iloc[0])
                        st.metric("CD Band", df['cd_dpd30_band'].iloc[0])

                    with col2:
                        st.metric("Income Bucket", df['predicted_income_bucket'].iloc[0])
                        st.metric("Data Type", df['thick_thin_data'].iloc[0])
                        st.metric("Model Version", df['model_version'].iloc[0])

                    with col3:
                        st.metric("DPD 30 Prob Band", df['dpd_30_prob_band'].iloc[0])
                        st.metric("DPD 90 Prob Band", df['dpd_90_prob_band'].iloc[0])
                        st.metric("CD Prob Band", df['cd_dpd_30_prob_band'].iloc[0])

                    st.info(f"Computed at: {df['part1_computed_at'].iloc[0]}")
                else:
                    st.warning("No data found for this phone number")
        else:
            st.error("Please enter a valid 10-digit phone number")

# Tab 3: Batch Query
with tab3:
    st.header("Batch Query - Multiple Phone Numbers")

    phones_input = st.text_area(
        "Enter phone numbers (one per line, max 500):",
        height=200,
        placeholder="9876543210\n9876543211\n9876543212"
    )

    if st.button("🔍 Batch Search", key="batch_search"):
        phones = [p.strip() for p in phones_input.split('\n') if p.strip() and p.strip().isdigit() and len(p.strip()) == 10]

        if not phones:
            st.error("No valid phone numbers found")
        elif len(phones) > 500:
            st.error("Maximum 500 phone numbers allowed")
        else:
            with st.spinner(f"Querying {len(phones)} phone numbers..."):
                in_clause = ",".join(f"'{p}'" for p in phones)

                query = f"""
                SELECT uc.contact, ts.dpd30_band, ts.dpd90_band, ts.cd_dpd30_band,
                       ts.predicted_income_bucket, ts.thick_thin_data
                FROM hive.aggregate_ba.engage_trustscan_api_ready_variables ts
                JOIN hive.aggregate_ba.all_unique_contacts_trustscan uc
                  ON ts.main_contact = LOWER(uc.hashed_contact)
                WHERE uc.contact IN ({in_clause})
                """

                df = run_query(query)

                if df is not None and not df.empty:
                    st.success(f"Found data for {len(df)} phone numbers")
                    st.dataframe(df, use_container_width=True)

                    # Download button
                    csv = df.to_csv(index=False)
                    st.download_button(
                        label="📥 Download CSV",
                        data=csv,
                        file_name="trustscan_batch_results.csv",
                        mime="text/csv"
                    )
                else:
                    st.warning("No data found")

# Tab 4: Impressions Query
with tab4:
    st.header("Offer Impressions Query")

    col1, col2 = st.columns(2)
    with col1:
        offer_id = st.text_input("Offer ID:", placeholder="offer_POIplYsUIs4RfK")
    with col2:
        query_date = st.date_input("Date:")

    if st.button("🔍 Query Impressions", key="impressions_search"):
        if offer_id and query_date:
            with st.spinner("Querying impressions..."):
                query = f"""
                SELECT SUM(impressions) as total_impressions
                FROM aggregate_ba.engage_bu_mid_level_impressions
                WHERE offer_id = '{offer_id}'
                AND producer_created_date = '{query_date}'
                """

                df = run_query(query)

                if df is not None and not df.empty and df['total_impressions'].iloc[0]:
                    st.metric(
                        "Total Impressions",
                        f"{df['total_impressions'].iloc[0]:,}",
                        delta=None
                    )
                else:
                    st.warning("No impressions found for this offer and date")
        else:
            st.error("Please provide both offer ID and date")

# Footer
st.markdown("---")
st.caption("TrustScan Analytics - Internal Razorpay Tool")
