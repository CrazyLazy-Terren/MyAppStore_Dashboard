# MyAppStore

My vibe-coding dashboard for handling App Store updates and campaigns.

# Apple Search Ads API Client - Node.js Backend + React Frontend

A full-stack JavaScript application for managing Apple Search Ads campaigns with an intuitive web interface.

## Architecture

- **Backend**: Node.js/Express API server
- **Frontend**: React-based dashboard
- **Authentication**: JWT for Apple Search Ads API

## Prerequisites

- Node.js 16+ and npm
- Apple Developer Account
- Apple Search Ads Account with API access
- API credentials (Client ID, Team ID, Key ID, Private Key)

## Quick Start

### 1. Get API Credentials

1. Log in to [Apple Search Ads](https://searchads.apple.com/)
2. Navigate to Settings → API
3. Create a new API key or use existing credentials
4. Download the private key (.pem file)

### 2. Install Dependencies

```bash
# Install backend and frontend dependencies
npm run install-all

# Or install separately
npm install          # Backend
cd client && npm install  # Frontend
```

### 3. Configure Environment

Create a `.env` file in the root directory:

```env
# Apple Search Ads API Credentials
CLIENT_ID=SEARCHADS.YOUR-CLIENT-ID-HERE
TEAM_ID=SEARCHADS.YOUR-TEAM-ID-HERE
KEY_ID=YOUR-KEY-ID-HERE
PRIVATE_KEY_PATH=./keys/private-key.pem

# Server Configuration
PORT=3001
NODE_ENV=development

# API Configuration
API_VERSION=v5
API_BASE_URL=https://api.searchads.apple.com/api

# App Store Connect API Credentials
# Required for the "App Store Connect" tab (keyword metadata management)
APP_STORE_ISSUER_ID=YOUR-ISSUER-UUID-HERE
APP_STORE_KEY_ID=YOUR-KEY-ID-HERE
APP_STORE_PRIVATE_KEY_PATH=./keys/appstore-private-key.p8
```

### 4. Run Development Servers

```bash
# Easiest: Start both backend and frontend together
npm start

# Development mode with auto-reload
npm run dev

# Or run separately:
npm run server       # Backend only (port 3001)
npm run client       # Frontend only (port 3000)
```

## Project Structure

```
.
├── README.md
├── package.json
├── .env (gitignored)
├── .env.example
├── server/
│   ├── index.js              # Express server
│   ├── config/
│   │   └── config.js         # Configuration loader
│   ├── services/
│   │   ├── auth.js           # Apple Search Ads authentication
│   │   └── appleAds.js       # API client
│   ├── routes/
│   │   ├── campaigns.js      # Campaign endpoints
│   │   ├── adGroups.js       # Ad group endpoints
│   │   └── reports.js        # Reporting endpoints
│   └── middleware/
│       ├── errorHandler.js
│       └── validator.js
├── client/
│   ├── package.json
│   ├── public/
│   └── src/
│       ├── App.js
│       ├── components/
│       │   ├── Dashboard.js
│       │   ├── CampaignList.js
│       │   ├── CampaignDetail.js
│       │   └── Reports.js
│       ├── services/
│       │   └── api.js        # Frontend API client
│       └── styles/
├── keys/                      # Store private keys here (gitignored)
└── tests/
```

## Frontend Features

- 📊 **Dashboard**: Overview of all campaigns with key metrics
- 🎯 **Campaign Management**: Create, edit, and manage campaigns
- 📈 **Reports**: Visual reports with charts and data export
- 🔍 **Keyword Management**: Search terms and keyword optimization
- 💰 **Budget Tracking**: Monitor spending and adjust budgets
- 📱 **Responsive Design**: Works on desktop and mobile

## API Endpoints

### Campaigns

- `GET /api/campaigns` - List all campaigns
- `GET /api/campaigns/:id` - Get campaign details
- `POST /api/campaigns` - Create new campaign
- `PUT /api/campaigns/:id` - Update campaign
- `DELETE /api/campaigns/:id` - Delete campaign

### Ad Groups

- `GET /api/campaigns/:id/adgroups` - List ad groups
- `POST /api/campaigns/:id/adgroups` - Create ad group
- `PUT /api/adgroups/:id` - Update ad group

### Reports

- `GET /api/reports/campaigns` - Campaign performance report
- `GET /api/reports/keywords` - Keyword performance report
- `POST /api/reports/custom` - Generate custom report

## Environment Variables

| Variable                     | Description                                            | Required           |
| ---------------------------- | ------------------------------------------------------ | ------------------ |
| `CLIENT_ID`                  | Apple Search Ads client ID                             | Yes                |
| `TEAM_ID`                    | Apple Search Ads team ID                               | Yes                |
| `KEY_ID`                     | Apple Search Ads API key ID                            | Yes                |
| `PRIVATE_KEY_PATH`           | Path to Search Ads .pem private key                    | Yes                |
| `PORT`                       | Backend server port                                    | No (default: 3001) |
| `NODE_ENV`                   | Environment (development/production)                   | No                 |
| `APP_STORE_ISSUER_ID`        | App Store Connect Issuer ID (UUID from Users & Access) | Yes (ASC tab)      |
| `APP_STORE_KEY_ID`           | App Store Connect API key ID                           | Yes (ASC tab)      |
| `APP_STORE_PRIVATE_KEY_PATH` | Path to App Store Connect .p8 private key              | Yes (ASC tab)      |

## Development

### Backend Development

```bash
# Start both backend and frontend with auto-reload
npm run dev

# Backend only with auto-reload
npm run server

# Test API endpoints
curl http://localhost:3001/api/campaigns
```

### Frontend Development

```bash
# Start React dev server only
npm run client

# Build for production
npm run build
```

## Production Deployment

1. Build the frontend:

```bash
cd client && npm run build
```

2. Set environment variables on your server

3. Start the backend:

```bash
NODE_ENV=production npm start
```

## Security Best Practices

- ✅ Never commit `.env` files or `.pem` keys
- ✅ Use environment variables for all sensitive data
- ✅ Rotate API keys regularly
- ✅ Implement rate limiting on API endpoints
- ✅ Use HTTPS in production
- ✅ Validate all user inputs
- ✅ Follow principle of least privilege

## Troubleshooting

### Authentication Errors

- Verify your API credentials are correct
- Check that the private key file path is valid
- Ensure the key hasn't expired

### Connection Issues

- Verify network connectivity to Apple Search Ads API
- Check firewall settings
- Confirm API base URL is correct

## Resources

- [Apple Search Ads API Documentation](https://developer.apple.com/documentation/apple_search_ads)
- [Campaign Management Guide](https://developer.apple.com/documentation/apple_search_ads/campaign_management)
- [Reporting API Guide](https://developer.apple.com/documentation/apple_search_ads/reporting)

## License

MIT
