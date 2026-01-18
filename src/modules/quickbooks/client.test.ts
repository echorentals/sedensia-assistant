import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/index.js', () => ({
  env: {
    QUICKBOOKS_ENVIRONMENT: 'sandbox',
  },
}));

vi.mock('./auth.js', () => ({
  refreshTokenIfNeeded: vi.fn(() => Promise.resolve({
    accessToken: 'test-token',
    realmId: 'test-realm',
    expiresAt: new Date(Date.now() + 3600000),
  })),
}));

describe('quickbooks client', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('exports getQuickBooksClient function', async () => {
    const client = await import('./client.js');
    expect(client.getQuickBooksClient).toBeDefined();
  });

  it('exports createEstimate function', async () => {
    const client = await import('./client.js');
    expect(client.createEstimate).toBeDefined();
  });

  it('exports getEstimates function', async () => {
    const client = await import('./client.js');
    expect(client.getEstimates).toBeDefined();
  });

  it('getBaseUrl returns sandbox URL for sandbox environment', async () => {
    const { getBaseUrl } = await import('./client.js');
    const url = getBaseUrl();
    expect(url).toContain('sandbox');
  });
});
