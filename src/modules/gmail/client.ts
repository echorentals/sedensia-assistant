import { google, gmail_v1 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { env } from '../../config/index.js';
import { getGmailTokens, saveGmailTokens, isTokenExpired, type GmailTokens } from './tokens.js';
import { sendAuthAlert } from '../telegram/index.js';

let oauth2Client: OAuth2Client | null = null;
let gmailClient: gmail_v1.Gmail | null = null;

function getOAuth2Client(): OAuth2Client {
  if (!oauth2Client) {
    oauth2Client = new google.auth.OAuth2(
      env.GOOGLE_CLIENT_ID,
      env.GOOGLE_CLIENT_SECRET,
      env.GOOGLE_REDIRECT_URI
    );
  }
  return oauth2Client;
}

export function getAuthUrl(): string {
  const client = getOAuth2Client();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.modify',
    ],
  });
}

export async function handleAuthCallback(code: string): Promise<void> {
  const client = getOAuth2Client();
  const { tokens } = await client.getToken(code);

  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error('Missing tokens from OAuth response');
  }

  await saveGmailTokens({
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: new Date(tokens.expiry_date || Date.now() + 3600 * 1000),
    scope: tokens.scope || '',
  });

  // Reset cached client to pick up new tokens
  gmailClient = null;
}

async function refreshTokenIfNeeded(): Promise<GmailTokens | null> {
  const tokens = await getGmailTokens();

  if (!tokens) {
    const authUrl = getAuthUrl();
    await sendAuthAlert('gmail', authUrl);
    return null;
  }

  if (!isTokenExpired(tokens.expiresAt)) {
    return tokens;
  }

  // Token is expired, refresh it
  const client = getOAuth2Client();
  client.setCredentials({
    refresh_token: tokens.refreshToken,
  });

  try {
    const { credentials } = await client.refreshAccessToken();

    if (!credentials.access_token) {
      throw new Error('No access token returned');
    }

    const refreshedTokens: GmailTokens = {
      accessToken: credentials.access_token,
      refreshToken: tokens.refreshToken, // Keep existing refresh token
      expiresAt: new Date(credentials.expiry_date || Date.now() + 3600 * 1000),
      scope: credentials.scope || tokens.scope,
    };

    await saveGmailTokens(refreshedTokens);

    // Reset cached client
    gmailClient = null;
    return refreshedTokens;
  } catch (error) {
    console.error('Failed to refresh Gmail token:', error);
    const authUrl = getAuthUrl();
    await sendAuthAlert('gmail', authUrl);
    return null;
  }
}

export async function getGmailClient(): Promise<gmail_v1.Gmail | null> {
  const tokens = await refreshTokenIfNeeded();

  if (!tokens) {
    return null;
  }

  if (gmailClient) {
    return gmailClient;
  }

  const client = getOAuth2Client();
  client.setCredentials({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
  });

  gmailClient = google.gmail({ version: 'v1', auth: client });
  return gmailClient;
}

export async function getMessage(messageId: string): Promise<gmail_v1.Schema$Message | null> {
  const gmail = await getGmailClient();
  if (!gmail) return null;

  try {
    const response = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    });

    return response.data;
  } catch (error) {
    console.error(`Failed to get Gmail message ${messageId}:`, error);
    return null;
  }
}

export function extractEmailContent(message: gmail_v1.Schema$Message): {
  from: string;
  subject: string;
  body: string;
} {
  const headers = message.payload?.headers || [];

  const from = headers.find((h) => h.name?.toLowerCase() === 'from')?.value || '';
  const subject = headers.find((h) => h.name?.toLowerCase() === 'subject')?.value || '';

  // Extract body from parts
  let body = '';

  function extractText(part: gmail_v1.Schema$MessagePart): string {
    if (part.mimeType === 'text/plain' && part.body?.data) {
      return Buffer.from(part.body.data, 'base64').toString('utf-8');
    }
    if (part.parts) {
      return part.parts.map(extractText).join('\n');
    }
    return '';
  }

  if (message.payload) {
    body = extractText(message.payload);
  }

  return { from, subject, body };
}
