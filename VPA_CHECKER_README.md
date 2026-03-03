# VPA Ecosystem Checker

A Streamlit web application to check if merchant VPAs are part of the Razorpay ecosystem based on transaction data.

## Features

- **Multiple Input Methods**: Upload CSV/TXT files or manually enter VPAs
- **Summary Statistics**: View total transactions grouped by checkout library type
- **Detailed Results**: Per-VPA breakdown with merchant information
- **CSV Export**: Download complete results with transaction details
- **Activity Tracking**: Identifies VPAs without transactions in the date range

## Setup Instructions

### 1. Install Dependencies

```bash
pip install -r requirements.txt
```

### 2. Configure Database Connection

Edit `.streamlit/secrets.toml` with your Trino database credentials:

```toml
trino_host = "your-trino-host.com"
trino_port = 8080
trino_user = "your_username"
trino_catalog = "hive"
trino_schema = "default"
```

### 3. Run the Application

```bash
streamlit run vpa_checker_app.py
```

The app will open in your default browser at `http://localhost:8501`

## Usage

### Upload File Method

1. Select **"Upload File"** in the sidebar
2. Upload a CSV or TXT file with one VPA per line
3. Choose your start date
4. Click **"Check VPAs"**

Example file format:
```
merchant1@paytm
merchant2@upi
merchant3@ybl
```

### Manual Entry Method

1. Select **"Manual Entry"** in the sidebar
2. Paste VPAs in the text area (one per line)
3. Choose your start date
4. Click **"Check VPAs"**

## Output

### Summary by Library
Shows aggregated statistics:
- Total transactions per library type
- Unique VPAs per library
- Unique merchants per library

### Detailed Results Table
Displays per-VPA information:
- VPA
- Merchant ID
- Terminal ID
- Merchant Name
- Website
- Category
- Library Type
- Transaction Count

### Export Options
- **Detailed Results CSV**: Complete per-VPA transaction data
- **Summary CSV**: Aggregated statistics by library

## Library Type Mapping

| Code | Library Name |
|------|--------------|
| 1 | Standard checkout |
| 2 | CUSTOM |
| 3 | S2S |
| 4 | CUSTOM |
| 5 | DIRECT |
| 6 | PUSH |
| 7 | LEGACYJS |
| 8 | Standard checkout |
| 9 | EMBEDDED |

## Database Requirements

The application requires access to the following tables:
- `aggregate_pa.dim_merchant_terminal`
- `realtime_hudi_api.payments`
- `realtime_hudi_api.payment_analytics`
- `realtime_hudi_api.merchants`
- `analytics_selfserve` schema (for temporary tables)

Ensure your database user has:
- `SELECT` permissions on the above tables
- `CREATE TABLE` and `DROP TABLE` permissions on `analytics_selfserve` schema

## Troubleshooting

### Connection Issues
- Verify your Trino host and port in `secrets.toml`
- Check if your user has proper database permissions
- Ensure network connectivity to the Trino cluster

### Query Errors
- Verify the schema and table names match your environment
- Check if the date range contains data
- Ensure VPAs are in the correct format

### Performance Tips
- For large VPA lists (>1000), consider splitting into batches
- Adjust the start date to limit the data range
- The temporary table is automatically cleaned up after each query

## Support

For issues or questions, contact your database administrator or data team.
