import { supabase } from '../../db/index.js';
import { encrypt, decrypt } from '../../utils/encryption.js';

export interface QuickBooksTokens {
  accessToken: string;
  refreshToken: string;
  realmId: string;
  expiresAt: Date;
}

export async function getQuickBooksTokens(): Promise<QuickBooksTokens | null> {
  const { data, error } = await supabase
    .from('oauth_tokens')
    .select('*')
    .eq('provider', 'quickbooks')
    .single();

  if (error || !data) {
    return null;
  }

  return {
    accessToken: decrypt(data.access_token),
    refreshToken: decrypt(data.refresh_token),
    realmId: data.realm_id,
    expiresAt: new Date(data.expires_at),
  };
}

export async function saveQuickBooksTokens(tokens: QuickBooksTokens): Promise<void> {
  const { error } = await supabase
    .from('oauth_tokens')
    .upsert({
      provider: 'quickbooks',
      access_token: encrypt(tokens.accessToken),
      refresh_token: encrypt(tokens.refreshToken),
      realm_id: tokens.realmId,
      expires_at: tokens.expiresAt.toISOString(),
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'provider,realm_id',
    });

  if (error) {
    throw new Error(`Failed to save QuickBooks tokens: ${error.message}`);
  }
}

export function isTokenExpired(expiresAt: Date, bufferMinutes = 5): boolean {
  const bufferMs = bufferMinutes * 60 * 1000;
  return new Date(Date.now() + bufferMs) >= expiresAt;
}
