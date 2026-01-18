import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/index.js', () => ({
  env: {
    QUICKBOOKS_CLIENT_ID: 'test-client-id',
    QUICKBOOKS_CLIENT_SECRET: 'test-client-secret',
    QUICKBOOKS_REDIRECT_URI: 'http://localhost:3000/auth/quickbooks/callback',
    QUICKBOOKS_ENVIRONMENT: 'sandbox',
  },
}));

vi.mock('./tokens.js', () => ({
  getQuickBooksTokens: vi.fn(),
  saveQuickBooksTokens: vi.fn(),
  isTokenExpired: vi.fn(),
}));

vi.mock('../telegram/index.js', () => ({
  sendAuthAlert: vi.fn(),
}));

describe('quickbooks auth', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('exports getAuthUrl function', async () => {
    const auth = await import('./auth.js');
    expect(auth.getAuthUrl).toBeDefined();
    expect(typeof auth.getAuthUrl).toBe('function');
  });

  it('getAuthUrl returns a valid Intuit OAuth URL', async () => {
    const { getAuthUrl } = await import('./auth.js');
    const url = getAuthUrl();
    expect(url).toContain('https://appcenter.intuit.com/connect/oauth2');
    expect(url).toContain('client_id=test-client-id');
    expect(url).toContain('redirect_uri=');
    expect(url).toContain('scope=');
  });

  it('getAuthUrl includes accounting scope', async () => {
    const { getAuthUrl } = await import('./auth.js');
    const url = getAuthUrl();
    expect(url).toContain('com.intuit.quickbooks.accounting');
  });
});
