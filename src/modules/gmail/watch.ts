import { getGmailClient } from './client.js';
import { supabase } from '../../db/index.js';
import { env } from '../../config/index.js';
import { sendSimpleMessage } from '../telegram/index.js';

const RENEWAL_BUFFER_MS = 24 * 60 * 60 * 1000; // Renew 1 day before expiry
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // Check every 6 hours

interface WatchState {
  historyId: string;
  expiration: string;
}

export async function setupGmailWatch(): Promise<{ historyId: string; expiration: Date } | null> {
  if (!env.GMAIL_PUBSUB_TOPIC) {
    console.log('GMAIL_PUBSUB_TOPIC not configured, skipping watch setup');
    return null;
  }

  const gmail = await getGmailClient();
  if (!gmail) {
    console.error('Gmail client not available for watch setup');
    return null;
  }

  try {
    const response = await gmail.users.watch({
      userId: 'me',
      requestBody: {
        topicName: env.GMAIL_PUBSUB_TOPIC,
        labelIds: ['INBOX'],
      },
    });

    const historyId = response.data.historyId || '';
    const expiration = new Date(Number(response.data.expiration));

    // Store the historyId for incremental sync
    await saveWatchState({ historyId, expiration: expiration.toISOString() });

    console.log('Gmail watch established:', { historyId, expiration });
    return { historyId, expiration };
  } catch (error) {
    console.error('Failed to set up Gmail watch:', error);
    return null;
  }
}

export async function getWatchState(): Promise<WatchState | null> {
  const { data } = await supabase
    .from('app_state')
    .select('value')
    .eq('key', 'gmail_watch')
    .single();

  return data?.value as WatchState | null;
}

async function saveWatchState(state: WatchState): Promise<void> {
  await supabase
    .from('app_state')
    .upsert({
      key: 'gmail_watch',
      value: state,
      updated_at: new Date().toISOString(),
    });
}

export async function getNewMessagesSinceHistoryId(historyId: string): Promise<string[]> {
  const gmail = await getGmailClient();
  if (!gmail) return [];

  try {
    const response = await gmail.users.history.list({
      userId: 'me',
      startHistoryId: historyId,
      historyTypes: ['messageAdded'],
    });

    const messageIds: string[] = [];
    for (const history of response.data.history || []) {
      for (const added of history.messagesAdded || []) {
        if (added.message?.id) {
          messageIds.push(added.message.id);
        }
      }
    }

    // Update stored historyId to latest
    if (response.data.historyId) {
      const state = await getWatchState();
      if (state) {
        await saveWatchState({
          ...state,
          historyId: response.data.historyId,
        });
      }
    }

    return messageIds;
  } catch (error) {
    console.error('Failed to fetch history:', error);
    return [];
  }
}

export async function checkAndRenewWatch(): Promise<void> {
  const state = await getWatchState();

  if (!state) {
    console.log('No watch state found, setting up new watch');
    const result = await setupGmailWatch();
    if (result) {
      await sendSimpleMessage(
        `🔄 Gmail watch established\n\nExpiration: ${result.expiration.toISOString()}`
      );
    }
    return;
  }

  const expiration = new Date(state.expiration);
  const renewalThreshold = new Date(Date.now() + RENEWAL_BUFFER_MS);

  if (expiration < renewalThreshold) {
    console.log('Watch expiring soon, renewing...');
    const result = await setupGmailWatch();
    if (result) {
      await sendSimpleMessage(
        `🔄 Gmail watch auto-renewed\n\nNew expiration: ${result.expiration.toISOString()}`
      );
    }
  } else {
    console.log('Gmail watch still valid until:', expiration.toISOString());
  }
}

export function startWatchAutoRenewal(): void {
  // Initial check on startup
  checkAndRenewWatch().catch(console.error);

  // Periodic checks every 6 hours
  setInterval(() => {
    checkAndRenewWatch().catch(console.error);
  }, CHECK_INTERVAL_MS);

  console.log('Gmail watch auto-renewal started (checking every 6 hours)');
}
