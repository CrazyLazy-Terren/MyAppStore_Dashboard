# Key Management Scripts

This directory contains utility scripts for managing cryptographic keys.

## Scripts

### 1. Extract Public Key

Extract the public key from your Apple Search Ads private key.

**Usage:**

```bash
# Display public key
node scripts/extractPublicKey.js ./keys/private-key.pem

# Save public key to file
node scripts/extractPublicKey.js ./keys/private-key.pem ./keys/public-key.pem

# Using npm script
npm run extract-public-key ./keys/private-key.pem
```

**What it does:**

- Reads your private key file
- Extracts the corresponding public key
- Displays key information and public key in PEM format
- Optionally saves the public key to a file

### 2. Generate Test Key Pair

Generate a test ES256 key pair for local development and testing.

**⚠️ WARNING:** This is for testing only! For production, always use the private key from Apple Search Ads console.

**Usage:**

```bash
# Generate keys in default directory (./keys)
node scripts/generateKeyPair.js

# Generate keys in custom directory
node scripts/generateKeyPair.js ./test-keys

# Using npm script
npm run generate-test-keys
```

**What it does:**

- Generates a new ES256 (ECDSA P-256) key pair
- Saves both private and public keys with timestamps
- Displays the public key
- Creates timestamped files to avoid overwriting

## Use Cases

### For Development

- Generate test keys to develop without real credentials
- Test JWT token generation locally
- Verify authentication flow

### For Production

- Extract public key from Apple's private key for verification
- Share public key with team members (never share private key!)
- Validate key format and algorithm

## Key Information

Apple Search Ads API uses:

- **Algorithm**: ES256 (ECDSA with P-256 curve and SHA-256)
- **Key Format**: PEM
- **Private Key**: Provided by Apple Search Ads console
- **Public Key**: Can be extracted from private key

## Security Notes

- ✅ Public keys can be safely shared
- ❌ Never commit private keys to version control
- ✅ Test keys are safe for local development
- ❌ Never use test keys in production with real Apple Search Ads API
- ✅ Store production private keys securely (environment variables, secrets manager)

## Examples

### View your key information

```bash
npm run extract-public-key ./keys/private-key.pem
```

### Create test environment

```bash
# Generate test keys
npm run generate-test-keys

# Update .env with test key path
# PRIVATE_KEY_PATH=./keys/test-private-key-<timestamp>.pem
```

### Extract and save public key

```bash
node scripts/extractPublicKey.js ./keys/private-key.pem ./keys/public-key.pem
```
