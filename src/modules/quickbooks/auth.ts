import { env } from '../../config/index.js';
import { getQuickBooksTokens, saveQuickBooksTokens, isTokenExpired, type QuickBooksTokens } from './tokens.js';
import { sendAuthAlert } from '../telegram/index.js';

const INTUIT_AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2';
const INTUIT_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';

export function getAuthUrl(): string {
  const params = new URLSearchParams({
    client_id: env.QUICKBOOKS_CLIENT_ID,
    redirect_uri: env.QUICKBOOKS_REDIRECT_URI,
    response_type: 'code',
    scope: 'com.intuit.quickbooks.accounting',
    state: crypto.randomUUID(),
  });

  return `${INTUIT_AUTH_URL}?${params.toString()}`;
}

export async function handleAuthCallback(code: string, realmId: string): Promise<void> {
  const basicAuth = Buffer.from(
    `${env.QUICKBOOKS_CLIENT_ID}:${env.QUICKBOOKS_CLIENT_SECRET}`
  ).toString('base64');

  const response = await fetch(INTUIT_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${basicAuth}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: env.QUICKBOOKS_REDIRECT_URI,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to exchange code for tokens: ${error}`);
  }

  const data = await response.json();

  await saveQuickBooksTokens({
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    realmId,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  });
}

export async function refreshTokenIfNeeded(): Promise<QuickBooksTokens | null> {
  const tokens = await getQuickBooksTokens();

  if (!tokens) {
    const authUrl = getAuthUrl();
    await sendAuthAlert('quickbooks', authUrl);
    return null;
  }

  if (!isTokenExpired(tokens.expiresAt)) {
    return tokens;
  }

  // Token expired, refresh it
  const basicAuth = Buffer.from(
    `${env.QUICKBOOKS_CLIENT_ID}:${env.QUICKBOOKS_CLIENT_SECRET}`
  ).toString('base64');

  try {
    const response = await fetch(INTUIT_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: tokens.refreshToken,
      }),
    });

    if (!response.ok) {
      throw new Error('Token refresh failed');
    }

    const data = await response.json();

    const refreshedTokens: QuickBooksTokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || tokens.refreshToken,
      realmId: tokens.realmId,
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
    };

    await saveQuickBooksTokens(refreshedTokens);
    return refreshedTokens;
  } catch (error) {
    console.error('Failed to refresh QuickBooks token:', error);
    const authUrl = getAuthUrl();
    await sendAuthAlert('quickbooks', authUrl);
    return null;
  }
}
