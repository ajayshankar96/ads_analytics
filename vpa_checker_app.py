import streamlit as st
import pandas as pd
import trino
from trino.auth import BasicAuthentication
from datetime import datetime
import io
import tempfile

# Page configuration
st.set_page_config(
    page_title="VPA Ecosystem Checker",
    page_icon="💳",
    layout="wide"
)

# Library mapping
LIBRARY_MAPPING = {
    1: 'Standard checkout',
    2: 'CUSTOM',
    3: 'S2S',
    4: 'CUSTOM',
    5: 'DIRECT',
    6: 'PUSH',
    7: 'LEGACYJS',
    8: 'Standard checkout',
    9: 'EMBEDDED'
}

def get_trino_connection(user_email=None, user_password=None):
    """Create and return Trino connection"""
    try:
        # Use user-provided credentials if available, otherwise fall back to secrets
        if user_email and user_password:
            host = st.secrets.get("trino_host", "trino-gateway-router-looker.de.razorpay.com")
            port = st.secrets.get("trino_port", 443)
            user = user_email
            password = user_password
        else:
            host = st.secrets.get("trino_host", "localhost")
            port = st.secrets.get("trino_port", 8080)
            user = st.secrets.get("trino_user", "admin")
            password = st.secrets.get("trino_password")

        # Prepare connection parameters
        conn_params = {
            "host": host,
            "port": port,
            "user": user,
            "catalog": st.secrets.get("trino_catalog", "hive"),
        }

        # Add HTTPS for port 443
        if conn_params["port"] == 443:
            conn_params["http_scheme"] = "https"

        # Add LDAP authentication if password is provided
        if password:
            conn_params["auth"] = BasicAuthentication(user, password)

        conn = trino.dbapi.connect(**conn_params)
        return conn
    except Exception as e:
        st.error(f"Failed to connect to Trino: {str(e)}")
        return None

def create_vpa_values_clause(vpas):
    """Create a VALUES clause for VPAs to use in CTE"""
    # Escape single quotes and create VALUES clause
    values = ", ".join([f"('{vpa.replace(chr(39), chr(39)+chr(39))}')" for vpa in vpas])
    return f"VALUES {values}"


def execute_vpa_query(conn, vpa_values_clause, start_date):
    """Execute the VPA ecosystem check query using CTE"""
    query = f"""
    WITH vpa_list (vpa) AS (
        {vpa_values_clause}
    ),
    merch_vpa AS (
        SELECT
            merchant_id,
            mt.vpa,
            terminal_id
        FROM aggregate_pa.dim_merchant_terminal mt
        JOIN vpa_list vpa
            ON mt.vpa = vpa.vpa
        WHERE
            enabled = 1
            AND status = 'activated'
    )
    SELECT
        p.merchant_id,
        mvpa.vpa,
        p.terminal_id,
        name,
        website,
        category,
        category2,
        library,
        COUNT(DISTINCT p.id) AS transaction_count
    FROM realtime_hudi_api.payments p
    JOIN realtime_hudi_api.payment_analytics pa ON p.id = pa.payment_id
    JOIN merch_vpa mvpa ON p.terminal_id = mvpa.terminal_id
    JOIN realtime_hudi_api.merchants mcc ON p.merchant_id = mcc.id
    WHERE p.created_date >= '{start_date}'
        AND pa.created_date >= '{start_date}'
        AND mcc.created_date IS NOT NULL
        AND authorized_at IS NOT NULL
    GROUP BY 1, 2, 3, 4, 5, 6, 7, 8
    """

    cursor = conn.cursor()
    cursor.execute(query)
    columns = [desc[0] for desc in cursor.description]
    results = cursor.fetchall()
    cursor.close()

    return pd.DataFrame(results, columns=columns)

def parse_vpas_from_file(uploaded_file):
    """Parse VPAs from uploaded file"""
    try:
        content = uploaded_file.read().decode('utf-8')
        # Filter out empty lines and comments (lines starting with #)
        vpas = [
            line.strip()
            for line in content.split('\n')
            if line.strip() and not line.strip().startswith('#')
        ]
        return vpas
    except Exception as e:
        st.error(f"Error reading file: {str(e)}")
        return []

