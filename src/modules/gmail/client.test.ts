import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { gmail_v1 } from 'googleapis';

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

vi.mock('../telegram/index.js', () => ({
  sendAuthAlert: vi.fn(() => Promise.resolve()),
}));

describe('extractEmailContent', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('extracts content from single part plain text message', async () => {
    const { extractEmailContent } = await import('./client.js');

    const message: gmail_v1.Schema$Message = {
      payload: {
        headers: [
          { name: 'From', value: 'sender@example.com' },
          { name: 'Subject', value: 'Test Subject' },
        ],
        mimeType: 'text/plain',
        body: {
          data: Buffer.from('Hello, this is the body').toString('base64'),
        },
      },
    };

    const result = extractEmailContent(message);

    expect(result.from).toBe('sender@example.com');
    expect(result.subject).toBe('Test Subject');
    expect(result.body).toBe('Hello, this is the body');
  });

  it('extracts content from multipart message', async () => {
    const { extractEmailContent } = await import('./client.js');

    const message: gmail_v1.Schema$Message = {
      payload: {
        headers: [
          { name: 'From', value: 'multipart@example.com' },
          { name: 'Subject', value: 'Multipart Subject' },
        ],
        mimeType: 'multipart/alternative',
        parts: [
          {
            mimeType: 'text/plain',
            body: {
              data: Buffer.from('Plain text version').toString('base64'),
            },
          },
          {
            mimeType: 'text/html',
            body: {
              data: Buffer.from('<p>HTML version</p>').toString('base64'),
            },
          },
        ],
      },
    };

    const result = extractEmailContent(message);

    expect(result.from).toBe('multipart@example.com');
    expect(result.subject).toBe('Multipart Subject');
    expect(result.body).toContain('Plain text version');
  });

  it('extracts content from nested multipart message', async () => {
    const { extractEmailContent } = await import('./client.js');

    const message: gmail_v1.Schema$Message = {
      payload: {
        headers: [
          { name: 'From', value: 'nested@example.com' },
          { name: 'Subject', value: 'Nested Subject' },
        ],
        mimeType: 'multipart/mixed',
        parts: [
          {
            mimeType: 'multipart/alternative',
            parts: [
              {
                mimeType: 'text/plain',
                body: {
                  data: Buffer.from('Nested plain text').toString('base64'),
                },
              },
              {
                mimeType: 'text/html',
                body: {
                  data: Buffer.from('<p>Nested HTML</p>').toString('base64'),
                },
              },
            ],
          },
          {
            mimeType: 'application/pdf',
            filename: 'attachment.pdf',
            body: {
              attachmentId: 'some-attachment-id',
            },
          },
        ],
      },
    };

    const result = extractEmailContent(message);

    expect(result.from).toBe('nested@example.com');
    expect(result.subject).toBe('Nested Subject');
    expect(result.body).toContain('Nested plain text');
  });

  it('handles message with no body', async () => {
    const { extractEmailContent } = await import('./client.js');

    const message: gmail_v1.Schema$Message = {
      payload: {
        headers: [
          { name: 'From', value: 'empty@example.com' },
          { name: 'Subject', value: 'Empty Body' },
        ],
      },
    };

    const result = extractEmailContent(message);

    expect(result.from).toBe('empty@example.com');
    expect(result.subject).toBe('Empty Body');
    expect(result.body).toBe('');
  });

  it('handles message with missing headers', async () => {
    const { extractEmailContent } = await import('./client.js');

    const message: gmail_v1.Schema$Message = {
      payload: {
        mimeType: 'text/plain',
        body: {
          data: Buffer.from('Body without headers').toString('base64'),
        },
      },
    };

    const result = extractEmailContent(message);

    expect(result.from).toBe('');
    expect(result.subject).toBe('');
    expect(result.body).toBe('Body without headers');
  });

  it('handles case-insensitive header names', async () => {
    const { extractEmailContent } = await import('./client.js');

    const message: gmail_v1.Schema$Message = {
      payload: {
        headers: [
          { name: 'from', value: 'lowercase@example.com' },
          { name: 'SUBJECT', value: 'Uppercase Subject' },
        ],
        mimeType: 'text/plain',
        body: {
          data: Buffer.from('Test body').toString('base64'),
        },
      },
    };

    const result = extractEmailContent(message);

    expect(result.from).toBe('lowercase@example.com');
    expect(result.subject).toBe('Uppercase Subject');
  });
});

describe('getAuthUrl', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns a valid URL with correct scopes', async () => {
    const { getAuthUrl } = await import('./client.js');

    const url = getAuthUrl();

    expect(url).toContain('https://accounts.google.com');
    expect(url).toContain('client_id=test-client-id');
    expect(url).toContain('redirect_uri=');
    expect(url).toContain('access_type=offline');
    expect(url).toContain('scope=');
    expect(url).toContain('gmail.readonly');
    expect(url).toContain('gmail.send');
    expect(url).toContain('gmail.modify');
  });

  it('includes prompt=consent for refresh token', async () => {
    const { getAuthUrl } = await import('./client.js');

    const url = getAuthUrl();

    expect(url).toContain('prompt=consent');
  });
});
