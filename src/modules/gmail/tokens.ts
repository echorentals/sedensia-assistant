import { supabase } from '../../db/index.js';
import { encrypt, decrypt } from '../../utils/encryption.js';

export interface GmailTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scope: string;
}

export async function getGmailTokens(): Promise<GmailTokens | null> {
  const { data, error } = await supabase
    .from('oauth_tokens')
    .select('*')
    .eq('provider', 'gmail')
    .is('realm_id', null)
    .single();

  if (error || !data) {
    return null;
  }

  return {
    accessToken: decrypt(data.access_token),
    refreshToken: decrypt(data.refresh_token),
    expiresAt: new Date(data.expires_at),
    scope: data.scope,
  };
}

export async function saveGmailTokens(tokens: GmailTokens): Promise<void> {
  const { error } = await supabase
    .from('oauth_tokens')
    .upsert({
      provider: 'gmail',
      access_token: encrypt(tokens.accessToken),
      refresh_token: encrypt(tokens.refreshToken),
      expires_at: tokens.expiresAt.toISOString(),
      scope: tokens.scope,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'provider,realm_id',
    });

  if (error) {
    throw new Error(`Failed to save Gmail tokens: ${error.message}`);
  }
}

export function isTokenExpired(expiresAt: Date, bufferMinutes = 5): boolean {
  const bufferMs = bufferMinutes * 60 * 1000;
  return new Date(Date.now() + bufferMs) >= expiresAt;
}