def get_library_summary(df):
    """Generate summary statistics by library"""
    if df.empty:
        return pd.DataFrame()

    # Map library codes to names
    df['library_name'] = df['library'].map(LIBRARY_MAPPING)

    # Group by library
    summary = df.groupby('library_name').agg({
        'transaction_count': 'sum',
        'vpa': 'nunique',
        'merchant_id': 'nunique'
    }).reset_index()

    summary.columns = ['Library', 'Total Transactions', 'Unique VPAs', 'Unique Merchants']
    summary = summary.sort_values('Total Transactions', ascending=False)

    return summary

def prepare_detailed_export(df):
    """Prepare detailed DataFrame for CSV export"""
    export_df = df.copy()
    export_df['library_name'] = export_df['library'].map(LIBRARY_MAPPING)

    # Reorder columns
    columns_order = [
        'vpa', 'merchant_id', 'terminal_id', 'name', 'website',
        'category', 'category2', 'library', 'library_name', 'transaction_count'
    ]
    export_df = export_df[columns_order]

    return export_df

# Main app
st.title("💳 VPA Ecosystem Checker")
st.markdown("Check if merchant VPAs are part of the Razorpay ecosystem based on transaction data")

# Initialize session state
if 'authenticated' not in st.session_state:
    st.session_state.authenticated = False
if 'user_email' not in st.session_state:
    st.session_state.user_email = ""
if 'user_password' not in st.session_state:
    st.session_state.user_password = ""

# Sidebar for inputs
with st.sidebar:
    st.header("Configuration")

    # Authentication section
    with st.expander("🔐 Database Credentials", expanded=not st.session_state.authenticated):
        st.markdown("**Trino Database Login**")
        user_email = st.text_input(
            "Email",
            value=st.session_state.user_email,
            placeholder="your.name@razorpay.com",
            help="Your Razorpay email address"
        )
        user_password = st.text_input(
            "Password",
            type="password",
            value=st.session_state.user_password,
            help="Your Trino database password"
        )

        if st.button("Connect", type="primary", use_container_width=True):
            if user_email and user_password:
                with st.spinner("Testing connection..."):
                    test_conn = get_trino_connection(user_email, user_password)
                    if test_conn:
                        st.session_state.authenticated = True
                        st.session_state.user_email = user_email
                        st.session_state.user_password = user_password
                        test_conn.close()
                        st.success("✅ Connected successfully!")
                        st.rerun()
                    else:
                        st.session_state.authenticated = False
            else:
                st.error("Please enter both email and password")

        if st.session_state.authenticated:
            st.success(f"✅ Connected as: {st.session_state.user_email}")
            if st.button("Disconnect", use_container_width=True):
                st.session_state.authenticated = False
                st.session_state.user_email = ""
                st.session_state.user_password = ""
                st.rerun()

    st.divider()

    # Date range
    start_date = st.date_input(
        "Start Date",
        value=pd.to_datetime("2025-11-01"),
        help="Filter transactions from this date onwards"
    )

    st.divider()

    # Input method selection
    input_method = st.radio(
        "Select Input Method",
        ["Upload File", "Manual Entry"]
    )

    vpas = []

    if input_method == "Upload File":
        st.markdown("**Upload VPA List**")
        uploaded_file = st.file_uploader(
            "Choose a file (CSV or TXT)",
            type=['csv', 'txt'],
            help="One VPA per line"
        )

        if uploaded_file:
            vpas = parse_vpas_from_file(uploaded_file)
            st.success(f"Loaded {len(vpas)} VPAs")

    else:
        st.markdown("**Enter VPAs manually**")
        vpa_input = st.text_area(
            "Enter VPAs (one per line)",
            height=200,
            placeholder="example@paytm\nanother@upi\n..."
        )

        if vpa_input:
            vpas = [line.strip() for line in vpa_input.split('\n') if line.strip()]
            st.info(f"{len(vpas)} VPAs entered")

    st.divider()

    check_button = st.button("🔍 Check VPAs", type="primary", use_container_width=True)

