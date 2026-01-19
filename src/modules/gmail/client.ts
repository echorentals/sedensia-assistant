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

export async function listRecentMessages(maxResults: number = 10): Promise<gmail_v1.Schema$Message[]> {
  const gmail = await getGmailClient();
  if (!gmail) return [];

  try {
    const response = await gmail.users.messages.list({
      userId: 'me',
      maxResults,
    });

    const messages: gmail_v1.Schema$Message[] = [];
    for (const msg of response.data.messages || []) {
      if (msg.id) {
        const full = await getMessage(msg.id);
        if (full) messages.push(full);
      }
    }
    return messages;
  } catch (error) {
    console.error('Failed to list Gmail messages:', error);
    return [];
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

// Supported image MIME types
const IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp',
];

export interface EmailImage {
  filename: string;
  mimeType: string;
  data: Buffer;
}

/**
 * Extract image attachments from a Gmail message.
 * Only extracts common image formats, ignores other file types.
 */
export async function extractEmailImages(message: gmail_v1.Schema$Message): Promise<EmailImage[]> {
  const gmailClient = await getGmailClient();
  if (!gmailClient || !message.id) return [];

  const gmail = gmailClient; // Capture for use in nested function
  const messageId = message.id;
  const images: EmailImage[] = [];

  async function processPartForImages(part: gmail_v1.Schema$MessagePart): Promise<void> {
    const mimeType = part.mimeType || '';

    // Check if this is an image
    if (IMAGE_MIME_TYPES.includes(mimeType)) {
      const filename = part.filename || `image_${Date.now()}`;

      // Image data might be inline or need to be fetched via attachment ID
      if (part.body?.data) {
        // Inline image data
        images.push({
          filename,
          mimeType,
          data: Buffer.from(part.body.data, 'base64'),
        });
      } else if (part.body?.attachmentId) {
        // Need to fetch attachment
        try {
          const attachment = await gmail.users.messages.attachments.get({
            userId: 'me',
            messageId: messageId,
            id: part.body.attachmentId,
          });

          if (attachment.data.data) {
            images.push({
              filename,
              mimeType,
              data: Buffer.from(attachment.data.data, 'base64'),
            });
          }
        } catch (error) {
          console.error(`Failed to fetch attachment ${part.body.attachmentId}:`, error);
        }
      }
    }

    // Recursively process nested parts
    if (part.parts) {
      for (const subpart of part.parts) {
        await processPartForImages(subpart);
      }
    }
  }

  if (message.payload) {
    await processPartForImages(message.payload);
  }

  return images;
}

export interface ReplyOptions {
  threadId: string;
  messageId: string;
  to: string;
  subject: string;
  body: string;
  attachments?: Array<{
    filename: string;
    mimeType: string;
    data: Buffer;
  }>;
}

function createMimeMessage(options: ReplyOptions): string {
  const boundary = `boundary_${Date.now()}`;
  const hasAttachments = options.attachments && options.attachments.length > 0;

  let message = '';
  message += `MIME-Version: 1.0\r\n`;
  message += `From: me\r\n`;
  message += `To: ${options.to}\r\n`;
  message += `Subject: ${options.subject}\r\n`;
  message += `In-Reply-To: ${options.messageId}\r\n`;
  message += `References: ${options.messageId}\r\n`;

  if (hasAttachments) {
    message += `Content-Type: multipart/mixed; boundary="${boundary}"\r\n`;
    message += `\r\n`;
    message += `--${boundary}\r\n`;
    message += `Content-Type: text/plain; charset="UTF-8"\r\n`;
    message += `\r\n`;
    message += `${options.body}\r\n`;

    for (const attachment of options.attachments!) {
      message += `--${boundary}\r\n`;
      message += `Content-Type: ${attachment.mimeType}; name="${attachment.filename}"\r\n`;
      message += `Content-Disposition: attachment; filename="${attachment.filename}"\r\n`;
      message += `Content-Transfer-Encoding: base64\r\n`;
      message += `\r\n`;
      message += `${attachment.data.toString('base64')}\r\n`;
    }

    message += `--${boundary}--\r\n`;
  } else {
    message += `Content-Type: text/plain; charset="UTF-8"\r\n`;
    message += `\r\n`;
    message += `${options.body}\r\n`;
  }

  return message;
}

export async function replyToThread(options: ReplyOptions): Promise<string | null> {
  // Validate required fields
  if (!options.threadId || !options.messageId || !options.to || !options.subject || !options.body) {
    console.error('replyToThread: missing required fields');
    return null;
  }

  const gmail = await getGmailClient();
  if (!gmail) return null;

  try {
    const rawMessage = createMimeMessage(options);
    const encodedMessage = Buffer.from(rawMessage)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const response = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedMessage,
        threadId: options.threadId,
      },
    });

    return response.data.id || null;
  } catch (error) {
    console.error(`Failed to send reply to thread ${options.threadId}:`, error);
    return null;
  }
}

export async function getMessageThreadId(messageId: string): Promise<string | null> {
  const message = await getMessage(messageId);
  return message?.threadId || null;
}
