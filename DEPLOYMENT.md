# Deploying VPA Ecosystem Checker to Streamlit Cloud

## Prerequisites

- GitHub account
- Streamlit Cloud account (free at [share.streamlit.io](https://share.streamlit.io))
- Git installed on your machine

## Step 1: Create a GitHub Repository

### Option A: Using GitHub Web Interface

1. Go to [github.com](https://github.com) and log in
2. Click the **"+"** icon in the top right → **"New repository"**
3. Name it: `vpa-ecosystem-checker` (or any name you prefer)
4. Set to **Private** (recommended for internal tools)
5. Don't initialize with README (we already have files)
6. Click **"Create repository"**

### Option B: Using Command Line

```bash
# Navigate to your project directory
cd /Users/ajay.shankar/Documents/vpa_finder

# Initialize git repository
git init

# Add all files
git add .

# Create initial commit
git commit -m "Initial commit: VPA Ecosystem Checker"

# Create repository on GitHub and follow their instructions to push
# Example:
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/vpa-ecosystem-checker.git
git push -u origin main
```

## Step 2: Push Code to GitHub

```bash
cd /Users/ajay.shankar/Documents/vpa_finder

# If not already a git repo
git init

# Add files (secrets.toml is ignored by .gitignore)
git add .

# Commit
git commit -m "Initial commit: VPA Ecosystem Checker"

# Add your GitHub repo as remote
git remote add origin https://github.com/YOUR_USERNAME/vpa-ecosystem-checker.git

# Push to GitHub
git push -u origin main
```

**IMPORTANT:** The `.gitignore` file ensures `secrets.toml` with your password is NOT pushed to GitHub.

## Step 3: Deploy to Streamlit Cloud

### 3.1 Sign Up / Log In

1. Go to [share.streamlit.io](https://share.streamlit.io)
2. Sign in with your GitHub account

### 3.2 Deploy New App

1. Click **"New app"**
2. Select:
   - **Repository:** `YOUR_USERNAME/vpa-ecosystem-checker`
   - **Branch:** `main`
   - **Main file path:** `vpa_checker_app.py`
3. Click **"Advanced settings"** (optional)
   - **Python version:** 3.9 or higher
4. Click **"Deploy!"**

### 3.3 Configure Secrets (Streamlit Cloud)

1. Once deployed, click **⚙️ Settings** in the top right
2. Click **"Secrets"**
3. Paste the following (update if needed):

```toml
# Trino/Presto Database Configuration
trino_host = "trino-gateway-router-looker.de.razorpay.com"
trino_port = 443
trino_catalog = "hive"
trino_schema = "default"
```

4. Click **"Save"**

**Note:** Individual user passwords are NOT stored in secrets - users enter their own credentials in the app.

## Step 4: Share with Team

### Option A: Public Link (Anyone with link)

Your app URL will be: `https://YOUR_USERNAME-vpa-ecosystem-checker-main-vpa-checker-app-XXXXX.streamlit.app`

Share this link with your team members.

### Option B: Restricted Access (Recommended)

1. In Streamlit Cloud app settings → **"Sharing"**
2. Set **"App visibility"** to **"Restricted"**
3. Add allowed email addresses or domains:
   - Add individual emails: `colleague@razorpay.com`
   - Or allow entire domain: `@razorpay.com`
4. Only users with `@razorpay.com` email can access

## Step 5: Using the Deployed App

1. Users visit the shared URL
2. Enter their Razorpay email and Trino password
3. Click **"Connect"**
4. Upload VPA list or enter manually
5. Click **"Check VPAs"**

## Updating the App

When you make changes locally:

```bash
cd /Users/ajay.shankar/Documents/vpa_finder

# Make your code changes
# ... edit files ...

# Commit and push
git add .
git commit -m "Description of changes"
git push

# Streamlit Cloud will automatically redeploy within 1-2 minutes
```

## Troubleshooting

### "Module not found" errors

Update `requirements.txt` with any missing packages and push:
```bash
git add requirements.txt
git commit -m "Update requirements"
git push
```

### Connection errors

- Verify `secrets.toml` in Streamlit Cloud has correct host/port
- Ensure users are entering correct credentials
- Check if Trino database is accessible from external IPs

### App is slow

- Streamlit Cloud free tier has limited resources
- For better performance, consider:
  - Upgrading to Streamlit Cloud Pro
  - Deploying to your own infrastructure (AWS, GCP, etc.)

## Security Best Practices

✅ **DO:**
- Keep the GitHub repo **private**
- Use Streamlit's restricted access feature
- Let users enter their own credentials (never hardcode)
- Regularly rotate database passwords

❌ **DON'T:**
- Commit `secrets.toml` to Git (it's gitignored)
- Share credentials in the app code
- Make the app publicly accessible
- Store user passwords in the app

## Support

For issues:
- Check Streamlit Cloud logs: Click **"Manage app"** → **"Logs"**
- Contact your DevOps/IT team for internal deployment options
