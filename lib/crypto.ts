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

function getKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY
  if (!hex || hex.length !== 64) {
    // Fallback: derive a deterministic key from a fixed string (dev only — NOT secure)
    // In production ENCRYPTION_KEY must be set
    return Buffer.from('nexus_dev_fallback_key_NOT_FOR_PROD_USE_00000000', 'utf8').subarray(0, 32)
  }
  return Buffer.from(hex, 'hex')
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
