/**
 * Utility script to extract and display public key from private key
 * This can be useful for verification and testing
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

/**
 * Extract public key from private key
 * @param {string} privateKeyPath - Path to private key file
 * @returns {Object} Public and private key information
 */
function extractPublicKey(privateKeyPath) {
  try {
    // Read private key
    const keyPath = path.resolve(privateKeyPath)
    if (!fs.existsSync(keyPath)) {
      throw new Error(`Private key file not found: ${keyPath}`)
    }

    const privateKeyPem = fs.readFileSync(keyPath, 'utf8')

    // Create private key object
    const privateKeyObject = crypto.createPrivateKey({
      key: privateKeyPem,
      format: 'pem',
    })

    // Extract public key
    const publicKeyObject = crypto.createPublicKey(privateKeyObject)
    const publicKeyPem = publicKeyObject.export({
      type: 'spki',
      format: 'pem',
    })

    // Get key details
    const keyDetails = privateKeyObject.asymmetricKeyDetails

    return {
      publicKey: publicKeyPem,
      privateKeyPath: keyPath,
      keyType: privateKeyObject.asymmetricKeyType,
      keyDetails: keyDetails,
    }
  } catch (error) {
    throw new Error(`Failed to extract public key: ${error.message}`)
  }
}

/**
 * Save public key to file
 * @param {string} publicKeyPem - Public key in PEM format
 * @param {string} outputPath - Output file path
 */
function savePublicKey(publicKeyPem, outputPath) {
  fs.writeFileSync(outputPath, publicKeyPem)
  console.log(`✅ Public key saved to: ${outputPath}`)
}

/**
 * Display key information
 * @param {Object} keyInfo - Key information object
 */
function displayKeyInfo(keyInfo) {
  console.log('\n🔑 Key Information:')
  console.log('─'.repeat(50))
  console.log(`Private Key Path: ${keyInfo.privateKeyPath}`)
  console.log(`Key Type: ${keyInfo.keyType}`)
  if (keyInfo.keyDetails) {
    console.log(`Key Details:`, keyInfo.keyDetails)
  }
  console.log('\n📄 Public Key (PEM format):')
  console.log('─'.repeat(50))
  console.log(keyInfo.publicKey)
  console.log('─'.repeat(50))
}

// Main execution
if (require.main === module) {
  const args = process.argv.slice(2)

  if (args.length === 0) {
    console.log('Usage: node extractPublicKey.js <private-key-path> [output-path]')
    console.log('\nExamples:')
    console.log('  node extractPublicKey.js ./keys/private-key.pem')
    console.log('  node extractPublicKey.js ./keys/private-key.pem ./keys/public-key.pem')
    process.exit(1)
  }

  const privateKeyPath = args[0]
  const outputPath = args[1]

  try {
    console.log('🔐 Extracting public key from private key...\n')

    const keyInfo = extractPublicKey(privateKeyPath)
    displayKeyInfo(keyInfo)

    if (outputPath) {
      savePublicKey(keyInfo.publicKey, outputPath)
    } else {
      console.log('\n💡 Tip: Provide an output path to save the public key to a file')
      console.log('   Example: node extractPublicKey.js <private-key> ./keys/public-key.pem')
    }

    console.log('\n✅ Public key extraction complete!')
  } catch (error) {
    console.error('\n❌ Error:', error.message)
    process.exit(1)
  }
}

module.exports = { extractPublicKey, savePublicKey }
