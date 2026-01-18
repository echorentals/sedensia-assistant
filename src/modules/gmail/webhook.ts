import { getMessage, extractEmailContent } from './client.js';
import { getWatchState, getNewMessagesSinceHistoryId } from './watch.js';
import { findContactByEmail } from '../../db/index.js';
import { parseEstimateRequest } from '../ai/index.js';
import { sendNotification, sendSimpleMessage } from '../telegram/index.js';
import type { EstimateRequestNotification } from '../telegram/index.js';

export interface PubSubMessage {
  message: {
    data: string; // base64 encoded
    messageId: string;
    publishTime: string;
  };
  subscription: string;
}

interface GmailNotification {
  emailAddress: string;
  historyId: number;
}

export async function handleGmailWebhook(pubsubMessage: PubSubMessage): Promise<void> {
  try {
    const data = Buffer.from(pubsubMessage.message.data, 'base64').toString('utf-8');
    const notification: GmailNotification = JSON.parse(data);

    console.log('Gmail notification received:', notification);

    // Get stored state and fetch new messages since last historyId
    const state = await getWatchState();
    if (!state) {
      console.log('No watch state found, skipping');
      return;
    }

    const messageIds = await getNewMessagesSinceHistoryId(state.historyId);
    console.log(`Found ${messageIds.length} new messages`);

    // Process each new message
    for (const messageId of messageIds) {
      try {
        await processEmailMessage(messageId);
      } catch (error) {
        console.error(`Error processing message ${messageId}:`, error);
      }
    }
  } catch (error) {
    console.error('Failed to parse Pub/Sub message:', error);
    return;
  }
}

export async function processEmailMessage(messageId: string): Promise<boolean> {
  // Validate messageId
  if (!messageId || typeof messageId !== 'string' || !messageId.trim()) {
    console.error('Invalid messageId provided');
    return false;
  }

  console.log('Processing email message:', messageId);

  // Fetch the full message
  const message = await getMessage(messageId);
  if (!message) {
    console.log('Could not fetch message, Gmail client not available');
    return false;
  }

  // Extract email content
  const { from, subject, body } = extractEmailContent(message);
  console.log('Email from:', from, 'Subject:', subject);

  // Check if sender is a monitored contact
  const contact = await findContactByEmail(from);
  if (!contact) {
    console.log('Sender not in monitored contacts, skipping');
    return false;
  }

  console.log('Matched contact:', contact.name, contact.company);

  // Parse the email with AI
  const parsed = await parseEstimateRequest({ from, subject, body });
  console.log('Parsed intent:', parsed.intent);

  // Only send notification for new requests (Phase 1)
  if (parsed.intent === 'new_request') {
    const notification: EstimateRequestNotification = {
      from: contact.name,
      company: contact.company || '',
      subject,
      items: parsed.items,
      specialRequests: parsed.specialRequests,
      gmailMessageId: messageId,
    };

    await sendNotification(notification);
    console.log('Telegram notification sent');
    return true;
  }

  // For other intents, send a simple notification for now
  if (parsed.intent !== 'general') {
    await sendSimpleMessage(
      `📧 ${parsed.intent.replace('_', ' ')} from ${contact.name}\n\nSubject: ${subject}`
    );
  }

  return true;
}
