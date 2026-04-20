import fs from 'node:fs'
import path from 'node:path'
import jwt from 'jsonwebtoken'
import config from './config'

class AppleSearchAdsAuth {
  constructor() {
    this.clientId = config.appleAds.clientId
    this.teamId = config.appleAds.teamId
    this.keyId = config.appleAds.keyId
    this.privateKeyPath = config.appleAds.privateKeyPath
    this.clientSecret = null
    this.clientSecretExpiry = null
    this.accessToken = null
    this.accessTokenExpiry = null
  }

  loadPrivateKey() {
    const keyPath = path.resolve(this.privateKeyPath)
    if (!fs.existsSync(keyPath)) {
      throw new Error(`Private key file not found: ${keyPath}`)
    }
    return fs.readFileSync(keyPath, 'utf8')
  }

  generateToken() {
    const privateKey = this.loadPrivateKey()
    const now = Math.floor(Date.now() / 1000)
    const expiryTime = now + 180 * 24 * 60 * 60

    const payload = {
      sub: this.clientId,
      aud: 'https://appleid.apple.com',
      iat: now,
      exp: expiryTime,
      iss: this.teamId,
    }

    const clientSecret = jwt.sign(payload, privateKey, {
      algorithm: 'ES256',
      header: {
        alg: 'ES256',
        kid: this.keyId,
      },
    })

    this.clientSecret = clientSecret
    this.clientSecretExpiry = new Date(expiryTime * 1000)
    return clientSecret
  }

  getClientSecret() {
    if (this.clientSecret && this.clientSecretExpiry) {
      const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000)
      if (this.clientSecretExpiry > oneHourFromNow) {
        return this.clientSecret
      }
    }
    return this.generateToken()
  }

  async getAccessToken() {
    if (this.accessToken && this.accessTokenExpiry && this.accessTokenExpiry > new Date(Date.now() + 5 * 60 * 1000)) {
      return this.accessToken
    }

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.clientId,
      client_secret: this.getClientSecret(),
      scope: 'searchadsorg',
    })

    const response = await fetch('https://appleid.apple.com/auth/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    })

    const data = await response.json()
    if (!response.ok || !data.access_token) {
      throw new Error(`OAuth token request failed: ${response.status} - ${JSON.stringify(data)}`)
    }

    const expiresIn = Number(data.expires_in || 3600)
    this.accessToken = data.access_token
    this.accessTokenExpiry = new Date(Date.now() + expiresIn * 1000)
    return this.accessToken
  }

  async getHeaders(orgId = null) {
    const headers = {
      Authorization: `Bearer ${await this.getAccessToken()}`,
      'Content-Type': 'application/json',
    }

    if (orgId) {
      headers['X-AP-Context'] = `orgId=${orgId}`
    }

    return headers
  }
}

const auth = new AppleSearchAdsAuth()
export default auth
