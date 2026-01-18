// src/modules/gmail/client.reply.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: vi.fn().mockImplementation(() => ({
        setCredentials: vi.fn(),
        generateAuthUrl: vi.fn(),
        getToken: vi.fn(),
        refreshAccessToken: vi.fn(),
      })),
    },
    gmail: vi.fn().mockReturnValue({
      users: {
        messages: {
          send: vi.fn(),
          get: vi.fn(),
        },
      },
    }),
  },
}));

vi.mock('./tokens.js', () => ({
  getGmailTokens: vi.fn().mockResolvedValue({
    accessToken: 'test-token',
    refreshToken: 'test-refresh',
    expiresAt: new Date(Date.now() + 3600000),
    scope: 'test',
  }),
  saveGmailTokens: vi.fn(),
  isTokenExpired: vi.fn().mockReturnValue(false),
}));

vi.mock('../telegram/index.js', () => ({
  sendAuthAlert: vi.fn(),
}));

vi.mock('../../config/index.js', () => ({
  env: {
    GOOGLE_CLIENT_ID: 'test-client-id',
    GOOGLE_CLIENT_SECRET: 'test-client-secret',
    GOOGLE_REDIRECT_URI: 'http://localhost:3000/auth/gmail/callback',
  },
}));

import { replyToThread } from './client.js';

describe('replyToThread', () => {
  it('should be a function', () => {
    expect(typeof replyToThread).toBe('function');
  });
});
