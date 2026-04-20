import 'dotenv/config'

const config = {
  appleAds: {
    clientId: process.env.CLIENT_ID,
    teamId: process.env.TEAM_ID,
    keyId: process.env.KEY_ID,
    privateKeyPath: process.env.PRIVATE_KEY_PATH,
    apiVersion: process.env.API_VERSION || 'v5',
    apiBaseUrl: process.env.API_BASE_URL || 'https://api.searchads.apple.com/api',
  },
  nodeEnv: process.env.NODE_ENV || 'development',
}

export function validateConfig() {
  const requiredEnvVars = ['CLIENT_ID', 'TEAM_ID', 'KEY_ID', 'PRIVATE_KEY_PATH']
  const missing = requiredEnvVars.filter((key) => !process.env[key])
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`)
  }

  const hasPlaceholder = requiredEnvVars.some((key) => (process.env[key] || '').includes('YOUR-'))
  if (hasPlaceholder) {
    throw new Error('Detected placeholder credentials in .env. Replace with real Apple Ads API values.')
  }
}

export default config
