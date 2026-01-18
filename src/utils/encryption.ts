import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from '../config/index.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

function getKey(): Buffer {
  return Buffer.from(env.ENCRYPTION_KEY, 'hex');
}

export function encrypt(text: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:ciphertext
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

export function decrypt(encryptedText: string): string {
  const parts = encryptedText.split(':');

  if (parts.length !== 3) {
    throw new Error(
      `Invalid encrypted text format: expected 3 parts (iv:authTag:ciphertext), got ${parts.length}`
    );
  }

  const [ivHex, authTagHex, ciphertext] = parts;

  // Validate IV: should be 32 hex characters (16 bytes)
  if (!/^[0-9a-fA-F]{32}$/.test(ivHex)) {
    throw new Error(
      `Invalid IV: expected 32 hex characters (16 bytes), got ${ivHex.length} characters`
    );
  }

  // Validate auth tag: should be 32 hex characters (16 bytes)
  if (!/^[0-9a-fA-F]{32}$/.test(authTagHex)) {
    throw new Error(
      `Invalid auth tag: expected 32 hex characters (16 bytes), got ${authTagHex.length} characters`
    );
  }

  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}
