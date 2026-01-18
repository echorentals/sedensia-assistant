import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/index.js', () => ({
  env: {
    ENCRYPTION_KEY: 'a'.repeat(64),
    QUICKBOOKS_CLIENT_ID: 'test-client-id',
    QUICKBOOKS_CLIENT_SECRET: 'test-client-secret',
    QUICKBOOKS_REDIRECT_URI: 'http://localhost:3000/auth/quickbooks/callback',
    QUICKBOOKS_ENVIRONMENT: 'sandbox',
  },
}));

vi.mock('../../db/index.js', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({ data: null, error: null })),
        })),
      })),
      upsert: vi.fn(() => Promise.resolve({ data: null, error: null })),
    })),
  },
}));

describe('quickbooks tokens', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('exports getQuickBooksTokens and saveQuickBooksTokens', async () => {
    const tokens = await import('./tokens.js');
    expect(tokens.getQuickBooksTokens).toBeDefined();
    expect(tokens.saveQuickBooksTokens).toBeDefined();
  });

  it('getQuickBooksTokens returns null when no tokens exist', async () => {
    const { getQuickBooksTokens } = await import('./tokens.js');
    const result = await getQuickBooksTokens();
    expect(result).toBeNull();
  });

  it('isTokenExpired returns true for expired token', async () => {
    const { isTokenExpired } = await import('./tokens.js');
    const pastDate = new Date(Date.now() - 3600 * 1000);
    expect(isTokenExpired(pastDate)).toBe(true);
  });

  it('isTokenExpired returns false for valid token', async () => {
    const { isTokenExpired } = await import('./tokens.js');
    const futureDate = new Date(Date.now() + 3600 * 1000);
    expect(isTokenExpired(futureDate)).toBe(false);
  });
});
