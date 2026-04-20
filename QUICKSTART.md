# Quick Start Guide

## 🚀 Getting Started with Apple Search Ads API Client

### Step 1: Install Dependencies

```bash
# Install backend dependencies
npm install

# Install frontend dependencies
cd client && npm install && cd ..
```

### Step 2: Configure API Credentials

1. **Get your Apple Search Ads API credentials:**
   - Log in to [Apple Search Ads](https://searchads.apple.com/)
   - Go to Settings → API
   - Create or download your API key and private key (.pem file)

2. **Set up environment variables:**

```bash
# Copy the example file
cp .env.example .env

# Edit .env and fill in your credentials:
# - CLIENT_ID: Your Apple Search Ads client ID
# - TEAM_ID: Your team ID
# - KEY_ID: Your API key ID
# - PRIVATE_KEY_PATH: Path to your .pem file (e.g., ./keys/private-key.pem)
```

3. **Add your private key:**

```bash
# Place your .pem file in the keys directory
cp /path/to/your/downloaded-key.pem ./keys/private-key.pem
```

### (Optional) App Store Connect — Keyword Metadata

The **App Store Connect** tab lets you read and update keyword metadata (localizations) for your apps. It uses a separate API key from [App Store Connect → Users and Access → Keys]

1. **Create an App Store Connect API key:**
   - Go to [App Store Connect → Users and Access → Integrations → App Store Connect API](https://appstoreconnect.apple.com/access/api)
   - Click **+** to generate a new key with **App Manager** role (or higher)
   - Note the **Issuer ID** shown at the top of the page
   - Download the `.p8` private key (it can only be downloaded once)

2. **Add the key to your project:**

```bash
cp /path/to/AuthKey_XXXXXXXXXX.p8 ./keys/appstore-private-key.p8
```

3. **Add the following variables to your `.env` file:**

```env
APP_STORE_ISSUER_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
APP_STORE_KEY_ID=XXXXXXXXXX
APP_STORE_PRIVATE_KEY_PATH=./keys/appstore-private-key.p8
```

### Step 3: Run the Application

**Option A: Start everything at once (simplest)**

```bash
# Start both backend and frontend together
npm start
```

**Option B: Development mode with auto-reload**

```bash
# Start both with nodemon for backend auto-reload
npm run dev
```

**Option C: Run servers separately**

```bash
# Terminal 1 - Backend only (port 3001)
npm run server

# Terminal 2 - Frontend only (port 3000)
npm run client
```

### Step 4: Access the Application

- **Frontend Dashboard**: http://localhost:3000
- **Backend API**: http://localhost:3001
- **Health Check**: http://localhost:3001/health

## 📝 API Endpoints

### Campaigns

- `GET /api/campaigns` - List all campaigns
- `GET /api/campaigns/:id` - Get campaign details
- `POST /api/campaigns` - Create new campaign
- `PUT /api/campaigns/:id` - Update campaign
- `DELETE /api/campaigns/:id` - Delete campaign

### Reports

- `POST /api/reports/campaigns` - Get campaign reports

## 🔧 Troubleshooting

### "Missing required environment variables"

- Make sure you've created `.env` file from `.env.example`
- Verify all required variables are filled in

### "Private key file not found"

- Check that your .pem file exists in the specified path
- Ensure the path in `.env` matches your file location

### "Cannot connect to API"

- Verify your API credentials are correct
- Check that you have network access to Apple Search Ads API
- Ensure your API key hasn't expired

## 📚 Next Steps

1. View your campaigns in the Dashboard
2. Create new campaigns
3. Generate reports for performance analysis
4. Customize the frontend to match your needs

## 🆘 Need Help?

- Review the [README.md](./README.md) for detailed documentation
- Check [Apple Search Ads API Documentation](https://developer.apple.com/documentation/apple_search_ads)

---

Happy advertising! 🎉
