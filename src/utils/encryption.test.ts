import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock env before importing encryption
vi.mock('../config/index.js', () => ({
  env: {
    ENCRYPTION_KEY: 'a'.repeat(64), // 64 hex chars = 32 bytes
  },
}));

describe('encryption', () => {
  it('encrypts and decrypts a string', async () => {
    const { encrypt, decrypt } = await import('./encryption.js');

    const original = 'my-secret-token';
    const encrypted = encrypt(original);

    expect(encrypted).not.toBe(original);
    expect(encrypted).toContain(':'); // IV:ciphertext format

    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(original);
  });

  it('produces different ciphertext for same input', async () => {
    const { encrypt } = await import('./encryption.js');

    const original = 'my-secret-token';
    const encrypted1 = encrypt(original);
    const encrypted2 = encrypt(original);

    expect(encrypted1).not.toBe(encrypted2); // Different IVs
  });

  it('throws error for malformed input (wrong number of parts)', async () => {
    const { decrypt } = await import('./encryption.js');

    expect(() => decrypt('invalid')).toThrow(
      'Invalid encrypted text format: expected 3 parts'
    );
    expect(() => decrypt('part1:part2')).toThrow(
      'Invalid encrypted text format: expected 3 parts'
    );
    expect(() => decrypt('a:b:c:d')).toThrow(
      'Invalid encrypted text format: expected 3 parts'
    );
  });

  it('throws error for invalid IV length', async () => {
    const { decrypt } = await import('./encryption.js');

    // IV too short (should be 32 hex chars)
    expect(() => decrypt('abc:' + 'a'.repeat(32) + ':ciphertext')).toThrow(
      'Invalid IV: expected 32 hex characters'
    );
  });

  it('throws error for invalid auth tag length', async () => {
    const { decrypt } = await import('./encryption.js');

    // Auth tag too short (should be 32 hex chars)
    expect(() => decrypt('a'.repeat(32) + ':abc:ciphertext')).toThrow(
      'Invalid auth tag: expected 32 hex characters'
    );
  });

  it('throws error for tampered ciphertext', async () => {
    const { encrypt, decrypt } = await import('./encryption.js');

    const original = 'my-secret-token';
    const encrypted = encrypt(original);

    // Tamper with the ciphertext portion
    const parts = encrypted.split(':');
    parts[2] = 'tampered' + parts[2].slice(8);
    const tampered = parts.join(':');

    expect(() => decrypt(tampered)).toThrow();
  });
});
