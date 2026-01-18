import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/index.js', () => ({
  env: {
    ENCRYPTION_KEY: 'a'.repeat(64),
    GOOGLE_CLIENT_ID: 'test-client-id',
    GOOGLE_CLIENT_SECRET: 'test-client-secret',
    GOOGLE_REDIRECT_URI: 'http://localhost:3000/auth/gmail/callback',
  },
}));

vi.mock('../../db/index.js', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          is: vi.fn(() => ({
            single: vi.fn(() => Promise.resolve({ data: null, error: null })),
          })),
        })),
      })),
      upsert: vi.fn(() => Promise.resolve({ data: null, error: null })),
    })),
  },
}));

describe('gmail tokens', () => {
  it('exports getGmailTokens and saveGmailTokens', async () => {
    const tokens = await import('./tokens.js');

    expect(tokens.getGmailTokens).toBeDefined();
    expect(tokens.saveGmailTokens).toBeDefined();
  });

  it('getGmailTokens returns null when no tokens exist', async () => {
    const { getGmailTokens } = await import('./tokens.js');
    const result = await getGmailTokens();
    expect(result).toBeNull();
  });
});

describe('isTokenExpired', () => {
  it('returns false when token is not expired', async () => {
    const { isTokenExpired } = await import('./tokens.js');
    const futureDate = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
    expect(isTokenExpired(futureDate)).toBe(false);
  });

  it('returns true when token is expired', async () => {
    const { isTokenExpired } = await import('./tokens.js');
    const pastDate = new Date(Date.now() - 60 * 1000); // 1 minute ago
    expect(isTokenExpired(pastDate)).toBe(true);
  });

  it('returns true when token is within buffer window', async () => {
    const { isTokenExpired } = await import('./tokens.js');
    // Token expires in 3 minutes, but buffer is 5 minutes (default)
    const nearFutureDate = new Date(Date.now() + 3 * 60 * 1000);
    expect(isTokenExpired(nearFutureDate)).toBe(true);
  });

  it('returns false when token is outside custom buffer window', async () => {
    const { isTokenExpired } = await import('./tokens.js');
    // Token expires in 3 minutes, buffer is 2 minutes
    const nearFutureDate = new Date(Date.now() + 3 * 60 * 1000);
    expect(isTokenExpired(nearFutureDate, 2)).toBe(false);
  });
});