# Main content area
if check_button:
    if not st.session_state.authenticated:
        st.error("⚠️ Please connect to the database first using your credentials in the sidebar")
    elif not vpas:
        st.error("Please provide at least one VPA")
    else:
        with st.spinner("Connecting to database..."):
            conn = get_trino_connection(
                st.session_state.user_email,
                st.session_state.user_password
            )

        if conn:
            try:
                # Create VALUES clause for VPAs
                with st.spinner(f"Preparing query with {len(vpas)} VPAs..."):
                    vpa_values = create_vpa_values_clause(vpas)

                # Execute query
                with st.spinner("Executing query and fetching results..."):
                    results_df = execute_vpa_query(conn, vpa_values, start_date.strftime('%Y-%m-%d'))

                conn.close()

                # Display results
                if results_df.empty:
                    st.warning("No transactions found for the provided VPAs in the specified date range")
                else:
                    # Summary Statistics
                    st.header("📊 Summary by Library")
                    summary_df = get_library_summary(results_df)

                    # Display metrics
                    col1, col2, col3 = st.columns(3)
                    with col1:
                        st.metric("Total VPAs with Transactions", results_df['vpa'].nunique())
                    with col2:
                        st.metric("Total Merchants", results_df['merchant_id'].nunique())
                    with col3:
                        st.metric("Total Transactions", int(results_df['transaction_count'].sum()))

                    # Summary table
                    st.dataframe(
                        summary_df,
                        use_container_width=True,
                        hide_index=True
                    )

                    st.divider()

                    # Detailed Results
                    st.header("📋 Detailed Results")

                    # Add library name for display
                    display_df = results_df.copy()
                    display_df['library_name'] = display_df['library'].map(LIBRARY_MAPPING)

                    st.dataframe(
                        display_df,
                        use_container_width=True,
                        hide_index=True
                    )

                    # Export functionality
                    st.divider()
                    st.header("💾 Export Data")

                    col1, col2 = st.columns(2)

                    with col1:
                        # Export detailed results
                        export_df = prepare_detailed_export(results_df)
                        csv_buffer = io.StringIO()
                        export_df.to_csv(csv_buffer, index=False)

                        st.download_button(
                            label="📥 Download Detailed Results (CSV)",
                            data=csv_buffer.getvalue(),
                            file_name=f"vpa_detailed_results_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv",
                            mime="text/csv",
                            use_container_width=True
                        )

                    with col2:
                        # Export summary
                        summary_csv_buffer = io.StringIO()
                        summary_df.to_csv(summary_csv_buffer, index=False)

                        st.download_button(
                            label="📥 Download Summary (CSV)",
                            data=summary_csv_buffer.getvalue(),
                            file_name=f"vpa_summary_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv",
                            mime="text/csv",
                            use_container_width=True
                        )

                    # Show VPAs without transactions
                    vpas_with_txn = set(results_df['vpa'].unique())
                    vpas_without_txn = set(vpas) - vpas_with_txn

                    if vpas_without_txn:
                        with st.expander(f"⚠️ VPAs without transactions ({len(vpas_without_txn)})"):
                            st.write(list(vpas_without_txn))

            except Exception as e:
                st.error(f"Error executing query: {str(e)}")
                try:
                    conn.close()
                except:
                    pass
        else:
            st.error("Could not establish database connection")
else:
    # Show instructions when no query is running
    st.info("👈 Configure your search in the sidebar and click 'Check VPAs' to begin")

    st.markdown("""
    ### How to use:

    1. **Select start date** - Transactions will be filtered from this date onwards
    2. **Choose input method**:
       - **Upload File**: Upload a CSV or TXT file with one VPA per line
       - **Manual Entry**: Type or paste VPAs directly (one per line)
    3. **Click 'Check VPAs'** to run the analysis

    ### What you'll get:

    - **Summary by Library**: Total transactions grouped by checkout library type
    - **Detailed Results**: Per-VPA breakdown with merchant info and transaction counts
    - **CSV Export**: Download complete results with all transaction details
    - **VPAs without transactions**: List of VPAs that had no activity in the date range

    ### Example VPA format:
    ```
    merchant1@paytm
    merchant2@upi
    merchant3@ybl
    ```
    """)
