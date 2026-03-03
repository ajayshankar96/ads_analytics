# VPA Ecosystem Checker - Local Setup Guide

This tool runs locally on your machine to access Razorpay's internal Trino database.

## ⚡ Quick Start

### 1. Clone the Repository

```bash
git clone https://github.com/ajayshankar96/ads_analytics.git
cd ads_analytics
```

### 2. Install Dependencies

```bash
# Using pip3
pip3 install -r requirements.txt

# OR using python3
python3 -m pip install -r requirements.txt
```

### 3. Run the App

```bash
# Using streamlit directly
streamlit run vpa_checker_app.py

# OR using python3
python3 -m streamlit run vpa_checker_app.py
```

### 4. Access the App

- The app will automatically open in your browser
- Or manually visit: **http://localhost:8501**

### 5. Login & Use

1. In the sidebar, expand **"🔐 Database Credentials"**
2. Enter your credentials:
   - **Email:** `your.name@razorpay.com`
   - **Password:** Your Trino database password
3. Click **"Connect"**
4. Once connected, upload VPA list or enter manually
5. Click **"Check VPAs"**

## 📂 Input Files

### File Format (CSV or TXT)

One VPA per line:
```
merchant1@paytm
merchant2@upi
merchant3@ybl
```

You can use `#` for comments:
```
# Production VPAs
merchant1@paytm
merchant2@upi

# Test VPAs
test@paytm
```

### Sample File

A sample VPA file is included: `sample_vpas.txt`

## 🔧 Configuration

### Default Settings

The app uses these default Trino settings:
- **Host:** `trino-gateway-router-looker.de.razorpay.com`
- **Port:** `443`
- **Catalog:** `hive`
- **Auth:** LDAP (your email & password)

### Custom Date Range

- Default start date: **2025-11-01**
- Change it in the sidebar before running queries

## 📊 Output

### Summary View
- Total transactions by library (checkout) type
- Unique VPAs and merchants per library

### Detailed Results
- Per-VPA breakdown with:
  - Merchant ID, name, website
  - Category information
  - Transaction counts
  - Library/checkout type

### Export
- **Detailed CSV:** Per-VPA transaction data
- **Summary CSV:** Aggregated stats by library
- **VPAs without transactions:** List of inactive VPAs

## 🐛 Troubleshooting

### "pip command not found"
Use `pip3` instead:
```bash
pip3 install -r requirements.txt
```

### "streamlit command not found"
Use python module syntax:
```bash
python3 -m streamlit run vpa_checker_app.py
```

### "Connection failed"
- Verify you're on Razorpay's network (VPN if working remotely)
- Check your Trino credentials are correct
- Ensure you have database access permissions

### App is slow with large VPA lists
- For 6000+ VPAs, the query might take 30-60 seconds
- This is normal - the app uses efficient CTEs for the query

## 🔒 Security Notes

- **Never commit passwords** to the repository
- Your credentials are stored only in your browser session
- Credentials are cleared when you close the browser
- The `.gitignore` file prevents accidentally committing secrets

## 💡 Tips

1. **Save VPA lists as files** for repeated checks
2. **Adjust date range** to narrow down results
3. **Export to CSV** for further analysis in Excel/sheets
4. **Use comments in files** to organize VPA lists

## 🆘 Need Help?

Contact: Ajay Shankar (`ajay.shankar@razorpay.com`)

---

**Built for Razorpay Analytics Team**
