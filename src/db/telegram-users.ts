import { supabase } from './client.js';

export interface TelegramUser {
  id: string;
  telegram_id: string;
  name: string | null;
  language: 'ko' | 'en';
  created_at: string;
  updated_at: string;
}

export async function getTelegramUser(telegramId: string): Promise<TelegramUser | null> {
  const { data, error } = await supabase
    .from('telegram_users')
    .select('*')
    .eq('telegram_id', telegramId)
    .single();

  if (error || !data) {
    return null;
  }

  return data as TelegramUser;
}

export async function upsertTelegramUser(
  telegramId: string,
  name?: string
): Promise<TelegramUser | null> {
  const { data, error } = await supabase
    .from('telegram_users')
    .upsert(
      {
        telegram_id: telegramId,
        name: name || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'telegram_id' }
    )
    .select()
    .single();

  if (error) {
    console.error('Failed to upsert telegram user:', error);
    return null;
  }

  return data as TelegramUser;
}

export async function setUserLanguage(
  telegramId: string,
  language: 'ko' | 'en'
): Promise<boolean> {
  const { error } = await supabase
    .from('telegram_users')
    .update({
      language,
      updated_at: new Date().toISOString(),
    })
    .eq('telegram_id', telegramId);

  if (error) {
    console.error('Failed to set user language:', error);
    return false;
  }

  return true;
}

export async function getUserLanguage(telegramId: string): Promise<'ko' | 'en'> {
  const user = await getTelegramUser(telegramId);
  return user?.language || 'ko';
}
