/**
 * Generate a new ES256 key pair for testing
 * Note: For production, use the private key provided by Apple Search Ads
 */

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

/**
 * Generate ES256 (ECDSA) key pair
 * @returns {Object} Public and private keys in PEM format
 */
function generateKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1', // This is P-256, used for ES256
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem',
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem',
    },
  })

  return { publicKey, privateKey }
}

/**
 * Save keys to files
 * @param {string} publicKey - Public key PEM
 * @param {string} privateKey - Private key PEM
 * @param {string} directory - Output directory
 */
function saveKeys(publicKey, privateKey, directory = './keys') {
  const dir = path.resolve(directory)

  // Create directory if it doesn't exist
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  const timestamp = Date.now()
  const privateKeyPath = path.join(dir, `test-private-key-${timestamp}.pem`)
  const publicKeyPath = path.join(dir, `test-public-key-${timestamp}.pem`)

  fs.writeFileSync(privateKeyPath, privateKey)
  fs.writeFileSync(publicKeyPath, publicKey)

  return { privateKeyPath, publicKeyPath }
}

// Main execution
if (require.main === module) {
  const args = process.argv.slice(2)
  const outputDir = args[0] || './keys'

  console.log('🔐 Generating ES256 key pair for testing...\n')
  console.log('⚠️  WARNING: This is for testing purposes only!')
  console.log('    For production, use the private key from Apple Search Ads console.\n')

  try {
    const { publicKey, privateKey } = generateKeyPair()
    const { privateKeyPath, publicKeyPath } = saveKeys(publicKey, privateKey, outputDir)

    console.log('✅ Key pair generated successfully!\n')
    console.log('📁 Files created:')
    console.log(`   Private Key: ${privateKeyPath}`)
    console.log(`   Public Key:  ${publicKeyPath}`)
    console.log('\n📄 Public Key Preview:')
    console.log('─'.repeat(50))
    console.log(publicKey)
    console.log('─'.repeat(50))
    console.log('\n💡 Usage:')
    console.log('   Update your .env file with: PRIVATE_KEY_PATH=' + privateKeyPath)
    console.log('\n⚠️  Remember: For actual Apple Search Ads API, download the key from Apple!')
  } catch (error) {
    console.error('\n❌ Error:', error.message)
    process.exit(1)
  }
}

module.exports = { generateKeyPair, saveKeys }
