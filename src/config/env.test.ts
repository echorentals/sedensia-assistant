import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dotenv to prevent loading from actual .env file
vi.mock('dotenv/config', () => ({}));

describe('env validation', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('throws when required env vars are missing', async () => {
    process.env = {};
    await expect(import('./env.js')).rejects.toThrow();
  });

  it('parses valid env vars', async () => {
    process.env = {
      PORT: '3000',
      NODE_ENV: 'development',
      SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'test-key',
      GOOGLE_CLIENT_ID: 'google-id',
      GOOGLE_CLIENT_SECRET: 'google-secret',
      GOOGLE_REDIRECT_URI: 'http://localhost:3000/auth/gmail/callback',
      TELEGRAM_BOT_TOKEN: 'bot-token',
      TELEGRAM_ADMIN_CHAT_ID: '123456',
      ANTHROPIC_API_KEY: 'anthropic-key',
      ENCRYPTION_KEY: 'a'.repeat(64),
      QUICKBOOKS_CLIENT_ID: 'quickbooks-id',
      QUICKBOOKS_CLIENT_SECRET: 'quickbooks-secret',
      QUICKBOOKS_REDIRECT_URI: 'http://localhost:3000/auth/quickbooks/callback',
      QUICKBOOKS_ENVIRONMENT: 'sandbox',
    };

    const { env } = await import('./env.js');
    expect(env.PORT).toBe(3000);
    expect(env.SUPABASE_URL).toBe('https://test.supabase.co');
    expect(env.QUICKBOOKS_CLIENT_ID).toBe('quickbooks-id');
    expect(env.QUICKBOOKS_ENVIRONMENT).toBe('sandbox');
  });
});
