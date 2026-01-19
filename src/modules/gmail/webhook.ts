import { getMessage, extractEmailContent, extractEmailImages } from './client.js';
import { getWatchState, getNewMessagesSinceHistoryId } from './watch.js';
import { findContactByEmail, createEstimate } from '../../db/index.js';
import type { EstimateItem } from '../../db/index.js';
import { parseEstimateRequest } from '../ai/index.js';
import type { ParseImage } from '../ai/index.js';
import { sendNotification, sendSimpleMessage, sendPricedEstimateNotification, sendStatusInquiryNotification, sendReorderNotification, storeDraftResponse } from '../telegram/index.js';
import type { EstimateRequestNotification } from '../telegram/index.js';
import { suggestPricesForEstimate } from '../pricing/index.js';
import type { ItemInput } from '../pricing/index.js';
import { handleStatusInquiry, handleReorder } from '../email/index.js';

// Deduplication: track recently processed message IDs (TTL: 5 minutes)
const processedMessages = new Map<string, number>();
const DEDUP_TTL_MS = 5 * 60 * 1000;

function isMessageProcessed(messageId: string): boolean {
  const timestamp = processedMessages.get(messageId);
  if (!timestamp) return false;
  if (Date.now() - timestamp > DEDUP_TTL_MS) {
    processedMessages.delete(messageId);
    return false;
  }
  return true;
}

function markMessageProcessed(messageId: string): void {
  processedMessages.set(messageId, Date.now());
  // Clean up old entries periodically
  if (processedMessages.size > 100) {
    const now = Date.now();
    for (const [id, ts] of processedMessages) {
      if (now - ts > DEDUP_TTL_MS) {
        processedMessages.delete(id);
      }
    }
  }
}

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

  // Deduplication check
  if (isMessageProcessed(messageId)) {
    console.log('Skipping duplicate message:', messageId);
    return false;
  }
  markMessageProcessed(messageId);

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

  // Extract images from email
  const emailImages = await extractEmailImages(message);
  console.log('Found', emailImages.length, 'image attachments');

  // Convert to ParseImage format
  const images: ParseImage[] = emailImages.map(img => ({
    mimeType: img.mimeType,
    data: img.data,
  }));

  // Parse the email with AI (including images if present)
  const parsed = await parseEstimateRequest({ from, subject, body, images: images.length > 0 ? images : undefined });
  console.log('Parsed intent:', parsed.intent);

  // Notify if images had unclear details
  if (parsed.hasImages && parsed.imageAnalysisNotes) {
    await sendSimpleMessage(
      `📎 Image analysis notes for email from ${contact.name}:\n\n${parsed.imageAnalysisNotes}\n\n⚠️ Some details may need manual verification.`
    );
  }

  // Route by intent
  switch (parsed.intent) {
    case 'new_request':
      // Process new requests with pricing engine (Phase 2)
      if (parsed.items.length > 0) {
        // Get pricing suggestions
        const itemInputs: ItemInput[] = parsed.items.map(item => ({
          signType: item.signType,
          size: item.size || 'TBD',
          quantity: item.quantity,
          material: item.material || undefined,
          description: item.description || undefined,
        }));

        const pricedItems = await suggestPricesForEstimate(itemInputs);
        console.log('Priced items:', pricedItems.length);

        // Create local estimate
        const estimateItems: EstimateItem[] = pricedItems.map(item => ({
          description: item.description,
          signType: item.signType || undefined,
          material: item.material || undefined,
          width: item.width,
          height: item.height,
          quantity: item.quantity,
          unitPrice: item.suggestedUnitPrice,
          suggestedPrice: item.suggestedUnitPrice,
          confidence: item.confidence,
        }));

        const estimate = await createEstimate({
          contactId: contact.id,
          gmailMessageId: messageId,
          items: estimateItems,
          notes: parsed.specialRequests.join('; '),
        });

        if (!estimate) {
          console.error('Failed to create estimate');
          return false;
        }

        // Send priced notification
        await sendPricedEstimateNotification({
          from: contact.name,
          company: contact.company || '',
          subject,
          items: pricedItems,
          specialRequests: parsed.specialRequests,
          estimateId: estimate.id,
          gmailMessageId: messageId,
          turnaroundDays: estimate.turnaround_days,
        });

        console.log('Priced estimate notification sent');
      } else {
        // Fallback for new requests without items (keep simple notification)
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
      }
      break;

    case 'status_inquiry': {
      const statusResult = await handleStatusInquiry({
        contact,
        keywords: parsed.keywords || [parsed.referencedJobDescription].filter(Boolean) as string[],
        emailLanguage: parsed.language || 'en',
        gmailMessageId: messageId,
        subject,
      });

      if (!statusResult.success) {
        console.error('Status inquiry handling failed:', statusResult.error);
        await sendSimpleMessage(
          `❓ Status inquiry from ${contact.name}\n\nSubject: ${subject}\n\n⚠️ Processing failed: ${statusResult.error || 'Unknown error'}`
        );
        break;
      }

      if (statusResult.draftResponse) {
        storeDraftResponse(messageId, statusResult.draftResponse);
      }

      await sendStatusInquiryNotification({
        contact: { name: contact.name, company: contact.company },
        subject,
        gmailMessageId: messageId,
        matchedJob: statusResult.matchedJob,
        multipleMatches: statusResult.multipleMatches,
        noMatch: statusResult.noMatch,
        searchTerms: parsed.keywords?.join(', ') || parsed.referencedJobDescription || '',
        draftResponse: statusResult.draftResponse,
      });
      break;
    }

    case 'reorder': {
      const reorderResult = await handleReorder({
        contact,
        keywords: parsed.keywords || [parsed.referencedJobDescription].filter(Boolean) as string[],
        emailLanguage: parsed.language || 'en',
        gmailMessageId: messageId,
        originalMessage: body.slice(0, 200),
      });

      if (!reorderResult.success) {
        console.error('Reorder handling failed:', reorderResult.error);
        await sendSimpleMessage(
          `🔄 Reorder request from ${contact.name}\n\nSubject: ${subject}\n\n⚠️ Processing failed: ${reorderResult.error || 'Unknown error'}`
        );
        break;
      }

      await sendReorderNotification({
        contact: { name: contact.name, company: contact.company },
        gmailMessageId: messageId,
        originalMessage: body.slice(0, 200),
        previousEstimate: reorderResult.previousEstimate,
        noMatch: reorderResult.noMatch,
      });
      break;
    }

    case 'approval':
      await sendSimpleMessage(
        `✅ Approval received from ${contact.name}\n\nSubject: ${subject}`
      );
      // TODO: Auto-update job status
      break;

    case 'general':
    default:
      // Don't notify for general messages
      console.log('General message, no action taken');
      break;
  }

  return true;
}
