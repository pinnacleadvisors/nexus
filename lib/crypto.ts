/**
 * AES-256-GCM symmetric encryption for sensitive values (OAuth tokens, secrets).
 *
 * Required env var:
 *   ENCRYPTION_KEY — 64 hex characters (32 bytes).
 *   Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *   Add to Doppler as ENCRYPTION_KEY.
 *
 * Format of encrypted output: "<iv_hex>:<tag_hex>:<ciphertext_hex>"
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const ALGORITHM = 'aes-256-gcm'

/**
 * ADR 004 — fail-closed in production AND staging-equivalent environments.
 * The dev placeholder is only used when explicitly running locally
 * (NODE_ENV=development) AND no Vercel preview / staging override is set.
 */
function isStagingLike(): boolean {
  if (process.env.NEXUS_REQUIRE_ENCRYPTION_KEY === '1') return true
  // Vercel preview deploys are real deployed instances against real services
  // even when NODE_ENV reports otherwise.
  if (process.env.VERCEL_ENV === 'preview') return true
  return false
}

function getKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY
  if (!hex || hex.length !== 64) {
    if (process.env.NODE_ENV === 'production' || isStagingLike()) {
      throw new Error(
        'ENCRYPTION_KEY missing or invalid in production/staging. ' +
        'Set a 64-hex-character value in Doppler. ' +
        'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))" ' +
        'See docs/adr/004-encryption-key-policy.md.'
      )
    }
    console.warn(
      '[crypto] WARNING: ENCRYPTION_KEY not set — using insecure dev fallback. ' +
      'This MUST NOT be used in production or staging. See ADR 004.'
    )
    return Buffer.from('nexus_dev_fallback_key_NOT_FOR_PROD_USE_00000000', 'utf8').subarray(0, 32)
  }
  return Buffer.from(hex, 'hex')
}

/**
 * Re-encrypt a ciphertext with a new key. Used during key rotation.
 * Procedure:
 *   1. Generate a new ENCRYPTION_KEY (64 hex chars)
 *   2. Set both OLD and NEW keys in env temporarily
 *   3. For every encrypted row, call rotateKey(row.ciphertext, oldKeyHex, newKeyHex)
 *   4. Swap ENCRYPTION_KEY to the new value; remove old.
 */
export function rotateKey(ciphertext: string, oldKeyHex: string, newKeyHex: string): string | null {
  if (oldKeyHex.length !== 64 || newKeyHex.length !== 64) return null
  try {
    const [ivHex, tagHex, dataHex] = ciphertext.split(':')
    if (!ivHex || !tagHex || !dataHex) return null
    const oldKey = Buffer.from(oldKeyHex, 'hex')
    const iv     = Buffer.from(ivHex,  'hex')
    const tag    = Buffer.from(tagHex, 'hex')
    const data   = Buffer.from(dataHex, 'hex')
    const decipher = createDecipheriv(ALGORITHM, oldKey, iv)
    decipher.setAuthTag(tag)
    const plaintext = decipher.update(data).toString('utf8') + decipher.final('utf8')

    const newKey = Buffer.from(newKeyHex, 'hex')
    const newIv  = randomBytes(12)
    const cipher = createCipheriv(ALGORITHM, newKey, newIv)
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    const newTag = cipher.getAuthTag()
    return `${newIv.toString('hex')}:${newTag.toString('hex')}:${encrypted.toString('hex')}`
  } catch {
    return null
  }
}

/** Encrypt a plaintext string. Returns "<iv>:<tag>:<ciphertext>" (all hex). */
export function encrypt(plaintext: string): string {
  const key = getKey()
  const iv  = randomBytes(12) // 96-bit IV for GCM
  const cipher = createCipheriv(ALGORITHM, key, iv)

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`
}

/** Decrypt a value produced by `encrypt()`. Returns null on failure. */
export function decrypt(ciphertext: string): string | null {
  try {
    const [ivHex, tagHex, dataHex] = ciphertext.split(':')
    if (!ivHex || !tagHex || !dataHex) return null

    const key    = getKey()
    const iv     = Buffer.from(ivHex, 'hex')
    const tag    = Buffer.from(tagHex, 'hex')
    const data   = Buffer.from(dataHex, 'hex')

    const decipher = createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(tag)

    return decipher.update(data).toString('utf8') + decipher.final('utf8')
  } catch {
    return null
  }
}

/** Returns true when a string looks like an encrypted value (has the iv:tag:data format). */
export function isEncrypted(value: string): boolean {
  const parts = value.split(':')
  return parts.length === 3 && parts.every(p => /^[0-9a-f]+$/i.test(p))
}

/** Encrypt only if ENCRYPTION_KEY is set; otherwise return value unchanged. */
export function encryptIfConfigured(value: string): string {
  if (!process.env.ENCRYPTION_KEY) return value
  return encrypt(value)
}

/** Decrypt if value looks encrypted; otherwise return as-is. */
export function decryptIfNeeded(value: string): string {
  if (!isEncrypted(value)) return value
  return decrypt(value) ?? value
}
